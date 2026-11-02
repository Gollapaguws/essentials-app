import { Injectable, Logger, OnModuleInit, Optional, Inject } from "@nestjs/common";
import { Interval } from "@nestjs/schedule";
import { getQueueToken } from "@nestjs/bullmq";
import type { Queue } from "bullmq";
import { RetentionService } from "../site/retention.service";
import { prisma, EventStatus } from "@essentials/db";

/**
 * Reminder scheduler: enqueues reminder_24h / reminder_1h campaign sends ahead of events.
 * Runs every 10 minutes; idempotent via campaign dedupe keys (name holds the key).
 */
@Injectable()
export class RemindersService implements OnModuleInit {
  private readonly logger = new Logger(RemindersService.name);

  constructor(
    @Optional() @Inject(getQueueToken("email")) private emailQueue?: Queue,
    private retention?: RetentionService,
  ) {}

  async onModuleInit() {
    this.logger.log("reminder scheduler ready");
  }

  /** Daily retention automations: taste matches + post-event follow-ups. */
  @Interval(3_600_000)
  async retentionSweep() {
    if (!this.retention) return;
    try {
      const taste = await this.retention.sendTasteMatches();
      const post = await this.retention.sendPostEventEmails();
      if (taste.sent || post.sent) this.logger.log(`retention sweep: taste=${taste.sent} post=${post.sent}`);
    } catch (e) {
      this.logger.error(`retention sweep failed: ${(e as Error).message}`);
    }
  }

  @Interval(600_000)
  async sweep() {
    for (const hours of [24, 1]) {
      const windowStart = new Date(Date.now() + hours * 3600_000 - 600_000);
      const windowEnd = new Date(Date.now() + hours * 3600_000 + 600_000);
      const events = await prisma.event.findMany({
        where: { status: { in: [EventStatus.approved, EventStatus.live] }, date: { gte: windowStart, lte: windowEnd } },
      });
      for (const event of events) {
        const key = `reminder_${hours}h_${event.id}`;
        const exists = await prisma.campaign.findFirst({ where: { name: key } });
        if (exists) continue;
        await prisma.campaign.create({
          data: { name: key, flow: `reminder_${hours}h`, subject: `${event.title} — doors soon`, eventId: event.id, status: "sending" },
        });
        const attendees = await prisma.guestList.findMany({
          where: { eventId: event.id, status: "attending" },
          select: { userId: true },
        });
        const campaign = await prisma.campaign.findFirstOrThrow({ where: { name: key } });
        for (const a of attendees) {
          await this.emailQueue?.add("send", { campaignId: campaign.id, userId: a.userId }, { attempts: 3 });
        }
        this.logger.log(`queued ${hours}h reminder for ${event.title} (${attendees.length} recipients)`);
      }
    }
  }
}
