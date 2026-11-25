import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
  Logger,
  UnauthorizedException,
} from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import type { Role } from "@prisma/client";
import { SupabaseTokenService } from "./supabase-token.service";
import { AuthUserService } from "./auth-user.service";
import { DashboardSessionService } from "./dashboard-session.service";
import { PlatformService } from "../platform/platform.service";
import { SKIP_MFA_KEY } from "../common/skip-mfa.decorator";
import { SKIP_PASSWORD_RESET_KEY } from "../common/skip-password-reset.decorator";
import { ROLES_KEY } from "../common/roles.decorator";

/** Roles that must present an aal2 (MFA-satisfied) session on data endpoints. */
export const MFA_REQUIRED_ROLES: ReadonlySet<Role> = new Set<Role>(["promoter", "venue_manager", "admin"]);

@Injectable()
export class SupabaseAuthGuard implements CanActivate {
  private readonly logger = new Logger(SupabaseAuthGuard.name);

  constructor(
    private readonly tokens: SupabaseTokenService,
    private readonly authUsers: AuthUserService,
    private readonly sessions: DashboardSessionService,
    private readonly platform: PlatformService,
    private readonly reflector: Reflector,
  ) {}

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    const req = ctx.switchToHttp().getRequest();
    const header: unknown = req.headers?.authorization;

    // Two ways in: a bearer token (mobile app, public site, exports) or the
    // dashboard's server-side session cookie. The cookie path is what keeps the
    // dashboard's tokens out of the browser entirely.
    const session =
      typeof header === "string" && header.startsWith("Bearer ")
        ? await this.tokens.verify(header.slice(7).trim())
        : (await this.sessions.resolve(req)).session;

    // Prisma is the source of truth for both identity and role: an admin's
    // promotion applies immediately instead of waiting for a new token.
    const identity = await this.authUsers.resolveUser(session.sub, session.email);
    // Fail closed: a database outage must never fall back to the token's role
    // claim, which can preserve a role that has already been revoked.
    if (!identity) throw new UnauthorizedException("Account not found");
    const role = identity.role;

    const skipMfa = this.reflector.getAllAndOverride<boolean>(SKIP_MFA_KEY, [
      ctx.getHandler(),
      ctx.getClass(),
    ]);

    // Admin endpoints always need aal2: a per-account exemption must never let a
    // password alone reach account administration, even if the row was edited by
    // hand. Every other data route honours the exemption.
    const requiredRoles = this.reflector.getAllAndOverride<Role[]>(ROLES_KEY, [
      ctx.getHandler(),
      ctx.getClass(),
    ]);
    // "Admin route" means admin-only. `@Auth("promoter", "admin")` is a promoter
    // screen that admins may also open; counting it as an admin route locked
    // every exempt promoter out of their own applications, events and analytics.
    const adminOnly =
      Array.isArray(requiredRoles) &&
      requiredRoles.length > 0 &&
      requiredRoles.every((r) => r === "admin");
    const exempt = Boolean(identity.mfaDisabled) && !adminOnly;

    const skipPasswordReset = this.reflector.getAllAndOverride<boolean>(SKIP_PASSWORD_RESET_KEY, [
      ctx.getHandler(),
      ctx.getClass(),
    ]);
    if (!skipPasswordReset && identity.mustResetPassword) {
      throw new ForbiddenException({
        code: "PASSWORD_RESET_REQUIRED",
        message: "Choose your own password before using the account.",
      });
    }

    // An admin can exempt one account from the role's two-step requirement; the
    // exemption lives on the User row, so it applies to every client at once.
    if (!skipMfa && !exempt && role && MFA_REQUIRED_ROLES.has(role) && session.aal !== "aal2") {
      throw new UnauthorizedException({ code: "MFA_REQUIRED", role });
    }

    // The workspace this request acts in. A client may select one with
    // `x-org-id`; the service accepts it only when the account is a member, and
    // otherwise falls back to the account's own workspace. A membership lookup
    // failure must not turn sign-in into an outage: features then fall back to
    // their original owner-based scoping.
    const orgHeader = req.headers?.["x-org-id"];
    const requestedOrg = Array.isArray(orgHeader) ? orgHeader[0] : orgHeader;
    let orgId: string | null = null;
    try {
      orgId = await this.platform.activeOrgId(
        identity.id,
        role,
        session.email,
        typeof requestedOrg === "string" ? requestedOrg.trim() || undefined : undefined,
      );
    } catch (e) {
      this.logger.warn(`organisation context unavailable: ${(e as Error).message}`);
    }

    // Every controller treats `sub` as the Prisma User id (owners, promoterId,
    // guestList.userId...). Keep the Supabase uid available as `authUid`.
    // Sessions are owned by Supabase (short-lived JWTs verified above); the
    // AuthUserService cache below only holds id/role for 60s and is invalidated
    // on role changes, so it is not a session store and must not be cleared per
    // request — that would turn every authenticated call into a DB lookup.
    req.user = {
      ...session,
      sub: identity.id,
      id: identity.id,
      authUid: session.sub,
      role,
      orgId,
      mustResetPassword: identity.mustResetPassword,
      mfaDisabled: identity.mfaDisabled,
    };
    return true;
  }
}
