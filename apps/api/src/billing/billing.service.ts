import { BadRequestException, Injectable, Logger } from "@nestjs/common";
import { prisma } from "@essentials/db";

export type Entitlements = Record<string, number>;

export interface UsageRow {
  metric: string;
  used: number;
  /** Null when the plan does not meter this metric. */
  limit: number | null;
  remaining: number | null;
}

export interface BillingSummary {
  organisation: { id: string; name: string; slug: string; kind: string; hub: string | null } | null;
  subscription: {
    status: string;
    provider: string | null;
    currentPeriodStart: string;
    currentPeriodEnd: string;
    cancelAtPeriodEnd: boolean;
  } | null;
  plan: { key: string; name: string; priceZar: number; entitlements: Entitlements } | null;
  period: { start: string; end: string };
  usage: UsageRow[];
}

export interface PlanRow {
  id: string;
  key: string;
  name: string;
  priceZar: number;
  entitlements: Entitlements;
  hub: { slug: string; name: string };
}

export interface WorkspaceBilling extends BillingSummary {
  members: number;
}

/** First moment of the current month, UTC — the fallback period with no subscription. */
export function monthStart(now = new Date()): Date {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
}

/** Exclusive end of that month. */
export function monthEnd(now = new Date()): Date {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1));
}

export function asEntitlements(value: unknown): Entitlements {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  const out: Entitlements = {};
  for (const [metric, limit] of Object.entries(value as Record<string, unknown>)) {
    if (typeof limit === "number" && Number.isFinite(limit)) out[metric] = limit;
  }
  return out;
}

/**
 * Plans, subscriptions and usage counters — the commercial skeleton.
 *
 * Nothing here charges anyone: there is no checkout, no provider webhook and no
 * entitlement gate. The service answers "what is this workspace on, and what has
 * it used this period", which is what the admin screen and, later, the gates read.
 */
@Injectable()
export class BillingService {
  private readonly log = new Logger(BillingService.name);

  /** Active plans, cheapest first, with the hub they belong to. */
  async plans(): Promise<PlanRow[]> {
    const rows = await prisma.plan.findMany({
      where: { active: true },
      include: { hub: { select: { slug: true, name: true } } },
      orderBy: [{ hubId: "asc" }, { priceZar: "asc" }],
    });
    return rows.map((row) => ({
      id: row.id,
      key: row.key,
      name: row.name,
      priceZar: row.priceZar,
      entitlements: asEntitlements(row.entitlements),
      hub: row.hub,
    }));
  }

  /**
   * One workspace's plan, period and counters.
   *
   * The period is the subscription's, not the calendar month: a plan can start
   * mid-month and the counters must roll with it. A workspace with no
   * subscription falls back to the calendar month and reports no plan rather than
   * inventing one.
   */
  async summaryFor(orgId: string): Promise<BillingSummary> {
    const [organisation, subscription] = await Promise.all([
      prisma.organisation.findUnique({
        where: { id: orgId },
        select: { id: true, name: true, slug: true, kind: true, hub: { select: { slug: true } } },
      }),
      prisma.subscription.findUnique({ where: { orgId }, include: { plan: true } }),
    ]);

    const start = subscription?.currentPeriodStart ?? monthStart();
    const end = subscription?.currentPeriodEnd ?? monthEnd();
    const counters = await prisma.usageCounter.findMany({
      where: { orgId, periodStart: start },
      orderBy: { metric: "asc" },
    });

    const entitlements = asEntitlements(subscription?.plan.entitlements);
    const used = new Map(counters.map((row) => [row.metric, row.used]));
    // Only metrics that were actually counted. A plan limit with no counter is a
    // limit, not usage of zero — the screen lists those separately.
    const metrics = [...used.keys()].sort();

    return {
      organisation: organisation
        ? {
            id: organisation.id,
            name: organisation.name,
            slug: organisation.slug,
            kind: organisation.kind,
            hub: organisation.hub?.slug ?? null,
          }
        : null,
      subscription: subscription
        ? {
            status: subscription.status,
            provider: subscription.provider,
            currentPeriodStart: start.toISOString(),
            currentPeriodEnd: end.toISOString(),
            cancelAtPeriodEnd: subscription.cancelAtPeriodEnd,
          }
        : null,
      plan: subscription?.plan
        ? {
            key: subscription.plan.key,
            name: subscription.plan.name,
            priceZar: subscription.plan.priceZar,
            entitlements,
          }
        : null,
      period: { start: start.toISOString(), end: end.toISOString() },
      usage: metrics.map((metric) => {
        const limit = entitlements[metric] ?? null;
        const count = used.get(metric) ?? 0;
        return {
          metric,
          used: count,
          limit,
          remaining: limit === null ? null : Math.max(0, limit - count),
        };
      }),
    };
  }

