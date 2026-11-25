import { CanActivate, ExecutionContext, Injectable, UnauthorizedException } from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import type { JwtUser } from "../common/roles.guard";
import { EntitlementsService } from "./entitlements.service";
import { ENTITLEMENT_KEY, type EntitlementRequirement } from "./entitlement.decorator";

/**
 * Applies `@RequiresEntitlement` by asking the active workspace's plan.
 *
 * It must run after authentication, because it reads `request.user.orgId`. A
 * controller-level `SupabaseAuthGuard` or an `@Auth(...)` decorator provides
 * that; a guard failure here is a 402, not a 401.
 */
@Injectable()
export class EntitlementsGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly entitlements: EntitlementsService,
  ) {}

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    const required = this.reflector.getAllAndOverride<EntitlementRequirement | undefined>(
      ENTITLEMENT_KEY,
      [ctx.getHandler(), ctx.getClass()],
    );
    if (!required) return true;

    const { user } = ctx.switchToHttp().getRequest<{ user?: JwtUser }>();
    if (!user) throw new UnauthorizedException("Not authenticated");
    // Accounts without a workspace (guests, DJs) have nothing to meter, and no
    // route that requires an entitlement is open to them.
    if (!user.orgId) return true;

    await this.entitlements.check(user.orgId, required.metric, required.amount);
    return true;
  }
}
