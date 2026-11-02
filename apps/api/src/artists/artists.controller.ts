import { Controller, Get, Post, Body, Param, Query, UseGuards, HttpCode } from "@nestjs/common";
import { SupabaseAuthGuard } from "../auth/supabase-auth.guard";
import { ArtistsService } from "./artists.service";
import { DjBookingService, SLOTS } from "./dj-booking.service";
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
  constructor(private artists: ArtistsService, private djBooking: DjBookingService) {}

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

  /** Gig calendar: open events accepting DJ applications. */
  @Get("gig-calendar")
  @Auth("artist", "admin")
  gigCalendar(@CurrentUser() user: JwtUser) {
    return this.artists.openGigs(user);
  }

  /** Apply for a slot: day | evening | late-night. */
  @Post("gig-calendar/apply")
  @HttpCode(200)
  @Auth("artist", "admin")
  apply(@CurrentUser() user: JwtUser, @Body() dto: { eventId: string; slot: "day" | "evening" | "late-night" }) {
    return this.djBooking.apply(user, dto.eventId, dto.slot);
  }

  /** Promoter: list DJ applications across their events. */
  @Get("applications")
  @Auth("promoter", "admin")
  applications(@CurrentUser() user: JwtUser) {
    return this.djBooking.applications(user);
  }

  /** Promoter: confirm/decline a DJ application. */
  @Post("applications/:id/decide")
  @HttpCode(200)
  @Auth("promoter", "admin")
  decide(@CurrentUser() user: JwtUser, @Param("id") id: string, @Body() dto: { confirm: boolean }) {
    return this.djBooking.decide(user, id, dto.confirm ?? false);
  }

  @Post("bookings/:id/status")
  @Auth("artist", "admin")
  bookingStatus(@CurrentUser() user: JwtUser, @Param("id") id: string, @Body("status") status: "pending" | "confirmed" | "cancelled") {
    return this.artists.updateBooking(user, id, { status });
  }
}
