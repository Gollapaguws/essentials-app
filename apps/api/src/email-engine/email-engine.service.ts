import { Injectable, NotFoundException, ForbiddenException, Optional, Inject, Logger, forwardRef } from "@nestjs/common";
import { getQueueToken } from "@nestjs/bullmq";
import type { Queue } from "bullmq";
import { prisma, ConsentStatus, EventStatus } from "@essentials/db";
import type { JwtUser } from "../common/roles.guard";
import { EmailSenderService } from "./email-sender.service";
import type { Prisma } from "@prisma/client";

/**
 * Email engine v1. Flows: welcome_series, weekly_drop, reminder_24h, reminder_1h, winback.
 * Sends are queued via BullMQ; provider is behind MailService (Resend now, listmonk+Postal later).
 * Consent is enforced at enqueue time and at send time (double-checked in the processor).
 */
@Injectable()
export class EmailEngineService {
  private readonly logger = new Logger(EmailEngineService.name);
  constructor(
    @Optional() @Inject(getQueueToken("email")) private emailQueue?: Queue,
    @Optional() @Inject(forwardRef(() => EmailSenderService)) private sender?: EmailSenderService,
  ) {}

  private async dispatch(campaignId: string, userId: string) {
    await prisma.emailJob.create({ data: { campaignId, userId } });
    if (this.emailQueue) {
      await this.emailQueue.add("send", { campaignId, userId }, { attempts: 3, backoff: { type: "exponential", delay: 30_000 } });
    }
  }

  /** Resolve a segment filter into a recipient set. Guests with granted consent only. */
  async resolveRecipients(segmentId?: string): Promise<{ id: string; email: string; name: string | null }[]> {
    let where: Prisma.UserWhereInput = { role: "guest" };
    if (segmentId) {
      const segment = await prisma.emailSegment.findUnique({ where: { id: segmentId } });
      if (!segment) throw new NotFoundException("Segment not found");
      const f = segment.filter as { musicTastes?: string[]; minAttendedEvents?: number; vibeTag?: string };
      where = {
        ...where,
        ...(f.musicTastes?.length ? { musicTastes: { hasSome: f.musicTastes } } : {}),
        ...(f.vibeTag ? { vibeTag: f.vibeTag as never } : {}),
      };
      if (f.minAttendedEvents) {
        // attended = checked_in guest list entries
        where = {
          ...where,
          guestLists: { some: { status: "checked_in" } },
        };
        // exact count filtering done in memory for v1
        const candidates = await prisma.user.findMany({
          where,
          include: { _count: { select: { guestLists: { where: { status: "checked_in" } } } } },
        });
        return candidates.filter((u) => u._count.guestLists >= f.minAttendedEvents!);
      }
    }
    return prisma.user.findMany({ where, select: { id: true, email: true, name: true } });
  }

  async createSegment(user: JwtUser, name: string, filter: object) {
    if (user.role !== "promoter" && user.role !== "admin") throw new ForbiddenException();
    return prisma.emailSegment.create({ data: { name, filter: filter as object } });
  }

  async listSegments() {
    return prisma.emailSegment.findMany({ include: { _count: { select: { campaigns: true } } } });
  }

  /** Queue a campaign send to a segment (or all consenting guests). */
  async enqueueCampaign(user: JwtUser, data: { name: string; flow: string; subject: string; segmentId?: string; eventId?: string }) {
    if (user.role !== "promoter" && user.role !== "admin") throw new ForbiddenException();
    const campaign = await prisma.campaign.create({
      data: { name: data.name, flow: data.flow, subject: data.subject, segmentId: data.segmentId, eventId: data.eventId, status: "sending" },
    });
    const recipients = await this.resolveRecipients(data.segmentId);
    const emails = new Set<string>();
    const sender = this.sender; // injected
    for (const r of recipients) {
      if (emails.has(r.email)) continue;
      emails.add(r.email);
      const consent = await prisma.consent.findUnique({ where: { email_channel: { email: r.email, channel: "email" } } });
      if (!consent || consent.status !== ConsentStatus.granted) continue;
      await prisma.emailJob.create({ data: { campaignId: campaign.id, userId: r.id } });
      if (this.emailQueue) {
        await this.emailQueue.add("send", { campaignId: campaign.id, userId: r.id }, { attempts: 3, backoff: { type: "exponential", delay: 30_000 } });
      } else {
        try {
          await this.sender?.sendCampaignEmail(campaign.id, r.id);
        } catch (e) {
          this.logger.warn(`inline send failed for ${r.email}: ${(e as Error).message}`);
        }
      }
    }
    return { campaignId: campaign.id, queued: emails.size };
  }

  /** One-click unsubscribe + preference center backing. */
  async unsubscribe(email: string) {
    await prisma.consent.upsert({
      where: { email_channel: { email, channel: "email" } },
      update: { status: "revoked", source: "preference_center" },
      create: { email, status: "revoked", source: "preference_center" },
    });
    await prisma.emailEvent.create({ data: { email, type: "unsubscribe" } });
    return { ok: true };
  }

  async getConsent(email: string) {
    const consent = await prisma.consent.findUnique({ where: { email_channel: { email, channel: "email" } } });
    return { email, status: consent?.status ?? "never_subscribed" };
  }

  async grantConsent(email: string, userId?: string) {
    return prisma.consent.upsert({
      where: { email_channel: { email, channel: "email" } },
      update: { status: "granted", source: "preference_center" },
      create: { email, userId, status: "granted", source: "signup" },
    });
  }

  /** Campaign attribution: guest-list joins and table bookings it generated. */
  async attribution(user: JwtUser, campaignId: string) {
    const campaign = await prisma.campaign.findUniqueOrThrow({ where: { id: campaignId }, include: { event: true, segment: true } });
    if (!campaign) throw new NotFoundException("Campaign not found");
    if (user.role !== "admin" && campaign.event && campaign.event.promoterId !== user.sub) throw new ForbiddenException();
    const [joins, bookings] = await Promise.all([
      prisma.guestList.count({ where: { sourceCampaignId: campaignId } }),
      prisma.tableBooking.aggregate({
        where: { sourceCampaignId: campaignId },
        _count: true,
        _sum: { value: true },
      }),
    ]);
    return {
      campaign: { id: campaign.id, name: campaign.name, flow: campaign.flow, status: campaign.status, sentCount: campaign.sentCount },
      guestListJoins: joins,
      tableBookings: bookings._count,
      tableRevenue: bookings._sum.value ?? 0,
    };
  }

  async listCampaigns(user: JwtUser) {
    if (user.role !== "promoter" && user.role !== "admin") throw new ForbiddenException();
    return prisma.campaign.findMany({
      include: { segment: { select: { name: true } }, _count: { select: { emailJobs: true } } },
      orderBy: { createdAt: "desc" },
    });
  }

  /** Weekly drop targets: approved/live upcoming events. */
  async upcomingEventsForDrop() {
    return prisma.event.findMany({
      where: { status: { in: [EventStatus.approved, EventStatus.live] }, date: { gte: new Date() } },
      orderBy: { date: "asc" },
      take: 5,
      include: { venue: { select: { name: true } } },
    });
  }
}
