import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Post,
  Req,
  Res,
  UseGuards,
} from "@nestjs/common";
import { Throttle } from "@nestjs/throttler";
import { IsEmail, IsString, Matches, MinLength } from "class-validator";
import type { Request, Response } from "express";
import { DashboardSessionService } from "./dashboard-session.service";
import { SupabaseAuthGuard } from "./supabase-auth.guard";
import { SkipMfa } from "../common/skip-mfa.decorator";

class LoginDto {
  @IsEmail()
  email!: string;

  @IsString()
  @MinLength(1)
  password!: string;
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
  constructor(private readonly sessions: DashboardSessionService) {}

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
    const configured = (process.env.CORS_ORIGINS ?? "")
      .split(",")
      .map((s) => s.trim())
      .filter((s) => s && s !== "*");
    const origin = req.get("origin");
    const fallback = configured[0] ?? `${req.protocol}://${req.get("host")}`;
    if (!origin) return fallback;
    if (configured.length === 0 || configured.includes(origin)) return origin;
    throw new BadRequestException("Origin not allowed");
  }
}
