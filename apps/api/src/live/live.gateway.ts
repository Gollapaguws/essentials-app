import {
  CanActivate,
  ExecutionContext,
  Injectable,
  Logger,
  OnApplicationBootstrap,
} from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import { WebSocketServer, WebSocket, RawData } from "ws";
import type { IncomingMessage, Server } from "http";
import { LiveService } from "./live.service";
import { SupabaseTokenService } from "../auth/supabase-token.service";
import { AuthUserService } from "../auth/auth-user.service";

/**
 * Raw-WS ingest endpoint (admin screen → RTSP).
 * The site streams binary frames: byte 0 = 0x01 (H.264 annexb) or 0x02 (AAC ADTS),
 * remaining bytes = raw frame. The Supabase token arrives via ?token= on connect.
 *
 * Attaches a `ws` server to the app's HTTP server on path /live/ingest
 * (nginx upgrades the connection and proxies to the API).
 */
@Injectable()
export class LiveGateway implements OnApplicationBootstrap {
  private readonly logger = new Logger(LiveGateway.name);
  private wss: WebSocketServer | null = null;

  constructor(
    private live: LiveService,
    private tokens: SupabaseTokenService,
    private users: AuthUserService,
  ) {}

  onApplicationBootstrap(app: any) {
    const httpServer: Server = app.getHttpServer();
    this.wss = new WebSocketServer({ server: httpServer, path: "/live/ingest" });
    this.wss.on("connection", (ws: WebSocket, req: IncomingMessage) => {
      const token = new URL(req.url ?? "", "https://essentialsedm.com").searchParams.get("token");
      (async () => {
        if (!token) throw new Error("missing token");
        const session = await this.tokens.verify(token);
        const role = session.role ?? (await this.users.resolveRole(session.sub, session.email));
        if (role !== "admin") throw new Error("admin only");
        this.live.startIngest();
        ws.on("message", (data: RawData) => {
          const buf = Buffer.isBuffer(data)
            ? data
            : Buffer.concat(data.map((p) => (Buffer.isBuffer(p) ? p : Buffer.from(p as ArrayBuffer))));
          if (buf.length < 2) return;
          this.live.writeIngest(buf[0] === 0x02 ? 1 : 0, buf.subarray(1));
        });
      })().catch((e) => {
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
