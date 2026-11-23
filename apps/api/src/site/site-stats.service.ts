import { Injectable, BadRequestException } from "@nestjs/common";
import { prisma } from "@essentials/db";
import type { JwtUser } from "../common/roles.guard";
import { PRIVACY_POLICY_VERSION } from "../common/privacy";

export const SITE_EVENTS = [
  "install_banner_dismiss",
  "install_prompt_open",
  "app_install",
] as const;

export type SiteEventName = (typeof SITE_EVENTS)[number];

/** Public analytics beacon + privacy data export support. */
@Injectable()
export class SiteStatsService {
  private visitorKey(day: string, ip: string) {
    return Buffer.from(`${day}:${ip}`).toString("base64").slice(0, 32);
  }

  /** Pageview beacon from the front page (no cookies, no PII beyond a daily hash). */
  async recordVisit(path: string, ip: string) {
    const day = new Date().toISOString().slice(0, 10);
    const visitorKey = this.visitorKey(day, ip);
    await prisma.siteVisit.upsert({
      where: { visitorKey_path_day: { visitorKey, path: path.slice(0, 100), day } },
      update: { views: { increment: 1 } },
      create: { visitorKey, path: path.slice(0, 100), day, views: 1 },
    }).catch(() => null);
    return { ok: true };
  }

  /**
   * Anonymous install-funnel event. The unique key means one count per visitor
   * per event per day even if the client retries the beacon.
   */
  async recordEvent(name: SiteEventName, ip: string) {
    const day = new Date().toISOString().slice(0, 10);
    await prisma.siteEvent.create({
      data: { name, visitorKey: this.visitorKey(day, ip), day },
    }).catch(() => null);
    return { ok: true };
  }

  /** Admin: daily views, top pages and install-funnel counts for the last 30 days. */
  async stats() {
    const since = new Date(Date.now() - 29 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
    const [rows, eventRows, pathRows] = await Promise.all([
      prisma.siteVisit.groupBy({
        by: ["day"],
        where: { day: { gte: since } },
        _sum: { views: true },
        _count: { visitorKey: true },
        orderBy: { day: "desc" },
        take: 30,
      }),
      prisma.siteEvent.groupBy({
        by: ["name"],
        where: { day: { gte: since }, name: { in: [...SITE_EVENTS] } },
        _count: { _all: true },
      }),
      prisma.siteVisit.groupBy({
        by: ["path"],
        where: { day: { gte: since } },
        _sum: { views: true },
        orderBy: { _sum: { views: "desc" } },
        take: 10,
      }),
    ]);

    const events: Record<SiteEventName, number> = {
      install_banner_dismiss: 0,
      install_prompt_open: 0,
      app_install: 0,
    };
    for (const row of eventRows) {
      if (row.name in events) events[row.name as SiteEventName] = row._count._all;
    }

    return {
      since,
      days: rows.map((r) => ({
        day: r.day,
        views: r._sum.views ?? 0,
        uniqueVisitors: r._count.visitorKey,
      })),
      paths: pathRows.map((r) => ({
        path: r.path,
        views: r._sum.views ?? 0,
      })),
      events,
    };
  }

  /** POPIA/GDPR data export: the authenticated person's account and activity record. */
  async myData(user: JwtUser) {
    const u = await prisma.user.findUnique({
      where: { id: user.sub },
      include: {
        guestLists: { include: { event: { select: { title: true, date: true } } } },
        loyaltyVisits: true,
        referralsGiven: { select: { refereeEmail: true, rewardIssued: true, createdAt: true } },
        artistProfile: {
          include: {
            bookings: {
              include: {
                event: { select: { title: true, date: true } },
                invoice: { include: { items: true, payments: true } },
              },
            },
            liveBookings: true,
            invoices: {
              include: {
                items: true,
                payments: true,
                venue: { select: { name: true } },
              },
            },
          },
        },
      },
    });
    if (!u) throw new BadRequestException("No account");
    return {
      exportedAt: new Date().toISOString(),
      privacyPolicyVersion: PRIVACY_POLICY_VERSION,
      ...u,
    };
  }
}
