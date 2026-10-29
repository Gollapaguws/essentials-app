import { Injectable, BadRequestException } from "@nestjs/common";
import { prisma } from "@essentials/db";
import type { JwtUser } from "../common/roles.guard";

const LOYALTY_TARGET = 5; // 5 visits -> free entry

@Injectable()
export class LoyaltyService {
  /** "3/5 events — 2 to free entry" */
  async status(user: JwtUser) {
    const visits = await prisma.loyaltyVisit.count({ where: { userId: user.sub, freeEntryAwarded: false } });
    const total = await prisma.loyaltyVisit.count({ where: { userId: user.sub } });
    const freeEntries = Math.floor(total / LOYALTY_TARGET);
    return {
      visits: total,
      cycleVisits: visits,
      target: LOYALTY_TARGET,
      remaining: Math.max(0, LOYALTY_TARGET - visits),
      freeEntries,
      label: `${visits}/${LOYALTY_TARGET} events — ${Math.max(0, LOYALTY_TARGET - visits)} to free entry`,
    };
  }

  /** Personal invite link + referral rewards tracking. */
  async referralInfo(user: JwtUser, appUrl: string) {
    const userRow = await prisma.user.findUnique({ where: { id: user.sub } });
    const referrals = await prisma.referral.findMany({
      where: { referrerId: user.sub },
      orderBy: { createdAt: "desc" },
    });
    return {
      code: userRow?.referralCode,
      link: `${appUrl}/invite/${userRow?.referralCode}`,
      invited: referrals.length,
      rewarded: referrals.filter((r) => r.rewardIssued).length,
      rewards: referrals.map((r) => ({ refereeEmail: r.refereeEmail, rewardType: r.rewardType, issued: r.rewardIssued })),
    };
  }

  /** Called when a referred guest checks in — progresses referrer's rewards. */
  async recordVisit(userId: string, eventId: string) {
    if (await prisma.loyaltyVisit.findUnique({ where: { userId_eventId: { userId, eventId } } })) return;
    const count = await prisma.loyaltyVisit.count({ where: { userId } });
    await prisma.loyaltyVisit.create({
      data: { userId, eventId, visits: count + 1, freeEntryAwarded: (count + 1) % LOYALTY_TARGET === 0 },
    });
  }
}
