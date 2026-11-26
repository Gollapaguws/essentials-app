import { Injectable, Logger } from "@nestjs/common";
import { Interval } from "@nestjs/schedule";
import { prisma } from "@essentials/db";
import { MailService } from "./mail.service";

/**
 * Files mail by each mailbox's saved rules. The rules live beside the mailbox
 * (see MailService.rules), so this only has to visit the active mailboxes and
 * let the service do the rest; a failure in one mailbox never stops the others.
 */
@Injectable()
export class MailRulesService {
  private readonly logger = new Logger(MailRulesService.name);
  private running = false;

  constructor(private readonly mail: MailService) {}

  @Interval(60_000)
  async sweep() {
    // A slow mail store must not stack sweeps on top of each other.
    if (this.running) return;
    this.running = true;
    try {
      const boxes = await prisma.userMailbox.findMany({
        where: { status: "active" },
        select: { localpart: true },
      });
      for (const box of boxes) {
        await this.mail.fileByRules(box.localpart).catch((err: unknown) => {
          const message = String((err as Error)?.message ?? err).slice(0, 200);
          this.logger.warn(`Could not file mail for ${box.localpart}: ${message}`);
        });
      }
    } catch (err) {
      this.logger.warn(`Rules sweep failed: ${String((err as Error)?.message ?? err).slice(0, 200)}`);
    } finally {
      this.running = false;
    }
  }
}
