import {
  createCipheriv,
  createDecipheriv,
  createHash,
  randomBytes,
} from "node:crypto";
import { Injectable, Logger, NotFoundException, UnauthorizedException } from "@nestjs/common";
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
  /** The enrolment secret returned by POST /factors. */
  totp?: unknown;
  [key: string]: unknown;
}

interface AuthFactor {
  id: string;
  friendly_name?: string;
  status?: string;
  factor_type?: string;
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

export interface DashboardDevice {
  id: string;
  createdAt: Date;
  lastSeenAt: Date;
  aal: string;
  current: boolean;
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

  /**
   * Turn a Supabase session the browser already holds into a dashboard session.
   *
   * The public site signs in with the Supabase client, so its Google and
   * password sign-ins never touched this cookie and the dashboard sent people
   * back to its own login. The token is verified here like any bearer token
   * before anything is stored.
   */
  async adopt(
    accessToken: string,
    refreshToken: string | null,
    res: Response,
  ): Promise<void> {
    await this.assertSessionLive(accessToken);
    await this.open(res, {
      access_token: accessToken,
      refresh_token: refreshToken ?? undefined,
    });
  }

  /**
   * A signed JWT is not proof that the session still exists.
   *
   * Access tokens verify locally against the JWKS and stay valid until they
   * expire, so a signed-out browser could hand the dashboard one it still had in
   * memory and be let back in. Asking the identity provider whether the session
   * is live is the only way to honour a sign-out immediately.
   */
  private async assertSessionLive(token: string): Promise<void> {
    try {
      await this.gotrue("/user", { token });
    } catch {
      throw new UnauthorizedException("That session has ended. Sign in again.");
    }
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
    if (raw) {
      const row = await prisma.dashboardSession.findUnique({ where: { id: this.hash(raw) } });
      if (row) await this.endUpstreamSession(row);
      await prisma.dashboardSession.deleteMany({ where: { id: this.hash(raw) } });
    }
    res.clearCookie(SESSION_COOKIE, { path: "/" });
  }

  /**
   * End the identity-provider session behind this dashboard session.
   *
   * Deleting the cookie alone looked like a sign-out but was not one: the browser
   * kept its Supabase tokens, and the public site could swap them for a fresh
   * dashboard session on the very next click. Best effort — a token that has
   * already expired cannot be logged out, and the session is dropped regardless.
   */
  private async endUpstreamSession(row: SessionRow): Promise<void> {
    const end = (token: string) => this.gotrue("/logout", { method: "POST", token });
    try {
      await end(this.decrypt(row.accessToken));
      return;
    } catch {
      /* expired access token: the refresh token below can still end it */
    }
    try {
      const grant = await this.refreshOnce(row);
      if (grant.access_token) await end(grant.access_token);
    } catch (e) {
      this.logger.warn(`could not end the upstream session: ${(e as Error).message}`);
    }
  }

  /**
   * Sign-ins the account can see and revoke. Tokens and the auth uid never leave
   * the server; `id` is the row's hash, which is useless as a cookie value.
   */
  async devices(req: Request): Promise<DashboardDevice[]> {
    const { row } = await this.resolve(req);
    const rows = await prisma.dashboardSession.findMany({
      where: { userId: row.userId, refreshUntil: { gte: new Date() } },
      orderBy: { lastSeenAt: "desc" },
      select: { id: true, createdAt: true, lastSeenAt: true, aal: true },
    });
    return rows.map((r) => ({ ...r, current: r.id === row.id }));
  }

  /** Revoke one of this account's sessions; revoking the caller's own signs it out. */
  async revokeDevice(req: Request, res: Response, id: string): Promise<void> {
    const { row } = await this.resolve(req);
    // Scoped to the caller's user id: an id from another account matches nothing.
    const target = await prisma.dashboardSession.findFirst({ where: { id, userId: row.userId } });
    if (!target) throw new NotFoundException("That device is not signed in.");
    // Revoking the row alone only took that browser's cookie away: its Supabase
    // tokens stayed valid, so the site could hand it a fresh session on the next
    // click. The provider session has to end for the sign-out to hold.
    await this.endUpstreamSession(target);
    await prisma.dashboardSession.deleteMany({ where: { id: target.id } });
    if (target.id === row.id) res.clearCookie(SESSION_COOKIE, { path: "/" });
  }

  /**
   * Delete every session whose refresh window has closed. Called nightly: rows
   * otherwise only disappear when their cookie comes back or the account signs
   * in again, so an abandoned session would keep encrypted tokens forever.
   */
  async pruneExpired(now = new Date()): Promise<number> {
    const { count } = await prisma.dashboardSession.deleteMany({
      where: { refreshUntil: { lt: now } },
    });
    return count;
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

  /**
   * The identity provider no longer lists factors on `GET /factors` — it answers
   * 405 — so the admin route is the only way to read them. The session row already
   * names whose factors these are, so the call stays scoped to the caller.
   */
  async factors(req: Request) {
    const { row } = await this.resolve(req);
    const factors = await this.gotrue<AuthFactor[]>(
      `/admin/users/${encodeURIComponent(row.authUid)}/factors`,
      { service: true },
    );
    return {
      totp: (Array.isArray(factors) ? factors : [])
        .filter((f) => f.factor_type === "totp")
        .map((f) => ({
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

  private async gotrue<T = GoTrueResponse>(
    path: string,
    opts: { method?: string; token?: string; body?: string; service?: boolean } = {},
  ): Promise<T> {
    const base = this.config.get<string>("SUPABASE_URL");
    const serviceKey = this.config.get<string>("SUPABASE_SERVICE_ROLE_KEY");
    // Admin routes reject the anon key; everything else prefers it.
    const key = opts.service ? serviceKey : (this.config.get<string>("SUPABASE_ANON_KEY") ?? serviceKey);
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
    return body as T;
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
