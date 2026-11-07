import { Injectable, BadRequestException } from "@nestjs/common";
import { prisma } from "@essentials/db";
import type { JwtUser } from "../common/roles.guard";

/** Public analytics beacon + privacy data export support. */
@Injectable()
export class SiteStatsService {
  /** Pageview beacon from the front page (no cookies, no PII beyond a daily hash). */
  async recordVisit(path: string, ip: string) {
    const day = new Date().toISOString().slice(0, 10);
    const visitorKey = Buffer.from(`${day}:${ip}`).toString("base64").slice(0, 32);
    await prisma.siteVisit.upsert({
      where: { visitorKey_path_day: { visitorKey, path: path.slice(0, 100), day } },
      update: { views: { increment: 1 } },
      create: { visitorKey, path: path.slice(0, 100), day, views: 1 },
    }).catch(() => null);
    return { ok: true };
  }

  /** Admin: daily views for the last 30 days. */
  async stats() {
    const rows = await prisma.siteVisit.groupBy({
      by: ["day"],
      _sum: { views: true },
      _count: { visitorKey: true },
      orderBy: { day: "desc" },
      take: 30,
    });
    return rows.map((r) => ({ day: r.day, views: r._sum.views ?? 0, uniqueVisitors: r._count.visitorKey }));
  }

  /** POPIA data export: everything we hold about the authenticated user. */
  async myData(user: JwtUser) {
    const u = await prisma.user.findUnique({
      where: { id: user.sub },
      include: {
        guestLists: { include: { event: { select: { title: true, date: true } } } },
        loyaltyVisits: true,
        referralsGiven: { select: { refereeEmail: true, rewardIssued: true, createdAt: true } },
        consentRecords: true,
      },
    });
    if (!u) throw new BadRequestException("No account");
    return u;
  }
}
