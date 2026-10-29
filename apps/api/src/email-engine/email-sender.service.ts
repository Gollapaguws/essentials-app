import { Injectable, Logger, Inject, forwardRef } from "@nestjs/common";
import { prisma, ConsentStatus } from "@essentials/db";
import { MailService } from "../mail/mail.service";
import { emailTemplates, wrapTemplate } from "../mail/templates";
import { EmailEngineService } from "./email-engine.service";
import { ConfigService } from "@nestjs/config";

/**
 * Shared email send logic. Used by the BullMQ worker (Redis mode) and inline
 * by the engine fallback when no Redis is configured (dev / single-process).
 */
@Injectable()
export class EmailSenderService {
  private readonly logger = new Logger(EmailSenderService.name);

  constructor(private mail: MailService, @Inject(forwardRef(() => EmailEngineService)) private engine: EmailEngineService, private config: ConfigService) {}

  async sendCampaignEmail(campaignId: string, userId: string) {
    const jobRow = await prisma.emailJob.findFirst({ where: { campaignId, userId, status: "queued" } });
    if (!jobRow) return;

    try {
      const user = await prisma.user.findUnique({ where: { id: userId } });
      if (!user) throw new Error("user gone");
      // consent double-check at send time
      const consent = await prisma.consent.findUnique({ where: { email_channel: { email: user.email, channel: "email" } } });
      if (!consent || consent.status !== ConsentStatus.granted) {
        await prisma.emailJob.update({ where: { id: jobRow.id }, data: { status: "skipped" } });
        return;
      }

      const campaign = await prisma.campaign.findUniqueOrThrow({ where: { id: campaignId }, include: { event: true } });
      const appUrl = this.config.get("APP_URL") ?? "http://localhost:3001";
      const unsub = `${appUrl}/api/email/unsubscribe?email=${encodeURIComponent(user.email)}`;
      let html: string;

      switch (campaign.flow) {
        case "welcome_series":
          html = emailTemplates.welcomeSeries(user.name ?? "there", `${appUrl}/profile`);
          break;
        case "weekly_drop": {
          const events = await this.engine.upcomingEventsForDrop();
          html = emailTemplates.weeklyDrop(
            user.name ?? "there",
            events.map((e) => ({ title: `${e.title} @ ${e.venue.name}`, date: e.date.toDateString(), url: `${appUrl}/events/${e.id}` })),
          );
          break;
        }
        case "reminder_24h":
          html = emailTemplates.eventReminder(user.name ?? "there", campaign.event?.title ?? "ESSENTIALS", 24, `${appUrl}/events/${campaign.eventId}`);
          break;
        case "reminder_1h":
          html = emailTemplates.eventReminder(user.name ?? "there", campaign.event?.title ?? "ESSENTIALS", 1, `${appUrl}/events/${campaign.eventId}`);
          break;
        case "winback":
          html = emailTemplates.winback(user.name ?? "there", campaign.event?.title ?? "the next one", `${appUrl}/events`);
          break;
        default:
          html = `<h1>${campaign.subject}</h1>`;
      }

      await this.mail.send({ to: user.email, subject: campaign.subject, html: wrapTemplate(html, unsub), unsubscribeUrl: unsub });
      await prisma.emailJob.update({ where: { id: jobRow.id }, data: { status: "sent" } });
      await prisma.campaign.update({ where: { id: campaignId }, data: { sentCount: { increment: 1 } } });
      await prisma.emailEvent.create({ data: { email: user.email, userId, type: "delivered", meta: { campaignId } } });
    } catch (err) {
      this.logger.error(`email job failed: ${(err as Error).message}`);
      await prisma.emailJob.update({ where: { id: jobRow.id }, data: { status: "failed", error: (err as Error).message } });
      throw err;
    }
  }
}
