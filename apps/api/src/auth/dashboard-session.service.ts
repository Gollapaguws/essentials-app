import {
  createCipheriv,
  createDecipheriv,
  createHash,
  randomBytes,
} from "node:crypto";
import { Injectable, Logger, UnauthorizedException } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { prisma } from "@essentials/db";
import type { Request, Response } from "express";
import { AuthUserService } from "./auth-user.service";
import { SupabaseTokenService, type VerifiedSession } from "./supabase-token.service";

export const SESSION_COOKIE = "ess_dash";
/** Holds the PKCE verifier between "forgot password" and the emailed link. */
const PKCE_COOKIE = "ess_pkce";
const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000;
const REFRESH_SKEW_MS = 60_000;

interface GoTrueTokenResponse {
  access_token?: string;
  refresh_token?: string;
  expires_in?: number;
  msg?: string;
  message?: string;
  error_description?: string;
  error?: string;
}

interface GoTrueResponse extends GoTrueTokenResponse {
  id?: string;
  /** A factors list on GET /factors, or the enrolment secret on POST /factors. */
  totp?: unknown;
  [key: string]: unknown;
}

interface SessionRow {
  id: string;
  userId: string;
  authUid: string;
  accessToken: string;
  refreshToken: string | null;
  aal: string;
  expiresAt: Date;
  refreshUntil: Date;
}

export interface ResolvedDashboardSession {
  session: VerifiedSession;
  row: SessionRow;
}

function readCookie(req: Request, name: string): string | null {
  const header = req.headers.cookie;
  if (!header) return null;
  for (const part of header.split(";")) {
    const eq = part.indexOf("=");
    if (eq < 0) continue;
    if (part.slice(0, eq).trim() === name) return decodeURIComponent(part.slice(eq + 1).trim());
  }
  return null;
}

/**
 * Dashboard sessions live on the server.
 *
 * The browser gets one opaque, httpOnly cookie. The Supabase access/refresh
 * tokens stay in this database, encrypted, and are only ever used by the API —
 * so a script on the page (or anyone with the browser's localStorage) has
 * nothing to steal. The cookie is SameSite=Lax and only sent to this origin,
 * which is also what keeps cross-site POSTs from riding an open session.
 */
@Injectable()
export class DashboardSessionService {
  private readonly logger = new Logger(DashboardSessionService.name);
  private readonly key: Buffer;
  private readonly inflight = new Map<string, Promise<GoTrueTokenResponse>>();

  constructor(
    private readonly config: ConfigService,
    private readonly tokens: SupabaseTokenService,
    private readonly authUsers: AuthUserService,
  ) {
    const secret =
      this.config.get<string>("SESSION_SECRET") ??
      this.config.get<string>("JWT_SECRET") ??
      this.config.getOrThrow<string>("SUPABASE_SERVICE_ROLE_KEY");
    this.key = createHash("sha256").update(secret).digest();
  }

  // ---- public flow ------------------------------------------------------

  /** Exchange an email/password for a server session and set the cookie. */
  async login(email: string, password: string, req: Request, res: Response): Promise<void> {
    const grant = await this.gotrue("/token?grant_type=password", {
      method: "POST",
      body: JSON.stringify({ email, password }),
    });
    if (!grant.access_token) {
      throw new UnauthorizedException("Wrong email or password.");
    }
    await this.open(res, grant);
  }

  /** Finish an emailed recovery link: the code is exchanged with our verifier. */
  async exchange(code: string, req: Request, res: Response): Promise<void> {
    const verifier = readCookie(req, PKCE_COOKIE);
    if (!verifier) {
      throw new UnauthorizedException("This link was opened in another browser. Request a new one.");
    }
    const grant = await this.gotrue("/token?grant_type=pkce", {
      method: "POST",
      body: JSON.stringify({ auth_code: code, code_verifier: verifier }),
    });
    if (!grant.access_token) throw new UnauthorizedException("This link has expired. Request a new one.");
    res.clearCookie(PKCE_COOKIE, { path: "/api/auth" });
    await this.open(res, grant);
  }

  /**
   * Send a recovery mail whose link comes back to the dashboard. The PKCE
   * verifier never leaves the server; it waits in an httpOnly cookie.
   */
  async startRecovery(email: string, redirectTo: string, res: Response): Promise<void> {
    const verifier = randomBytes(32).toString("base64url");
    const challenge = createHash("sha256").update(verifier).digest("base64url");
    res.cookie(PKCE_COOKIE, verifier, {
      httpOnly: true,
      secure: this.config.get("NODE_ENV") === "production",
      sameSite: "lax",
      path: "/api/auth",
      maxAge: 60 * 60 * 1000,
    });
    try {
      await this.gotrue("/recover", {
        method: "POST",
        body: JSON.stringify({
          email,
          code_challenge: challenge,
          code_challenge_method: "s256",
          redirect_to: redirectTo,
        }),
      });
    } catch (e) {
      // Never reveal whether the address exists; the mail server being down is
      // already surfaced by the login page's /mail/status check.
      this.logger.warn(`recovery mail failed: ${(e as Error).message}`);
    }
  }

