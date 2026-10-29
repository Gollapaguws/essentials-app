import { Controller, Post, Body, Get, Query, HttpCode } from "@nestjs/common";
import { AuthService } from "./auth.service";
import type { Role } from "@prisma/client";
import { IsEmail, IsOptional, IsString } from "class-validator";

class RequestMagicDto {
  @IsEmail() email!: string;
  @IsOptional() @IsString() mobile?: boolean;
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
    return this.auth.requestMagicLink(dto.email, dto.mobile);
  }

  @Post("verify")
  @HttpCode(200)
  verify(@Body() dto: VerifyDto) {
    return this.auth.verifyMagicLink(dto.token);
  }

  @Post("invite/redeem")
  @HttpCode(200)
  redeem(@Body() dto: RedeemInviteDto) {
    return this.auth.redeemInvite(dto.code, dto.email, dto.role ?? "guest");
  }

  /** Web/mobile verify pages redirect here with ?token= to complete sign-in. */
  @Get("verify")
  async verifyGet(@Query("token") token: string) {
    return this.auth.verifyMagicLink(token);
  }
}
