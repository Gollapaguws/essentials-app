import { Controller, Get, UseGuards } from "@nestjs/common";
import { Throttle } from "@nestjs/throttler";
import { MFA_REQUIRED_ROLES, SupabaseAuthGuard } from "./supabase-auth.guard";
import { CurrentUser } from "../common/auth.decorator";
import type { VerifiedSession } from "./supabase-token.service";
import { SkipMfa } from "../common/skip-mfa.decorator";

interface RequestIdentity extends VerifiedSession {
  id?: string | null;
}

@Controller("auth")
export class AuthController {
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
    return {
      user: {
        sub: session.sub,
        id: session.id ?? session.sub,
        email: session.email,
        role,
        aal: session.aal,
      },
      // This route skips the aal1 gate so a privileged account can still discover
      // its role; report the gate it is about to hit instead of a blanket false.
      mfaRequired: Boolean(role && MFA_REQUIRED_ROLES.has(role) && session.aal !== "aal2"),
    };
  }
}
