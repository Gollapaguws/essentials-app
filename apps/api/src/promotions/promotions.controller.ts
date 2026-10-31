import { Controller, Get, Post, Body, Param, UseGuards } from "@nestjs/common";
import { SupabaseAuthGuard } from "../auth/supabase-auth.guard";
import { PromotionsService } from "./promotions.service";
import { Auth, CurrentUser } from "../common/auth.decorator";
import type { JwtUser } from "../common/roles.guard";
import { IsInt, IsOptional, IsString, Max, MaxLength, Min } from "class-validator";

class CreatePromoDto {
  @IsString() eventId!: string;
  @IsString() @MaxLength(24) code!: string;
  @IsOptional() @IsString() kind?: string;
  @IsOptional() @IsInt() @Min(0) @Max(100) discountPct?: number;
  @IsOptional() @IsInt() @Min(1) maxUses?: number;
  @IsOptional() @IsString() expiresAt?: string;
}

@Controller("promotions")
@UseGuards(SupabaseAuthGuard)
export class PromotionsController {
  constructor(private promotions: PromotionsService) {}

  @Post()
  @Auth("promoter")
  create(@CurrentUser() user: JwtUser, @Body() dto: CreatePromoDto) {
    return this.promotions.create(user, dto);
  }

  @Get("event/:eventId")
  @Auth("promoter")
  list(@CurrentUser() user: JwtUser, @Param("eventId") eventId: string) {
    return this.promotions.listForEvent(user, eventId);
  }

  @Post("redeem")
  redeem(@CurrentUser() user: JwtUser, @Body("code") code: string) {
    return this.promotions.redeem(user, code);
  }
}
