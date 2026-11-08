import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  NotFoundException,
  Param,
  Post,
  Req,
  Res,
  ServiceUnavailableException,
  UseGuards,
} from "@nestjs/common";
import { Throttle } from "@nestjs/throttler";
import { IsEmail, IsOptional, IsString, Matches, MinLength } from "class-validator";
import type { Request, Response } from "express";
import { DashboardSessionService } from "./dashboard-session.service";
import { AgentIdentityService } from "./agent-identity.service";
import { AgentContextService } from "./agent-context.service";
import { SupabaseAuthGuard } from "./supabase-auth.guard";
import { SkipMfa } from "../common/skip-mfa.decorator";

class LoginDto {
  @IsEmail()
  email!: string;

  @IsString()
  @MinLength(1)
  password!: string;
}

class AdoptDto {
  @IsString()
  @MinLength(20)
  accessToken!: string;

  @IsOptional()
  @IsString()
  @MinLength(1)
  refreshToken?: string;
}

class ExchangeDto {
  @IsString()
  @MinLength(8)
  code!: string;
}

class RecoverDto {
  @IsEmail()
  email!: string;

  /** Dashboard-relative callback path, e.g. `/dashboard/auth/callback?type=recovery`. */
  @IsString()
  @Matches(/^\/[A-Za-z0-9/_.?=&-]*$/, { message: "path must be relative" })
  path = "/auth/callback?type=recovery";
}

class PasswordDto {
  @IsString()
  @MinLength(8)
  password!: string;
}

class FactorDto {
  @IsString()
  @MinLength(1)
  factorId!: string;
}

class VerifyDto extends FactorDto {
  @IsString()
  @MinLength(1)
  challengeId!: string;

  @IsString()
  @Matches(/^\d{6}$/, { message: "code must be six digits" })
  code!: string;
}

/**
 * The dashboard's own sign-in surface. Tokens never leave the server: each
 * successful call sets one httpOnly cookie and stores the Supabase session in
 * the database.
 */
@Controller("auth")
export class SessionController {
  constructor(
    private readonly sessions: DashboardSessionService,
    private readonly agent: AgentIdentityService,
    private readonly agentContext: AgentContextService,
  ) {}

  @Post("session")
  @HttpCode(200)
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  async login(@Body() dto: LoginDto, @Req() req: Request, @Res({ passthrough: true }) res: Response) {
    await this.sessions.login(dto.email, dto.password, req, res);
    return { ok: true };
  }

  @Delete("session")
  @HttpCode(204)
  async logout(@Req() req: Request, @Res({ passthrough: true }) res: Response) {
    await this.sessions.logout(req, res);
  }

  /**
   * Hand a Supabase session from the public site over to the dashboard: the
   * token is verified server-side and exchanged for the httpOnly cookie.
   */
  @Post("session/token")
  @HttpCode(200)
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  async adopt(
    @Body() dto: AdoptDto,
    @Res({ passthrough: true }) res: Response,
  ) {
    await this.sessions.adopt(dto.accessToken, dto.refreshToken ?? null, res);
    return { ok: true };
  }

  /** Signed-in sessions for the account, so one can be revoked if it is lost. */
  @Get("sessions")
  @UseGuards(SupabaseAuthGuard)
  @SkipMfa()
  @Throttle({ default: { limit: 60, ttl: 60_000 } })
  async devices(@Req() req: Request) {
    return { sessions: await this.sessions.devices(req) };
  }

  /**
   * The support widget's identity, signed server-side. The browser never holds
   * the agent secret, only the hash for its own account.
   */
  @Get("agent-identity")
  @UseGuards(SupabaseAuthGuard)
  @SkipMfa()
  @Throttle({ default: { limit: 30, ttl: 60_000 } })
  async agentIdentity(@Req() req: Request) {
    if (!this.agent.configured) {
      throw new ServiceUnavailableException("Support chat identity is not configured.");
    }
    const { row } = await this.sessions.resolve(req);
    return {
      ...this.agent.sign(row.userId),
      context: await this.agentContext.for(row.userId, {
        mfaEnrolled: await this.mfaEnrolled(req),
      }),
    };
  }