  async logout(req: Request, res: Response): Promise<void> {
    const raw = readCookie(req, SESSION_COOKIE);
    if (raw) await prisma.dashboardSession.deleteMany({ where: { id: this.hash(raw) } });
    res.clearCookie(SESSION_COOKIE, { path: "/" });
  }

  /** Cookie → session row → verified Supabase claims, refreshing when needed. */
  async resolve(req: Request): Promise<ResolvedDashboardSession> {
    const raw = readCookie(req, SESSION_COOKIE);
    if (!raw) throw new UnauthorizedException("Not signed in");
    const id = this.hash(raw);
    const row = await prisma.dashboardSession.findUnique({ where: { id } });
    if (!row) throw new UnauthorizedException("Session expired");
    if (row.refreshUntil.getTime() < Date.now()) {
      await prisma.dashboardSession.deleteMany({ where: { id } });
      throw new UnauthorizedException("Session expired");
    }
    return { session: await this.sessionFor(row), row };
  }

  /** The current access token, refreshed in place if it is about to expire. */
  async accessToken(
    req: Request,
  ): Promise<{ token: string; row: SessionRow; session: VerifiedSession }> {
    const { session, row } = await this.resolve(req);
    // resolve() may have refreshed, so read the stored token back.
    const fresh = await prisma.dashboardSession.findUnique({ where: { id: row.id } });
    if (!fresh) throw new UnauthorizedException("Session expired");
    return { token: this.decrypt(fresh.accessToken), row: fresh, session };
  }

  /** Update the password of a session that is already signed in (recovery/first login). */
  async setPassword(req: Request, password: string): Promise<void> {
    const { token } = await this.accessToken(req);
    await this.gotrue("/user", {
      method: "PUT",
      token,
      body: JSON.stringify({ password }),
    });
  }

  // ---- MFA --------------------------------------------------------------

  async factors(req: Request) {
    const { token } = await this.accessToken(req);
    const body = await this.gotrue("/factors", { token });
    const totp = Array.isArray(body.totp) ? (body.totp as { id: string; friendly_name?: string; status?: string }[]) : [];
    return {
      totp: totp.map((f) => ({
        id: f.id,
        name: f.friendly_name ?? null,
        status: f.status ?? null,
      })),
    };
  }

  async enrollMfa(req: Request) {
    const { token } = await this.accessToken(req);
    const body = await this.gotrue("/factors", {
      method: "POST",
      token,
      body: JSON.stringify({ factor_type: "totp" }),
    });
    const totp = (body.totp ?? {}) as { secret?: string; uri?: string };
    return {
      id: body.id as string,
      secret: totp.secret as string,
      uri: totp.uri as string,
    };
  }

  async challengeMfa(req: Request, factorId: string) {
    const { token } = await this.accessToken(req);
    const body = await this.gotrue(`/factors/${encodeURIComponent(factorId)}/challenge`, {
      method: "POST",
      token,
    });
    return { id: body.id as string };
  }

  async verifyMfa(req: Request, factorId: string, challengeId: string, code: string): Promise<void> {
    const { token, row } = await this.accessToken(req);
    const grant = await this.gotrue(`/factors/${encodeURIComponent(factorId)}/verify`, {
      method: "POST",
      token,
      body: JSON.stringify({ challenge_id: challengeId, code }),
    });
    if (!grant.access_token) throw new UnauthorizedException("That code did not work.");
    await prisma.dashboardSession.update({
      where: { id: row.id },
      data: {
        accessToken: this.encrypt(grant.access_token),
        refreshToken: grant.refresh_token ? this.encrypt(grant.refresh_token) : row.refreshToken,
        expiresAt: this.expiry(grant.expires_in),
        aal: "aal2",
        lastSeenAt: new Date(),
      },
    });
  }

  // ---- internals --------------------------------------------------------

  private async open(res: Response, grant: GoTrueTokenResponse): Promise<void> {
    if (!grant.access_token) throw new UnauthorizedException("Sign-in failed.");
    const verified = await this.tokens.verify(grant.access_token);
    const identity = await this.authUsers.resolveUser(verified.sub, verified.email);
    if (!identity) throw new UnauthorizedException("Sign-in failed.");

    const raw = randomBytes(32).toString("base64url");
    await prisma.dashboardSession.create({
      data: {
        id: this.hash(raw),
        userId: identity.id,
        authUid: verified.sub,
        accessToken: this.encrypt(grant.access_token),
        refreshToken: grant.refresh_token ? this.encrypt(grant.refresh_token) : null,
        aal: verified.aal,
        expiresAt: this.expiry(grant.expires_in),
        refreshUntil: new Date(Date.now() + SESSION_TTL_MS),
      },
    });

    // Opportunistic cleanup: short-lived rows for this user are dead weight.
    await prisma.dashboardSession.deleteMany({
      where: { userId: identity.id, refreshUntil: { lt: new Date() } },
    });

    res.cookie(SESSION_COOKIE, raw, {
      httpOnly: true,
      secure: this.config.get("NODE_ENV") === "production",
      sameSite: "lax",
      path: "/",
      maxAge: SESSION_TTL_MS,
    });
  }

