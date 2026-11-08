import {
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
} from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import type { Role } from "@prisma/client";
import { SupabaseTokenService } from "./supabase-token.service";
import { AuthUserService } from "./auth-user.service";
import { SKIP_MFA_KEY } from "../common/skip-mfa.decorator";

/** Roles that must present an aal2 (MFA-satisfied) session on data endpoints. */
export const MFA_REQUIRED_ROLES: ReadonlySet<Role> = new Set<Role>(["promoter", "venue_manager", "admin"]);

@Injectable()
export class SupabaseAuthGuard implements CanActivate {
  constructor(
    private readonly tokens: SupabaseTokenService,
    private readonly authUsers: AuthUserService,
    private readonly reflector: Reflector,
  ) {}

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    const req = ctx.switchToHttp().getRequest();
    const header: unknown = req.headers?.authorization;
    if (typeof header !== "string" || !header.startsWith("Bearer ")) {
      throw new UnauthorizedException("Missing bearer token");
    }

    const session = await this.tokens.verify(header.slice(7).trim());

    // Prisma is the source of truth for both identity and role: an admin's
    // promotion applies immediately instead of waiting for a new token.
    const identity = await this.authUsers.resolveUser(session.sub, session.email);
    const role = (identity?.role ?? session.role ?? null) as Role;

    const skipMfa = this.reflector.getAllAndOverride<boolean>(SKIP_MFA_KEY, [
      ctx.getHandler(),
      ctx.getClass(),
    ]);

    if (!skipMfa && role && MFA_REQUIRED_ROLES.has(role) && session.aal !== "aal2") {
      throw new UnauthorizedException({ code: "MFA_REQUIRED", role });
    }

    // Every controller treats `sub` as the Prisma User id (owners, promoterId,
    // guestList.userId...). Keep the Supabase uid available as `authUid`.
    // Sessions are owned by Supabase (short-lived JWTs verified above); the
    // AuthUserService cache below only holds id/role for 60s and is invalidated
    // on role changes, so it is not a session store and must not be cleared per
    // request — that would turn every authenticated call into a DB lookup.
    req.user = {
      ...session,
      sub: identity?.id ?? session.sub,
      id: identity?.id ?? null,
      authUid: session.sub,
      role,
      mustResetPassword: identity?.mustResetPassword ?? false,
    };
    return true;
  }
}
