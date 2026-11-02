import { Controller, Post, Body, Get, HttpCode, UseGuards, Ip } from "@nestjs/common";
import { Throttle } from "@nestjs/throttler";
import { AuthService } from "./auth.service";
import { AuthUserService } from "./auth-user.service";
import { AuthEventsService } from "./auth-events.service";
import { MFA_REQUIRED_ROLES, SupabaseAuthGuard } from "./supabase-auth.guard";
import type { VerifiedSession } from "./supabase-token.service";
import { RedeemInviteDto, SessionEstablishedDto } from "./auth.dto";
import { AuthRateGuard } from "../common/auth-rate.guard";
import { CurrentUser } from "../common/auth.decorator";
import { SkipMfa } from "../common/skip-mfa.decorator";

@Controller("auth")
export class AuthController {
  constructor(
    private auth: AuthService,
    private authUsers: AuthUserService,
    private events: AuthEventsService,
  ) {}

  /**
   * Canonical identity for a Supabase session.
   * Lazy-links the Prisma user; `inviteRequired` when there is no account yet.
   * `mfaRequired` lets a client route a privileged aal1 user to enrollment.
   */
  @Get("me")
  @UseGuards(SupabaseAuthGuard)
  @SkipMfa()
  @Throttle({ default: { limit: 30, ttl: 60_000 } })
  async me(@CurrentUser() session: VerifiedSession) {
    const linked = await this.authUsers.ensureUser(session);
    return {
      user: {
        sub: session.sub,
        email: linked.user.email,
        role: linked.user.role,
        aal: session.aal,
      },
      mfaRequired: MFA_REQUIRED_ROLES.has(linked.user.role) && session.aal !== "aal2",
    };
  }

  /** Audit-only handshake after a client establishes a session. */
  @Post("session-established")
  @HttpCode(200)
  @UseGuards(SupabaseAuthGuard)
  @SkipMfa()
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  async sessionEstablished(
    @CurrentUser() session: VerifiedSession,
    @Body() dto: SessionEstablishedDto,
    @Ip() ip: string,
  ) {
    await this.events.record("sign_in", {
      email: session.email,
      ip,
      meta: { surface: dto.surface ?? "web", aal: session.aal },
    });
    return { ok: true };
  }

}
