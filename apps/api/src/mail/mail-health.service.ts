import { Injectable, Logger } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { Socket } from "net";

/** Reuse a probe result for half a minute: cheap enough to poll, slow enough to be harmless. */
export const MAIL_STATUS_CACHE_MS = 30_000;
const PROBE_TIMEOUT_MS = 2_000;

export interface MailStatus {
  ok: boolean;
  checkedAt: string;
}

export interface SmtpProbe {
  ok: boolean;
  reason?: string;
}

/**
 * Opens a real SMTP conversation — banner, EHLO, QUIT — instead of only a TCP
 * connect, so a relay that holds the port open but refuses to talk still reads
 * as down. Resolves; never rejects, because the caller only needs a verdict.
 */
export function probeSmtp(host: string, port: number, timeoutMs = PROBE_TIMEOUT_MS): Promise<SmtpProbe> {
  return new Promise((resolve) => {
    let settled = false;
    let greeted = false;
    let buffer = "";
    const socket = new Socket();

    const finish = (result: SmtpProbe) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      socket.removeAllListeners();
      socket.destroy();
      resolve(result);
    };

    const timer = setTimeout(() => finish({ ok: false, reason: "timeout" }), timeoutMs);

    socket.setEncoding("utf8");
    socket.once("error", (err: Error) => finish({ ok: false, reason: err.message }));
    socket.once("close", () => finish({ ok: false, reason: "closed before reply" }));
    socket.on("data", (chunk: string) => {
      buffer += chunk;
      if (!greeted) {
        if (!buffer.includes("\r\n")) return;
        if (!buffer.startsWith("220")) return finish({ ok: false, reason: "not an SMTP banner" });
        greeted = true;
        socket.write("EHLO mail-status\r\n");
        socket.write("QUIT\r\n");
        return;
      }
      // Any reply once the greeting was accepted means a live, speaking relay.
      finish({ ok: true });
    });
    socket.connect(port, host);
  });
}

/**
 * Answers "can this box send mail right now?". The auth mails GoTrue sends and
 * the API's own mail both leave through the same local Postfix, so its health is
 * the signal the dashboard needs before a staff member asks for a reset link.
 */
@Injectable()
export class MailHealthService {
  private readonly logger = new Logger(MailHealthService.name);
  private cached: { at: number; status: MailStatus } | null = null;

  constructor(private readonly config: ConfigService) {}

  async status(): Promise<MailStatus> {
    const now = Date.now();
    if (this.cached && now - this.cached.at < MAIL_STATUS_CACHE_MS) return this.cached.status;

    const host = this.config.get<string>("SMTP_HOST") ?? "127.0.0.1";
    const port = parseInt(this.config.get<string>("SMTP_PORT") ?? "25", 10);
    const probe = await probeSmtp(host, port);
    if (!probe.ok) this.logger.warn(`mail relay ${host}:${port} is not answering: ${probe.reason}`);

    const status: MailStatus = { ok: probe.ok, checkedAt: new Date(now).toISOString() };
    this.cached = { at: now, status };
    return status;
  }
}
