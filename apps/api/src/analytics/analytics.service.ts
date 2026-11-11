import { Injectable, ForbiddenException } from "@nestjs/common";
import { prisma, GuestListStatus } from "@essentials/db";
import type { JwtUser } from "../common/roles.guard";

@Injectable()
export class AnalyticsService {
  /** Promoter dashboard overview. All queries scoped to the promoter's events. */
  async overview(user: JwtUser) {
    if (user.role !== "promoter" && user.role !== "admin") throw new ForbiddenException();
    const promoterFilter = user.role === "admin" ? {} : { promoterId: user.sub };

    const events = await prisma.event.findMany({
      where: promoterFilter,
      include: {
        venue: { select: { id: true, name: true } },
        guestLists: true,
      },
      orderBy: { date: "asc" },
    });

    let rsvps = 0, checkedIn = 0, waitlisted = 0;
    const perEvent = events.map((e) => {
      const attending = e.guestLists.filter((g) => g.status === GuestListStatus.attending).length;
      const checked = e.guestLists.filter((g) => g.status === GuestListStatus.checked_in).length;
      const noShows = attending - checked;
      rsvps += e.guestLists.length; checkedIn += checked; waitlisted += e.guestLists.filter((g) => g.status === "waitlisted").length;
      return {
        name: e.title,
        date: e.date,
        rsvps: e.guestLists.length,
        door: checked,
        noShows,
        conversion: attending ? +(checked / attending).toFixed(2) : 0,
      };
    });

    const byVenue = Object.values(
      events.reduce<Record<string, { venue: string; events: number; rsvps: number }>>((acc, e) => {
        acc[e.venue.id] ??= { venue: e.venue.name, events: 0, rsvps: 0 };
        acc[e.venue.id].events++;
        acc[e.venue.id].rsvps += e.guestLists.length;
        return acc;
      }, {}),
    );

    return {
      totals: {
        events: events.length,
        rsvps,
        checkedIn,
        waitlisted,
        noShowRate: checkedIn ? +(((rsvps - checkedIn) / rsvps) * 100).toFixed(1) : 0,
        listToDoorConversion: attending0(rsvps, checkedIn),
      },
      perEvent,
      perVenue: byVenue,
    };
  }

  /**
   * Upcoming events whose RSVPs are at least 2x the promoter's previous event.
   * One pass over the promoter's events keeps this from being a query per row.
   */
  async pacing(user: JwtUser) {
    if (user.role !== "promoter" && user.role !== "admin") throw new ForbiddenException();
    const promoterFilter = user.role === "admin" ? {} : { promoterId: user.sub };

    const events = await prisma.event.findMany({
      where: promoterFilter,
      include: { _count: { select: { guestLists: true } } },
      orderBy: { date: "asc" },
    });

    const now = new Date();
    const previousRsvpsByPromoter = new Map<string, number>();
    const rows = [];
    for (const e of events) {
      const previousRsvps = previousRsvpsByPromoter.get(e.promoterId) ?? null;
      const upcoming = e.date >= now && (e.status === "approved" || e.status === "live");
      if (upcoming) {
        const rsvps = e._count.guestLists;
        rows.push({
          eventId: e.id,
          title: e.title,
          date: e.date,
          rsvps,
          previousRsvps,
          ratio: previousRsvps ? +(rsvps / previousRsvps).toFixed(2) : null,
          alert: previousRsvps ? rsvps >= previousRsvps * 2 : false,
        });
      }
      previousRsvpsByPromoter.set(e.promoterId, e._count.guestLists);
    }
    return rows;
  }
}

function attending0(rsvps: number, checkedIn: number) {
  return rsvps ? +((checkedIn / rsvps) * 100).toFixed(1) : 0;
}
