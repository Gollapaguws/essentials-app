import { Injectable, ForbiddenException, NotFoundException, ConflictException } from "@nestjs/common";
import { prisma, type Event } from "@essentials/db";
import type { JwtUser } from "../common/roles.guard";
import type { Response } from "express";
import { buildSlots } from "./slots";

/** Phase 4.5 promoter QoL: event cloning, guest-list export, capacity pacing. */
@Injectable()
export class EventToolsService {
  /** Clone an event (+7 days, draft status) for the owning promoter. */
  async clone(user: JwtUser, eventId: string) {
    const event = await prisma.event.findUnique({ where: { id: eventId } });
    if (!event) throw new NotFoundException("Event not found");
    if (user.role !== "admin" && event.promoterId !== user.sub) throw new ForbiddenException();
    return this.createCopy(event, new Date(event.date.getTime() + 7 * 86_400_000));
  }

  /**
   * A weekly run from one night: N extra drafts at seven-day intervals, each
   * carrying the same slot plan, venue and fee.
   */
  async repeat(user: JwtUser, eventId: string, weeks: number) {
    const event = await prisma.event.findUnique({ where: { id: eventId } });
    if (!event) throw new NotFoundException("Event not found");
    if (user.role !== "admin" && event.promoterId !== user.sub) throw new ForbiddenException();
    if (!Number.isInteger(weeks) || weeks < 1 || weeks > 12) {
      throw new ConflictException("Repeat between 1 and 12 weeks");
    }

    const created = [];
    for (let week = 1; week <= weeks; week++) {
      created.push(await this.createCopy(event, new Date(event.date.getTime() + week * 7 * 86_400_000)));
    }
    return { created: created.length, events: created };
  }

  private async createCopy(event: Event, date: Date) {
    // The slot plan and the budget are the expensive part of planning a night, so
    // a clone carries them instead of making the promoter retype the whole thing.
    const plan =
      event.slotCount && event.slotMinutes
        ? {
            djFeePerHour: event.djFeePerHour,
            budget: event.budget,
            slotCount: event.slotCount,
            slotMinutes: event.slotMinutes,
            slotStartMinute: event.slotStartMinute ?? 20 * 60,
          }
        : null;

    const cloned = await prisma.event.create({
      data: {
        venueId: event.venueId,
        promoterId: event.promoterId,
        title: `${event.title} (copy)`,
        description: event.description,
        date,
        lineup: event.lineup ?? [],
        capacity: event.capacity,
        dressCode: event.dressCode,
        ticketUrl: event.ticketUrl,
        status: "draft",
        revenueSplitPromoterPct: event.revenueSplitPromoterPct,
        genres: event.genres,
        djFeePerHour: event.djFeePerHour,
        budget: event.budget,
        slotCount: event.slotCount,
        slotMinutes: event.slotMinutes,
        slotStartMinute: event.slotStartMinute,
        ...(plan ? { slots: { create: buildSlots(date, plan) } } : {}),
      },
    });
    if (await prisma.eventGroupChat.findUnique({ where: { eventId: cloned.id } }).then((c) => !c)) {
      await prisma.eventGroupChat.create({ data: { eventId: cloned.id } }).catch(() => null);
    }
    return cloned;
  }

  /** Cancel an event: nothing is deleted, it just leaves guest feeds and reminders. */
  async cancel(user: JwtUser, eventId: string) {
    const event = await prisma.event.findUnique({ where: { id: eventId } });
    if (!event) throw new NotFoundException("Event not found");
    if (user.role !== "admin" && event.promoterId !== user.sub) throw new ForbiddenException();
    if (event.status === "cancelled") throw new ConflictException("Event is already cancelled");
    return prisma.event.update({ where: { id: eventId }, data: { status: "cancelled" } });
  }

  /** Bring a cancelled event back: guest lists intact, back in the venue's approval queue. */
  async reopen(user: JwtUser, eventId: string) {
    const event = await prisma.event.findUnique({ where: { id: eventId } });
    if (!event) throw new NotFoundException("Event not found");
    if (user.role !== "admin" && event.promoterId !== user.sub) throw new ForbiddenException();
    if (event.status !== "cancelled") throw new ConflictException("Event is not cancelled");
    return prisma.event.update({ where: { id: eventId }, data: { status: "pending_venue_approval" } });
  }

