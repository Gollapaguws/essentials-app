import { createHmac } from "node:crypto";
import { Injectable } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";

/**
 * Jotform agent identity.
 *
 * The widget only trusts an identity when the page sends an HMAC of the user id
 * made with the agent's secret. That secret must never reach the browser, so the
 * API signs instead and the client only ever sees the hash.
 */
@Injectable()
export class AgentIdentityService {
  constructor(private readonly config: ConfigService) {}

  /** Without a secret there is nothing to sign with; the widget stays anonymous. */
  get configured(): boolean {
    return Boolean(this.config.get<string>("JOTFORM_AGENT_SECRET"));
  }

  sign(userId: string): { userID: string; userHash: string } {
    const secret = this.config.get<string>("JOTFORM_AGENT_SECRET") ?? "";
    return {
      userID: userId,
      userHash: createHmac("sha256", secret).update(userId).digest("hex"),
    };
  }
}
