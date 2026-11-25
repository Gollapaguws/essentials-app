import { HttpException, HttpStatus, Injectable } from "@nestjs/common";
import { prisma } from "@essentials/db";
import { asEntitlements, monthStart } from "./billing.service";

export interface Allowance {
  metric: string;
  limit: number;
  used: number;
  remaining: number;
}

/** 402 with the numbers the dashboard needs to show an upgrade prompt. */
export class PaymentRequiredException extends HttpException {
  constructor(allowance: Allowance, requested: number) {
    super(
      {
        statusCode: HttpStatus.PAYMENT_REQUIRED,
        code: "payment_required",
        message: `The ${allowance.metric} allowance for this period does not cover this request.`,
        metric: allowance.metric,
        limit: allowance.limit,
        used: allowance.used,
        remaining: allowance.remaining,
        requested,
      },
      HttpStatus.PAYMENT_REQUIRED,
    );
  }
}

/**
 * The allowance gate. Plans carry a metric -> monthly limit map; a metric the
 * plan does not mention is not metered and is always allowed, which keeps the
 * basic plan and every unlisted feature working without a flag.
 *
 * This reads counters; it never writes one. Feature services record usage after
 * the work succeeds, so a refused request cannot consume an allowance.
 */
@Injectable()
export class EntitlementsService {
  /** The plan's limit and this period's use, or null when the metric is unmetered. */
  async allowance(orgId: string, metric: string): Promise<Allowance | null> {
    const subscription = await prisma.subscription.findUnique({
      where: { orgId },
      select: { currentPeriodStart: true, plan: { select: { entitlements: true } } },
    });
    const entitlements = asEntitlements(subscription?.plan.entitlements);
    const limit = entitlements[metric];
    if (limit === undefined) return null;

    const periodStart = subscription?.currentPeriodStart ?? monthStart();
    const counter = await prisma.usageCounter.findUnique({
      where: { orgId_metric_periodStart: { orgId, metric, periodStart } },
      select: { used: true },
    });
    const used = counter?.used ?? 0;
    return { metric, limit, used, remaining: Math.max(0, limit - used) };
  }

  /**
   * Refuse the request when `amount` more uses would pass the limit.
   *
   * Returns the allowance (null when unmetered) so a caller that wants to warn
   * near the limit can read it without a second query.
   */
  async check(orgId: string, metric: string, amount = 1): Promise<Allowance | null> {
    const allowance = await this.allowance(orgId, metric);
    if (!allowance) return null;
    if (allowance.used + amount > allowance.limit) {
      throw new PaymentRequiredException(allowance, amount);
    }
    return allowance;
  }
}