  /** Delete an event and its dependent rows (guest lists, bookings, chat, promos). Campaigns keep their history, detached. */
  async remove(user: JwtUser, eventId: string) {
    const event = await prisma.event.findUnique({
      where: { id: eventId },
      include: { groupChat: { select: { id: true } } },
    });
    if (!event) throw new NotFoundException("Event not found");
    if (user.role !== "admin" && event.promoterId !== user.sub) throw new ForbiddenException();

    await prisma.$transaction(async (tx) => {
      if (event.groupChat) {
        await tx.groupMessage.deleteMany({ where: { chatId: event.groupChat.id } });
        await tx.eventGroupChat.delete({ where: { id: event.groupChat.id } });
      }
      const promotions = await tx.promotion.findMany({ where: { eventId }, select: { id: true } });
      await tx.promotionRedemption.deleteMany({ where: { promotionId: { in: promotions.map((p) => p.id) } } });
      await tx.promotion.deleteMany({ where: { eventId } });
      const bookings = await tx.artistBooking.findMany({ where: { eventId }, select: { id: true } });
      await tx.bookingRouteLeg.deleteMany({ where: { bookingId: { in: bookings.map((b) => b.id) } } });
      await tx.artistBooking.deleteMany({ where: { eventId } });
      await tx.guestList.deleteMany({ where: { eventId } });
      await tx.tableBooking.deleteMany({ where: { eventId } });
      await tx.match.deleteMany({ where: { eventId } });
      await tx.doorLog.deleteMany({ where: { eventId } });
      // Campaigns may already have been sent, so keep them and just drop the link.
      await tx.campaign.updateMany({ where: { eventId }, data: { eventId: null } });
      await tx.event.delete({ where: { id: eventId } });
    });
    return { ok: true, id: eventId };
  }

  /** Guest-list CSV export for door teams. */
  async exportCsv(user: JwtUser, eventId: string, res: Response) {
    const event = await prisma.event.findUnique({ where: { id: eventId } });
    if (!event) throw new NotFoundException("Event not found");
    if (user.role !== "admin" && event.promoterId !== user.sub) throw new ForbiddenException();

    const rows = await prisma.guestList.findMany({
      where: { eventId },
      include: { user: { select: { name: true, email: true } } },
      orderBy: { createdAt: "asc" },
    });
    const esc = (v: unknown) => `"${String(v ?? "").replace(/"/g, '""')}"`;
    const lines = [
      "name,email,headcount,status,checked_in_at,source_campaign",
      ...rows.map((r) =>
        [esc(r.user.name), esc(r.user.email), r.headcount, r.status, r.checkedInAt?.toISOString() ?? "", r.sourceCampaignId ?? ""].join(","),
      ),
    ];
    res.setHeader("Content-Type", "text/csv; charset=utf-8");
    res.setHeader("Content-Disposition", `attachment; filename="guestlist-${eventId}.csv"`);
    res.send(lines.join("\n"));
  }

  /**
   * Per-event DJ spend for the promoter's books: every slot, who holds it, the fee
   * agreed and where each invoice stands. Cancelled applications are left out.
   */
  async exportSpendCsv(user: JwtUser, eventId: string, res: Response) {
    const event = await prisma.event.findUnique({ where: { id: eventId }, include: { venue: { select: { name: true } } } });
    if (!event) throw new NotFoundException("Event not found");
    if (user.role !== "admin" && event.promoterId !== user.sub) throw new ForbiddenException();

    const bookings = await prisma.artistBooking.findMany({
      where: { eventId, status: { not: "cancelled" } },
      include: {
        artist: { include: { user: { select: { email: true } } } },
        invoice: { select: { number: true, status: true, total: true } },
      },
      orderBy: { startAt: "asc" },
    });

    const esc = (v: unknown) => `"${String(v ?? "").replace(/"/g, '""')}"`;
    const lines = [
      "slot,starts_at,dj,email,fee,status,completed_at,invoice_number,invoice_status,invoice_total",
      ...bookings.map((b) =>
        [
          esc(b.slot),
          esc(b.startAt.toISOString()),
          esc(b.artist.stageName),
          esc(b.artist.user.email),
          b.performanceFee,
          b.status,
          esc(b.completedAt?.toISOString() ?? ""),
          esc(b.invoice?.number ?? ""),
          esc(b.invoice?.status ?? ""),
          b.invoice?.total ?? "",
        ].join(","),
      ),
    ];
    res.setHeader("Content-Type", "text/csv; charset=utf-8");
    res.setHeader("Content-Disposition", `attachment; filename="dj-spend-${eventId}.csv"`);
    res.send(lines.join("\n"));
  }

  /** Capacity pacing: upcoming events vs the rsvps their predecessor had at the same point. */
  async pacing(user: JwtUser) {
    const events = await prisma.event.findMany({
      where: {
        status: { in: ["approved", "live"] },
        date: { gte: new Date() },
        ...(user.role === "admin" ? {} : { promoterId: user.sub }),
      },
      include: { _count: { select: { guestLists: true } } },
      orderBy: { date: "asc" },
    });
    const results = [];
    for (const e of events) {
      const previous = await prisma.event.findFirst({
        where: { promoterId: e.promoterId, date: { lt: e.date } },
        include: { _count: { select: { guestLists: true } } },
        orderBy: { date: "desc" },
      });
      const rsvps = e._count.guestLists;
      const previousRsvps = previous?._count.guestLists ?? null;
      results.push({
        eventId: e.id,
        title: e.title,
        date: e.date,
        rsvps,
        previousRsvps,
        ratio: previousRsvps ? +(rsvps / previousRsvps).toFixed(2) : null,
        alert: previousRsvps ? rsvps >= previousRsvps * 2 : false,
      });
    }
    return results;
  }
}
