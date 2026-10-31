import { Injectable, ForbiddenException, NotFoundException } from "@nestjs/common";
import { prisma } from "@essentials/db";
import type { JwtUser } from "../common/roles.guard";
import type { Response } from "express";

/** Phase 4.5 promoter QoL: event cloning, guest-list export, capacity pacing. */
@Injectable()
export class EventToolsService {
  /** Clone an event (+7 days, draft status) for the owning promoter. */
  async clone(user: JwtUser, eventId: string) {
    const event = await prisma.event.findUnique({ where: { id: eventId } });
    if (!event) throw new NotFoundException("Event not found");
    if (user.role !== "admin" && event.promoterId !== user.sub) throw new ForbiddenException();

    const cloned = await prisma.event.create({
      data: {
        venueId: event.venueId,
        promoterId: event.promoterId,
        title: `${event.title} (copy)`,
        description: event.description,
        date: new Date(event.date.getTime() + 7 * 86_400_000),
        lineup: event.lineup ?? [],
        capacity: event.capacity,
        dressCode: event.dressCode,
        ticketUrl: event.ticketUrl,
        status: "draft",
        revenueSplitPromoterPct: event.revenueSplitPromoterPct,
        genres: event.genres,
      },
    });
    if (await prisma.eventGroupChat.findUnique({ where: { eventId: cloned.id } }).then((c) => !c)) {
      await prisma.eventGroupChat.create({ data: { eventId: cloned.id } }).catch(() => null);
    }
    return cloned;
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
