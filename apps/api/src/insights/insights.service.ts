import { Injectable, ForbiddenException } from "@nestjs/common";
import { prisma } from "@essentials/db";
import type { JwtUser } from "../common/roles.guard";

/**
 * Phase 4 advanced analytics (excludes multi-promoter onboarding & white-label).
 * - LTV: per-guest lifetime value = table bookings spend + estimated door spend
 *   (door cover estimate configurable) + loyalty free-entry cost offset.
 * - Cohorts: guests bucketed by first check-in month, retention = share of the
 *   cohort that checked in during each subsequent month.
 */
@Injectable()
export class InsightsService {
  async ltv(user: JwtUser) {
    if (user.role !== "promoter" && user.role !== "admin") throw new ForbiddenException();
    const promoterFilter = user.role === "admin" ? {} : { event: { promoterId: user.sub } };

    const guests = await prisma.user.findMany({
      where: { role: "guest" },
      include: {
        tableBookings: { where: promoterFilter },
        guestLists: { where: { ...promoterFilter, status: "checked_in" }, include: { event: { select: { date: true } } } },
      },
    });

    const doorCoverEstimate = 150; // estimated avg cover spend per attended night
    const rows = guests
      .map((g) => {
        const tableSpend = g.tableBookings.reduce((s, b) => s + b.value, 0);
        const doorSpend = g.guestLists.length * doorCoverEstimate;
        const firstVisit = g.guestLists.map((gl) => gl.event.date).sort()[0] ?? null;
        return {
          userId: g.id,
          name: g.name,
          email: g.email,
          visits: g.guestLists.length,
          firstVisit,
          tableSpend,
          doorSpend,
          ltv: tableSpend + doorSpend,
        };
      })
      .sort((a, b) => b.ltv - a.ltv);

    return {
      averageLtv: rows.length ? Math.round(rows.reduce((s, r) => s + r.ltv, 0) / rows.length) : 0,
      topGuests: rows.slice(0, 10),
    };
  }

  /** Monthly cohorts with 6-month retention curve. */
  async cohorts(user: JwtUser) {
    if (user.role !== "promoter" && user.role !== "admin") throw new ForbiddenException();
    const promoterFilter = user.role === "admin" ? {} : { event: { promoterId: user.sub } };

    const checkins = await prisma.guestList.findMany({
      where: { ...promoterFilter, status: "checked_in" },
      select: { userId: true, event: { select: { date: true } } },
    });

    const firstVisitByUser = new Map<string, Date>();
    for (const c of checkins) {
      const prev = firstVisitByUser.get(c.userId);
      if (!prev || c.event.date < prev) firstVisitByUser.set(c.userId, c.event.date);
    }
    const monthKey = (d: Date) => d.toISOString().slice(0, 7);

    const cohortMembers = new Map<string, Set<string>>();
    for (const [userId, date] of firstVisitByUser) {
      const k = monthKey(date);
      if (!cohortMembers.has(k)) cohortMembers.set(k, new Set());
      cohortMembers.get(k)!.add(userId);
    }

    // activity per user-month
    const activeMonths = new Map<string, Set<string>>();
    for (const c of checkins) {
      const k = `${monthKey(c.event.date)}`;
      if (!activeMonths.has(k)) activeMonths.set(k, new Set());
      activeMonths.get(k)!.add(c.userId);
    }

    const nowMonth = new Date().toISOString().slice(0, 7);
    const cohorts = [...cohortMembers.keys()].sort().map((cohort) => {
      const members = cohortMembers.get(cohort)!;
      const size = members.size;
      const retention: { month: number; pct: number }[] = [];
      for (let m = 0; m <= 6; m++) {
        const [y, mo] = cohort.split("-").map(Number);
        const target = monthKey(new Date(Date.UTC(y, mo - 1 + m, 1)));
        if (target > nowMonth) break;
        const active = [...members].filter((u) => activeMonths.get(target)?.has(u)).length;
        retention.push({ month: m, pct: size ? Math.round((active / size) * 100) : 0 });
      }
      return { cohort, size, retention };
    });

    return cohorts;
  }
}