  /**
   * Whether the account has a verified authenticator. An identity provider that
   * cannot answer must not break the chat: the agent is told it does not know.
   */
  private async mfaEnrolled(req: Request): Promise<boolean | undefined> {
    try {
      const { totp } = await this.sessions.factors(req);
      return totp.some((factor) => factor.status === "verified");
    } catch {
      return undefined;
    }
  }

  /** Sign one session out; revoking the caller's own also clears its cookie. */
  @Delete("sessions/:id")
  @HttpCode(204)
  @UseGuards(SupabaseAuthGuard)
  @SkipMfa()
  async revoke(
    @Param("id") id: string,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ) {
    // Row ids are the SHA-256 of the cookie; anything else cannot name a session.
    if (!/^[a-f0-9]{64}$/.test(id)) throw new NotFoundException("That device is not signed in.");
    await this.sessions.revokeDevice(req, res, id);
  }

  /** Landing point for the emailed recovery link. */
  @Post("session/exchange")
  @HttpCode(200)
  @Throttle({ default: { limit: 20, ttl: 60_000 } })
  async exchange(
    @Body() dto: ExchangeDto,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ) {
    await this.sessions.exchange(dto.code, req, res);
    return { ok: true };
  }

  @Post("password/recover")
  @HttpCode(200)
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  async recover(
    @Body() dto: RecoverDto,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ) {
    const origin = this.allowedOrigin(req);
    await this.sessions.startRecovery(dto.email, `${origin}${dto.path}`, res);
    // Always the same answer: this endpoint must not reveal which addresses exist.
    return { ok: true };
  }

  @Post("password")
  @HttpCode(200)
  @UseGuards(SupabaseAuthGuard)
  @SkipMfa()
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  async setPassword(@Body() dto: PasswordDto, @Req() req: Request) {
    await this.sessions.setPassword(req, dto.password);
    return { ok: true };
  }

  @Get("mfa/factors")
  @UseGuards(SupabaseAuthGuard)
  @SkipMfa()
  factors(@Req() req: Request) {
    return this.sessions.factors(req);
  }

  @Post("mfa/enroll")
  @HttpCode(200)
  @UseGuards(SupabaseAuthGuard)
  @SkipMfa()
  enroll(@Req() req: Request) {
    return this.sessions.enrollMfa(req);
  }

  @Post("mfa/challenge")
  @HttpCode(200)
  @UseGuards(SupabaseAuthGuard)
  @SkipMfa()
  challenge(@Body() dto: FactorDto, @Req() req: Request) {
    return this.sessions.challengeMfa(req, dto.factorId);
  }

  @Post("mfa/verify")
  @HttpCode(200)
  @UseGuards(SupabaseAuthGuard)
  @SkipMfa()
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  async verify(@Body() dto: VerifyDto, @Req() req: Request) {
    await this.sessions.verifyMfa(req, dto.factorId, dto.challengeId, dto.code);
    return { ok: true };
  }

  /**
   * Recovery mail must come back to the site that asked for it — never to an
   * arbitrary host an attacker put in the body.
   */
  private allowedOrigin(req: Request): string {
    // CORS_ORIGINS lists the origins that may *call* the API; SITE_URL is where
    // the dashboard is actually served, and it is same-origin with /api, so it
    // never appears there. Both are trusted hosts to send a recovery link to.
    const allowed = [
      ...(process.env.CORS_ORIGINS ?? "").split(","),
      process.env.SITE_URL ?? "",
    ]
      .map((s) => s.trim().replace(/\/+$/, ""))
      .filter((s) => s && s !== "*");
    const origin = req.get("origin")?.replace(/\/+$/, "");
    if (!origin) return allowed[0] ?? `${req.protocol}://${req.get("host")}`;
    // Always an allowlist in production: a body field must not pick the host.
    if (allowed.length === 0 || allowed.includes(origin)) return origin;
    throw new BadRequestException("Origin not allowed");
  }
}
