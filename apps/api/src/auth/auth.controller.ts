import { Controller, Post, Body, Get, Query, HttpCode, UseGuards } from "@nestjs/common";
import { AuthGuard } from "@nestjs/passport";
import { AuthService } from "./auth.service";
import { CurrentUser } from "../common/auth.decorator";
import type { JwtUser } from "../common/roles.guard";
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
  constructor(private auth: AuthService) {}

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

  /** Current session (decoded JWT) — used by site + dashboard to detect existing logins. */
  @Get("me")
  @UseGuards(AuthGuard("jwt"))
  me(@CurrentUser() user: JwtUser) {
    return { user };
  }

  /** Web/mobile verify pages redirect here with ?token= to complete sign-in. */
  @Get("verify")
  async verifyGet(@Query("token") token: string) {
    return this.auth.verifyMagicLink(token);
  }
}
