import {
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
} from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import type { Role } from "@prisma/client";
import { AuthUserService } from "./auth-user.service";
import { SupabaseTokenService } from "./supabase-token.service";
import { SKIP_MFA_KEY } from "../common/skip-mfa.decorator";

/** Roles that must present an aal2 (MFA-satisfied) session on data endpoints. */
export const MFA_REQUIRED_ROLES: ReadonlySet<Role> = new Set<Role>(["promoter", "venue_manager", "admin"]);

@Injectable()
export class SupabaseAuthGuard implements CanActivate {
  constructor(
    private readonly tokens: SupabaseTokenService,
    private readonly users: AuthUserService,
    private readonly reflector: Reflector,
  ) {}

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    const req = ctx.switchToHttp().getRequest();
    const header: unknown = req.headers?.authorization;
    if (typeof header !== "string" || !header.startsWith("Bearer ")) {
      throw new UnauthorizedException("Missing bearer token");
    }

    const session = await this.tokens.verify(header.slice(7).trim());

    const skipMfa = this.reflector.getAllAndOverride<boolean>(SKIP_MFA_KEY, [
      ctx.getHandler(),
      ctx.getClass(),
    ]);
    const role = session.role ?? (await this.users.resolveRole(session.sub, session.email));

    if (!skipMfa && role && MFA_REQUIRED_ROLES.has(role) && session.aal !== "aal2") {
      throw new UnauthorizedException({ code: "MFA_REQUIRED", role });
    }

    req.user = { ...session, role };
    return true;
  }
}
