import { Controller, Post, Body, Get, Query, HttpCode, UseGuards, Ip } from "@nestjs/common";
import { AuthGuard } from "@nestjs/passport";
import { Throttle } from "@nestjs/throttler";
import { AuthService } from "./auth.service";
import { AuthUserService } from "./auth-user.service";
import { AuthEventsService } from "./auth-events.service";
import { MFA_REQUIRED_ROLES, SupabaseAuthGuard } from "./supabase-auth.guard";
import type { VerifiedSession } from "./supabase-token.service";
import { SessionEstablishedDto } from "./auth.dto";
import { CurrentUser } from "../common/auth.decorator";
import { SkipMfa } from "../common/skip-mfa.decorator";
import type { Role } from "@prisma/client";
import { IsEmail, IsOptional, IsString } from "class-validator";

class RequestMagicDto {
  @IsEmail() email!: string;
  @IsOptional() @IsString() mobile?: boolean;
  @IsOptional() @IsString() redirect?: "web" | "mobile" | "site";
}
class VerifyDto {
  @IsString() token!: string;
}
class RedeemInviteDto {
  @IsString() code!: string;
  @IsEmail() email!: string;
  @IsOptional() role?: Role;
}

@Controller("auth")
export class AuthController {
  constructor(
    private auth: AuthService,
    private authUsers: AuthUserService,
    private events: AuthEventsService,
  ) {}

  @Post("magic-link")
  @HttpCode(200)
  request(@Body() dto: RequestMagicDto) {
    return this.auth.requestMagicLink(dto.email, dto.redirect ?? (dto.mobile ? "mobile" : "web"));
  }

  @Post("verify")
  @HttpCode(200)
  verify(@Body() dto: VerifyDto) {
    return this.auth.verifyMagicLink(dto.token);
  }

  @Post("invite/redeem")
  @HttpCode(200)
  redeem(@Body() dto: RedeemInviteDto) {
    // role is resolved server-side from the invite record (never trusted from client)
    return this.auth.redeemInvite(dto.code, dto.email);
  }

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
    if (!linked) return { inviteRequired: true, email: session.email };
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

  /** Web/mobile verify pages redirect here with ?token= to complete sign-in. */
  @Get("verify")
  async verifyGet(@Query("token") token: string) {
    return this.auth.verifyMagicLink(token);
  }
}
