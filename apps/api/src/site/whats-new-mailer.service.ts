import { Injectable, Logger, OnApplicationBootstrap } from "@nestjs/common";
import { Cron, CronExpression } from "@nestjs/schedule";
import { ConfigService } from "@nestjs/config";
import { prisma, ConsentStatus } from "@essentials/db";
import { MailService } from "../mail/mail.service";
import { emailTemplates } from "../mail/templates";
import { unsubscribeLink } from "../mail/unsubscribe";
import { ChangelogService, ChangelogRelease } from "./changelog.service";

/**
 * Mails members once when the newest changelog release is one they have not been
 * told about yet.
 *
 * "New" is decided by the release date, recorded in `WhatsNewBroadcast`, so a
 * restart, a redeploy or a second instance cannot mail the list twice. Editing
 * an existing release does not re-send either — only a new date does.
 */
@Injectable()
export class WhatsNewMailerService implements OnApplicationBootstrap {
  private readonly logger = new Logger(WhatsNewMailerService.name);
  private running = false;

  constructor(
    private changelog: ChangelogService,
    private mail: MailService,
    private config: ConfigService,
  ) {}

  onApplicationBootstrap() {
    // Let the app finish booting; the cron covers anything a restart misses.
    setTimeout(() => void this.announce(), 20_000).unref();
  }

  @Cron(CronExpression.EVERY_10_MINUTES)
  async announce() {
    if (this.running) return;
    this.running = true;
    try {
      await this.sendLatest();
    } catch (err) {
      this.logger.error(`what's new announcement failed: ${(err as Error).message}`);
    } finally {
      this.running = false;
    }
  }

  private async sendLatest() {
    const latest = await this.changelog.latest();
    if (!latest) return;

    const already = await prisma.whatsNewBroadcast.findUnique({ where: { release: latest.date } });
    if (already) return;

    // Members only — the same audience the page is open to. Anyone who took
    // themselves off the list keeps their opt-out.
    const recipients = await prisma.user.findMany({
      where: {
        role: { not: "guest" },
        consentRecords: { none: { channel: "email", status: ConsentStatus.revoked } },
      },
      select: { email: true },
      orderBy: { createdAt: "asc" },
    });

    const siteUrl = (
      this.config.get<string>("SITE_URL") ??
      this.config.get<string>("APP_URL") ??
      "https://essentialsedm.com"
    ).replace(/\/$/, "");

    const html = emailTemplates.whatsNew(latest.date, this.lines(latest), `${siteUrl}/whats-new`);

    let sent = 0;
    for (const { email } of recipients) {
      try {
        await this.mail.send({
          to: email,
          subject: `ESSENTIALS · What's new — ${latest.date}`,
          html,
          unsubscribeUrl: unsubscribeLink(email, siteUrl),
        });
        sent += 1;
      } catch {
        // MailService already logged it; one bad address must not stop the run.
      }
    }

    // Recorded even when nobody was reachable, so a quiet release is not retried
    // on every tick.
    try {
      await prisma.whatsNewBroadcast.create({ data: { release: latest.date, sentCount: sent } });
    } catch (err) {
      this.logger.warn(`could not record the ${latest.date} announcement: ${(err as Error).message}`);
      return;
    }
    this.logger.log(`what's new ${latest.date} mailed to ${sent}/${recipients.length} members`);
  }

  /** The release flattened into readable lines for the email body. */
  private lines(release: ChangelogRelease) {
    return release.sections.map((section) => ({
      title: section.title,
      items: section.items.map((item) => (item.title ? `${item.title} ${item.text}`.trim() : item.text)),
    }));
  }
}