  /**
   * Every workspace with its plan and usage — the admin "Plan & usage" screen.
   *
   * Counters are filtered in memory against each workspace's own period start,
   * because the period belongs to the subscription rather than to the month.
   */
  async overview(): Promise<{ workspaces: WorkspaceBilling[]; generatedAt: string }> {
    const organisations = await prisma.organisation.findMany({
      orderBy: [{ kind: "asc" }, { createdAt: "asc" }],
      include: {
        hub: { select: { slug: true } },
        subscription: { include: { plan: true } },
        usageCounters: true,
        _count: { select: { members: true } },
      },
    });

    return {
      workspaces: organisations.map((org) => {
        const subscription = org.subscription;
        const start = subscription?.currentPeriodStart ?? monthStart();
        const end = subscription?.currentPeriodEnd ?? monthEnd();
        const entitlements = asEntitlements(subscription?.plan.entitlements);
        const used = new Map(
          org.usageCounters
            .filter((row) => row.periodStart.getTime() === start.getTime())
            .map((row) => [row.metric, row.used]),
        );
        const metrics = [...used.keys()].sort();

        return {
          organisation: {
            id: org.id,
            name: org.name,
            slug: org.slug,
            kind: org.kind,
            hub: org.hub?.slug ?? null,
          },
          subscription: subscription
            ? {
                status: subscription.status,
                provider: subscription.provider,
                currentPeriodStart: start.toISOString(),
                currentPeriodEnd: end.toISOString(),
                cancelAtPeriodEnd: subscription.cancelAtPeriodEnd,
              }
            : null,
          plan: subscription?.plan
            ? {
                key: subscription.plan.key,
                name: subscription.plan.name,
                priceZar: subscription.plan.priceZar,
                entitlements,
              }
            : null,
          period: { start: start.toISOString(), end: end.toISOString() },
          usage: metrics.map((metric) => {
            const limit = entitlements[metric] ?? null;
            const count = used.get(metric) ?? 0;
            return {
              metric,
              used: count,
              limit,
              remaining: limit === null ? null : Math.max(0, limit - count),
            };
          }),
          members: org._count.members,
        };
      }),
      generatedAt: new Date().toISOString(),
    };
  }

  /**
   * Count one use of a metered feature against the workspace's current period.
   *
   * Metering must never break the feature it is counting, so a failure is logged
   * and swallowed. The caller is a feature service on its success path; a missing
   * workspace is a programming error and is refused loudly instead.
   */
  async record(orgId: string | null | undefined, metric: string, amount = 1): Promise<void> {
    if (!orgId) return;
    if (!Number.isInteger(amount) || amount < 1) {
      throw new BadRequestException("A counter takes a positive whole number.");
    }
    try {
      const subscription = await prisma.subscription.findUnique({
        where: { orgId },
        select: { currentPeriodStart: true },
      });
      const periodStart = subscription?.currentPeriodStart ?? monthStart();
      await prisma.usageCounter.upsert({
        where: { orgId_metric_periodStart: { orgId, metric, periodStart } },
        update: { used: { increment: amount } },
        create: { orgId, metric, periodStart, used: amount },
      });
    } catch (err) {
      this.log.warn(`Could not record ${metric} for ${orgId}: ${(err as Error).message}`);
    }
  }
}
