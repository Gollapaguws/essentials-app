import { Controller, Get, Post, Body, Param, Query, UseGuards } from "@nestjs/common";
import { SupabaseAuthGuard } from "../auth/supabase-auth.guard";
import { ArtistsService } from "./artists.service";
import { Auth, CurrentUser } from "../common/auth.decorator";
import type { JwtUser } from "../common/roles.guard";
import { IsDateString, IsISO8601, IsNumber, IsOptional, IsString, Min } from "class-validator";

class ProfileDto {
  @IsString() stageName!: string;
  @IsOptional() @IsNumber() @Min(1) vehicleConsumptionLPer100km?: number;
  @IsOptional() @IsNumber() @Min(0) travelRatePerKm?: number;
}

@Controller("artists")
@UseGuards(SupabaseAuthGuard)
export class ArtistsController {
  constructor(private artists: ArtistsService) {}

  @Get("me")
  @Auth("artist", "admin")
  profile(@CurrentUser() user: JwtUser) {
    return this.artists.getProfile(user);
  }

  @Post("me")
  @Auth("artist", "admin")
  upsertProfile(@CurrentUser() user: JwtUser, @Body() dto: ProfileDto) {
    return this.artists.upsertProfile(user, dto);
  }

  @Get("gigs")
  @Auth("artist", "admin")
  gigs(@CurrentUser() user: JwtUser) {
    return this.artists.myGigs(user);
  }

  @Get("route-plan")
  @Auth("artist", "admin")
  plan(@CurrentUser() user: JwtUser, @Query("date") date: string) {
    return this.artists.planDay(user, date);
  }

  @Post("route-plan/save")
  @Auth("artist", "admin")
  savePlan(@CurrentUser() user: JwtUser, @Body("date") date: string) {
    return this.artists.savePlan(user, date);
  }

  @Post("bookings/:id/status")
  @Auth("artist", "admin")
  bookingStatus(@CurrentUser() user: JwtUser, @Param("id") id: string, @Body("status") status: "pending" | "confirmed" | "cancelled") {
    return this.artists.updateBooking(user, id, { status });
  }
}
