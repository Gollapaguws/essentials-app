import { SetMetadata, UseGuards, applyDecorators } from "@nestjs/common";
import { EntitlementsGuard } from "./entitlements.guard";

export const ENTITLEMENT_KEY = "entitlement";

export interface EntitlementRequirement {
  metric: string;
  amount: number;
}

/**
 * Refuse this route with **402 Payment Required** when the active workspace has
 * used up its allowance for `metric` in the current period. The response carries
 * `metric`, `limit`, `used` and `remaining` so the dashboard can show an upgrade
 * prompt instead of a generic error.
 *
 * Use it on an authenticated route — alongside `@Auth(...)` or a
 * controller-level `SupabaseAuthGuard`, which resolves the workspace first.
 * A metric the plan does not limit is always allowed.
 */
export function RequiresEntitlement(metric: string, amount = 1) {
  return applyDecorators(
    SetMetadata(ENTITLEMENT_KEY, { metric, amount } satisfies EntitlementRequirement),
    UseGuards(EntitlementsGuard),
  );
}