  private async sessionFor(row: SessionRow): Promise<VerifiedSession> {
    let access = this.decrypt(row.accessToken);
    if (row.expiresAt.getTime() - REFRESH_SKEW_MS <= Date.now()) {
      const grant = await this.refreshOnce(row);
      if (grant.access_token) {
        access = grant.access_token;
        await prisma.dashboardSession.update({
          where: { id: row.id },
          data: {
            accessToken: this.encrypt(access),
            refreshToken: grant.refresh_token ? this.encrypt(grant.refresh_token) : row.refreshToken,
            expiresAt: this.expiry(grant.expires_in),
            lastSeenAt: new Date(),
          },
        });
      }
    }
    try {
      const verified = await this.tokens.verify(access);
      // Keep the row's aal honest if Supabase promoted the token.
      if (verified.aal !== row.aal) {
        await prisma.dashboardSession.update({ where: { id: row.id }, data: { aal: verified.aal } });
      }
      return verified;
    } catch {
      await prisma.dashboardSession.deleteMany({ where: { id: row.id } });
      throw new UnauthorizedException("Session expired");
    }
  }

  /** One refresh per session at a time — GoTrue rotates and reuses are fatal. */
  private refreshOnce(row: SessionRow): Promise<GoTrueTokenResponse> {
    const existing = this.inflight.get(row.id);
    if (existing) return existing;
    const refreshToken = row.refreshToken ? this.decrypt(row.refreshToken) : null;
    if (!refreshToken) return Promise.resolve({});
    const work = this.gotrue("/token?grant_type=refresh_token", {
      method: "POST",
      body: JSON.stringify({ refresh_token: refreshToken }),
    })
      .catch((e) => {
        this.logger.warn(`refresh failed for session ${row.id.slice(0, 8)}: ${(e as Error).message}`);
        return {} as GoTrueTokenResponse;
      })
      .finally(() => this.inflight.delete(row.id));
    this.inflight.set(row.id, work);
    return work;
  }

  private expiry(expiresIn?: number): Date {
    return new Date(Date.now() + (expiresIn && expiresIn > 0 ? expiresIn : 3600) * 1000);
  }

  private async gotrue(
    path: string,
    opts: { method?: string; token?: string; body?: string } = {},
  ): Promise<GoTrueResponse> {
    const base = this.config.get<string>("SUPABASE_URL");
    const key =
      this.config.get<string>("SUPABASE_ANON_KEY") ??
      this.config.get<string>("SUPABASE_SERVICE_ROLE_KEY");
    if (!base || !key) throw new UnauthorizedException("Sign-in is not configured.");

    const res = await fetch(`${base}/auth/v1${path}`, {
      method: opts.method ?? "GET",
      headers: {
        "Content-Type": "application/json",
        apikey: key,
        Authorization: `Bearer ${opts.token ?? key}`,
      },
      body: opts.body,
      signal: AbortSignal.timeout(10_000),
    });
    const text = await res.text();
    let body: GoTrueResponse = {};
    try {
      body = text ? JSON.parse(text) : {};
    } catch {
      body = { message: text };
    }
    if (!res.ok) {
      const detail = body.msg ?? body.message ?? body.error_description ?? `HTTP ${res.status}`;
      throw new UnauthorizedException(String(detail));
    }
    return body;
  }

  private hash(raw: string): string {
    return createHash("sha256").update(raw).digest("hex");
  }

  private encrypt(value: string): string {
    const iv = randomBytes(12);
    const cipher = createCipheriv("aes-256-gcm", this.key, iv);
    const ct = Buffer.concat([cipher.update(value, "utf8"), cipher.final()]);
    return `${iv.toString("base64url")}.${cipher.getAuthTag().toString("base64url")}.${ct.toString("base64url")}`;
  }

  private decrypt(value: string): string {
    const [iv, tag, ct] = value.split(".");
    if (!iv || !tag || !ct) throw new UnauthorizedException("Session unreadable");
    const decipher = createDecipheriv("aes-256-gcm", this.key, Buffer.from(iv, "base64url"));
    decipher.setAuthTag(Buffer.from(tag, "base64url"));
    return Buffer.concat([decipher.update(Buffer.from(ct, "base64url")), decipher.final()]).toString("utf8");
  }
}
