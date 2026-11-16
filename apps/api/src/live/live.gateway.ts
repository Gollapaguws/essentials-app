import {
  Injectable,
  Logger,
} from "@nestjs/common";
import { WebSocketServer, WebSocket, RawData } from "ws";
import type { IncomingMessage, Server } from "http";
import type { Request } from "express";
import type { Role } from "@prisma/client";
import { LiveService } from "./live.service";
import { LiveBookingService } from "./live-booking.service";
import { SupabaseTokenService } from "../auth/supabase-token.service";
import { AuthUserService } from "../auth/auth-user.service";
import { DashboardSessionService } from "../auth/dashboard-session.service";

/** Artists broadcast from the dashboard; admins keep the front-page screen share. */
const BROADCAST_ROLES: readonly Role[] = ["artist", "admin"];

/**
 * Raw-WS ingest endpoint (browser → RTSP).
 * The browser streams a live WebM container (VP8/VP9 + Opus, MediaRecorder)
 * as plain binary frames; ffmpeg re-encodes and pushes to MediaMTX.
 * DJs authenticate with the dashboard's httpOnly session cookie (sent on the
 * WS handshake); the public site still passes its Supabase token via ?token=.
 * Admins additionally need aal2, as before.
 * Only one broadcast can run at a time, so the ffmpeg input is stopped when the
 * last broadcaster disconnects.
 */
@Injectable()
export class LiveGateway {
  private readonly logger = new Logger(LiveGateway.name);
  private wss: WebSocketServer | null = null;
  private ingestClients = 0;

  constructor(
    private live: LiveService,
    private liveBookings: LiveBookingService,
    private tokens: SupabaseTokenService,
    private users: AuthUserService,
    private sessions: DashboardSessionService,
  ) {}

  /** Browser origins that may open the ingest socket. */
  private allowedOrigins(): string[] {
    const values = [
      process.env.CORS_ORIGINS,
      process.env.SITE_URL,
      process.env.APP_URL,
      "https://essentialsedm.com",
      "https://www.essentialsedm.com",
    ];
    const origins = new Set<string>();
    for (const value of values) {
      for (const part of (value ?? "").split(",")) {
        const trimmed = part.trim();
        if (!trimmed) continue;
        try {
          origins.add(new URL(trimmed).origin);
        } catch {
          // Ignore a malformed env value; the explicit production origins above
          // still apply.
        }
      }
    }
    return [...origins];
  }

  /**
   * Cookie-authenticated WebSockets need an Origin check: browsers attach the
   * dashboard cookie to the handshake, and without this another site could try
   * to ride an open session. Native clients have no Origin and are allowed.
   */
  private assertOrigin(req: IncomingMessage): void {
    const origin = req.headers.origin;
    if (origin && !this.allowedOrigins().includes(origin)) {
      throw new Error("Origin not allowed");
    }
  }

  /** Cookie session or bearer token → a role allowed to broadcast, plus its account id. */
  private async authorize(req: IncomingMessage, token: string): Promise<{ role: Role; userId: string | null }> {
    this.assertOrigin(req);
    const session = token
      ? await this.tokens.verify(token)
      : (await this.sessions.resolve(req as unknown as Request)).session;
    const identity = await this.users.resolveUser(session.sub, session.email);
    const role = (identity?.role ?? session.role ?? null) as Role;
    if (!BROADCAST_ROLES.includes(role)) throw new Error("DJ or admin account required");
    // DJs are not MFA-enrolled; admins keep the stricter front-page rule.
    if (role === "admin" && session.aal !== "aal2") throw new Error("MFA required");
    return { role, userId: identity?.id ?? null };
  }

  private clientGone() {
    this.ingestClients = Math.max(0, this.ingestClients - 1);
    if (this.ingestClients === 0) this.live.stopIngest();
  }

  /** Called from main.ts once the HTTP server is listening. */
  attach(server: Server) {
    this.wss = new WebSocketServer({
      server,
      path: "/live/ingest",
      // The site sends ["bearer", <jwt>] so the token stays out of the URL and
      // access logs. Dashboard browsers use the httpOnly cookie instead.
      handleProtocols: (protocols) => (protocols.has("bearer") ? "bearer" : false),
    });
    this.wss.on("connection", (ws: WebSocket, req: IncomingMessage) => {
      const protocols = String(req.headers["sec-websocket-protocol"] ?? "")
        .split(",")
        .map((part) => part.trim());
      const token = protocols[0] === "bearer" ? protocols[1] ?? "" : "";
      this.logger.log(`ingest connect: token ${token ? "present" : "absent"}, cookie ${req.headers.cookie ? "present" : "absent"}`);
      // Without this, a broken frame would emit 'error' with no listener.
      ws.on("error", (e) => {
        this.logger.warn(`ingest socket: ${e.message}`);
        try { ws.close(); } catch {}
      });
      (async () => {
        const { role, userId } = await this.authorize(req, token);
        // A DJ may only broadcast inside a booked live session.
        const active = role === "artist" && userId ? await this.liveBookings.activeForUser(userId) : null;
        if (role === "artist" && !active) {
          throw new Error("No live session is booked for right now");
        }
        // startIngest is idempotent but single-broadcast: another live DJ owns it.
        if (!this.live.startIngest()) throw new Error("A broadcast is already live");
        this.live.setBroadcaster(
          role === "admin"
            ? { bookingId: null, stageName: "ESSENTIALS", title: "Studio broadcast" }
            : { bookingId: active!.id, stageName: active!.stageName, title: active!.title },
        );
        this.ingestClients += 1;
        this.logger.log(`ingest accepted (${role})`);
        ws.on("message", (data: RawData) => {
          const buf = Buffer.isBuffer(data)
            ? data
            : Buffer.concat(
                (data as (Buffer | ArrayBuffer)[]).map((p) => (Buffer.isBuffer(p) ? p : Buffer.from(p as ArrayBuffer))),
              );
          if (buf.length) this.live.writeIngest(buf);
        });
        ws.on("close", () => this.clientGone());
      })().catch((e) => {
        this.logger.warn(`ingest rejected: ${(e as Error).message}`);
        try { ws.close(4401, String((e as Error).message).slice(0, 100)); } catch {}
      });
    });
    this.wss.on("error", (e) => this.logger.error(`ws: ${e.message}`));
    this.logger.log("live ingest WS ready at /live/ingest");
  }

  /** Keep a reference so the module graph keeps the gateway provider alive. */
  get server() {
    return this.wss;
  }
}
