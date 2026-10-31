import { Injectable, Logger } from "@nestjs/common";
import { prisma } from "@essentials/db";

export type AuthEventKind =
  | "sign_in"
  | "lazy_link"
  | "invite_redeemed"
  | "role_change"
  | "mfa_enrolled"
  | "mfa_escalated";

export interface AuthEventInput {
  userId?: string;
  email?: string;
  ip?: string;
  meta?: Record<string, unknown>;
}

/** Best-effort audit trail: an audit failure never blocks authentication. */
@Injectable()
export class AuthEventsService {
  private readonly logger = new Logger(AuthEventsService.name);

  async record(kind: AuthEventKind, data: AuthEventInput = {}): Promise<void> {
    try {
      await prisma.authEvent.create({
        data: {
          kind,
          userId: data.userId,
          email: data.email?.toLowerCase(),
          ip: data.ip,
          meta: (data.meta ?? {}) as object,
        },
      });
    } catch (e) {
      this.logger.warn(`auth audit write failed (${kind}): ${(e as Error).message}`);
    }
  }
}
