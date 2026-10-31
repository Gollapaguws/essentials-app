import { OnGatewayConnection, OnGatewayDisconnect, WebSocketGateway } from "@nestjs/websockets";
import type { RawData } from "ws";
import { LiveService } from "./live.service";
import { SupabaseTokenService } from "../auth/supabase-token.service";
import { AuthUserService } from "../auth/auth-user.service";

/**
 * Raw-WS ingest endpoint. The screen-capture client sends binary frames:
 *   byte 0 = 0x01 (H.264 annexb) or 0x02 (AAC ADTS), rest = raw frame bytes.
 * Admin-only: the Supabase token comes in ?token= and is verified on connect.
 */
@WebSocketGateway({ path: "/live/ingest", cors: { origin: "https://essentialsedm.com" } })
export class LiveGateway implements OnGatewayConnection, OnGatewayDisconnect {
  constructor(
    private live: LiveService,
    private tokens: SupabaseTokenService,
    private users: AuthUserService,
  ) {}

  async handleConnection(client: any, info?: any) {
    try {
      const url = new URL(info?.url ?? "", "https://essentialsedm.com");
      const token = url.searchParams.get("token");
      if (!token) throw new Error("missing token");
      const session = await this.tokens.verify(token);
      const role = session.role ?? (await this.users.resolveRole(session.sub, session.email));
      if (role !== "admin") throw new Error("admin only");
      this.live.startIngest();
      client.on("data", (d: RawData) => {
        let buf: Buffer;
        if (Buffer.isBuffer(d)) buf = d;
        else if (Array.isArray(d)) {
          buf = Buffer.concat(d.map((p) => (Buffer.isBuffer(p) ? p : Buffer.from(p as ArrayBuffer))));
        } else {
          buf = Buffer.from(d as ArrayBuffer);
        }
        if (buf.length < 2) return;
        this.live.writeIngest(buf[0] === 0x02 ? 1 : 0, buf.subarray(1));
      });
    } catch (e) {
      try { client.close(4401, String((e as Error).message).slice(0, 100)); } catch {}
    }
  }

  handleDisconnect(client: any) {
    // stop the RTSP output when the caster disconnects
    this.live.stopIngest();
  }
}
