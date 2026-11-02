import { Controller, Get, HttpCode, Post, UseGuards } from "@nestjs/common";
import { Throttle } from "@nestjs/throttler";
import { MFA_REQUIRED_ROLES, SupabaseAuthGuard } from "./supabase-auth.guard";
import { AuthUserService } from "./auth-user.service";
import { CurrentUser } from "../common/auth.decorator";
import type { VerifiedSession } from "./supabase-token.service";
import { SkipMfa } from "../common/skip-mfa.decorator";

interface RequestIdentity extends VerifiedSession {
  id?: string | null;
  mustResetPassword?: boolean;
}

@Controller("auth")
export class AuthController {
  constructor(private readonly authUsers: AuthUserService) {}

  /**
   * Canonical identity for a Supabase session. The guard has already created or
   * linked the Prisma account, so the role here is the one every endpoint uses.
   */
  @Get("me")
  @UseGuards(SupabaseAuthGuard)
  @SkipMfa()
  @Throttle({ default: { limit: 30, ttl: 60_000 } })
  me(@CurrentUser() session: RequestIdentity) {
    const role = session.role ?? null;
    const mustResetPassword = Boolean(session.mustResetPassword);
    return {
      user: {
        sub: session.sub,
        id: session.id ?? session.sub,
        email: session.email,
        role,
        aal: session.aal,
        mustResetPassword,
      },
      // This route skips the aal1 gate so a privileged account can still discover
      // its role; report the gate it is about to hit instead of a blanket false.
      mfaRequired: Boolean(role && MFA_REQUIRED_ROLES.has(role) && session.aal !== "aal2"),
      mustResetPassword,
    };
  }

  /**
   * Called after the client sets its own Supabase password, so the first-login
   * gate cannot be re-entered on the next sign-in.
   */
  @Post("password/complete")
  @UseGuards(SupabaseAuthGuard)
  @SkipMfa()
  @HttpCode(200)
  async completePasswordReset(@CurrentUser() session: RequestIdentity) {
    await this.authUsers.clearPasswordReset(session.id ?? session.sub);
    return { mustResetPassword: false };
  }
}
