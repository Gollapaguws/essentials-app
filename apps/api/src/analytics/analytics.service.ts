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
        tableBookings: true,
      },
      orderBy: { date: "asc" },
    });

    let rsvps = 0, checkedIn = 0, waitlisted = 0, tableRevenue = 0;
    const perEvent = events.map((e) => {
      const attending = e.guestLists.filter((g) => g.status === GuestListStatus.attending).length;
      const checked = e.guestLists.filter((g) => g.status === GuestListStatus.checked_in).length;
      const noShows = attending - checked;
      const rev = e.tableBookings.reduce((s, b) => s + b.value, 0);
      rsvps += e.guestLists.length; checkedIn += checked; waitlisted += e.guestLists.filter((g) => g.status === "waitlisted").length;
      tableRevenue += rev;
      return {
        name: e.title,
        date: e.date,
        rsvps: e.guestLists.length,
        door: checked,
        noShows,
        tableRevenue: rev,
        conversion: attending ? +(checked / attending).toFixed(2) : 0,
      };
    });

    const byVenue = Object.values(
      events.reduce<Record<string, { venue: string; events: number; tableRevenue: number; rsvps: number }>>((acc, e) => {
        acc[e.venue.id] ??= { venue: e.venue.name, events: 0, tableRevenue: 0, rsvps: 0 };
        acc[e.venue.id].events++;
        acc[e.venue.id].tableRevenue += e.tableBookings.reduce((s, b) => s + b.value, 0);
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
        tableRevenue,
      },
      perEvent,
      perVenue: byVenue,
    };
  }
}

function attending0(rsvps: number, checkedIn: number) {
  return rsvps ? +((checkedIn / rsvps) * 100).toFixed(1) : 0;
}
