import { Controller, Get, UseGuards } from "@nestjs/common";
import { Throttle } from "@nestjs/throttler";
import { SupabaseAuthGuard } from "./supabase-auth.guard";
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
    return {
      user: {
        sub: session.sub,
        id: session.id ?? session.sub,
        email: session.email,
        role: session.role ?? null,
        aal: session.aal,
      },
      mfaRequired: false,
    };
  }
}
