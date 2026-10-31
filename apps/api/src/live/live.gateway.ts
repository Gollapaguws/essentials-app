import {
  Injectable,
  Logger,
} from "@nestjs/common";
import { WebSocketServer, WebSocket, RawData } from "ws";
import type { IncomingMessage, Server } from "http";
import { LiveService } from "./live.service";
import { SupabaseTokenService } from "../auth/supabase-token.service";
import { AuthUserService } from "../auth/auth-user.service";

/**
 * Raw-WS ingest endpoint (admin screen → RTSP).
 * The browser streams a live WebM container (VP8/VP9 + Opus, MediaRecorder)
 * as plain binary frames; ffmpeg re-encodes and pushes to MediaMTX.
 * The Supabase token arrives via ?token= on connect; admin + MFA required.
 */
@Injectable()
export class LiveGateway {
  private readonly logger = new Logger(LiveGateway.name);
  private wss: WebSocketServer | null = null;

  constructor(
    private live: LiveService,
    private tokens: SupabaseTokenService,
    private users: AuthUserService,
  ) {}

  /** Called from main.ts once the HTTP server is listening. */
  attach(server: Server) {
    this.wss = new WebSocketServer({ server, path: "/live/ingest" });
    this.wss.on("connection", (ws: WebSocket, req: IncomingMessage) => {
      const token = new URL(req.url ?? "", "https://essentialsedm.com").searchParams.get("token") ?? "";
      this.logger.log(`ingest connect: token len ${token.length}, url ${req.url?.slice(0, 40)}`);
      (async () => {
        if (!token) throw new Error("missing token");
        const session = await this.tokens.verify(token);
        const role = session.role ?? (await this.users.resolveRole(session.sub, session.email));
        if (role !== "admin") throw new Error("admin only");
        if (session.aal !== "aal2") throw new Error("MFA required");
        this.live.startIngest();
        ws.on("message", (data: RawData) => {
          const buf = Buffer.isBuffer(data)
            ? data
            : Buffer.concat(
                (data as (Buffer | ArrayBuffer)[]).map((p) => (Buffer.isBuffer(p) ? p : Buffer.from(p as ArrayBuffer))),
              );
          if (buf.length) this.live.writeIngest(buf);
        });
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
