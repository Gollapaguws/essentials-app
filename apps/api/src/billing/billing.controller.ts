import { Controller, ForbiddenException, Get, UseGuards } from "@nestjs/common";
import { SupabaseAuthGuard } from "../auth/supabase-auth.guard";
import { Auth, CurrentUser } from "../common/auth.decorator";
import type { JwtUser } from "../common/roles.guard";
import { BillingService } from "./billing.service";

/**
 * Plans, the active workspace's subscription, and usage counters.
 *
 * Read-only on purpose: Phase 1 has no checkout and no plan changes from the
 * dashboard. An admin can see every workspace; everyone else sees only the one
 * they are acting in.
 */
@Controller("billing")
@UseGuards(SupabaseAuthGuard)
export class BillingController {
  constructor(private readonly billing: BillingService) {}

  @Get("plans")
  @Auth("promoter", "venue_manager", "admin")
  plans() {
    return this.billing.plans();
  }

  @Get("me")
  @Auth("promoter", "venue_manager", "admin")
  me(@CurrentUser() user: JwtUser) {
    if (!user.orgId) throw new ForbiddenException("No workspace is attached to this account.");
    return this.billing.summaryFor(user.orgId);
  }

  @Get("overview")
  @Auth("admin")
  overview() {
    return this.billing.overview();
  }
}
