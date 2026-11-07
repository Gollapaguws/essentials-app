import { Controller, Get, Post, Body, Param, Query, UseGuards, HttpCode, BadRequestException, Req, UploadedFile, UseInterceptors } from "@nestjs/common";
import { FileInterceptor } from "@nestjs/platform-express";
import type { Request } from "express";
import { SupabaseAuthGuard } from "../auth/supabase-auth.guard";
import { ArtistsService } from "./artists.service";
import { DjBookingService } from "./dj-booking.service";
import { Auth, CurrentUser } from "../common/auth.decorator";
import type { JwtUser } from "../common/roles.guard";
import { MAX_PROFILE_IMAGE_BYTES } from "../common/media-storage";
import { IsNumber, IsOptional, IsString, MaxLength, Min } from "class-validator";

class ProfileDto {
  @IsString() stageName!: string;
  /** Free text for the DJ's public profile. Empty string clears it. */
  @IsOptional() @IsString() @MaxLength(2000) bio?: string;
  /** Absolute http(s) URL of the profile image. Empty string clears it. */
  @IsOptional() @IsString() @MaxLength(500) imageUrl?: string;
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

  /** Promoter: the whole DJ roster — profile, travel terms and upcoming gigs. */
  @Get()
  @Auth("promoter", "admin")
  roster() {
    return this.artists.roster();
  }

  @Post("me")
  @Auth("artist", "admin")
  upsertProfile(@CurrentUser() user: JwtUser, @Body() dto: ProfileDto, @Req() req: Request) {
    return this.artists.upsertProfile(user, dto, this.requestOrigin(req));
  }

  /** Profile photo upload (jpg/png/webp/avif, max 5 MB). Returns the URL to save via POST /artists/me. */
  @Post("me/image")
  @Auth("artist", "admin")
  @UseInterceptors(FileInterceptor("file", { limits: { fileSize: MAX_PROFILE_IMAGE_BYTES } }))
  uploadProfileImage(@UploadedFile() file: Express.Multer.File | undefined, @Req() req: Request) {
    if (!file) throw new BadRequestException("No file");
    return this.artists.saveProfileImage(file, this.requestOrigin(req));
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

  private requestOrigin(req: Request) {
    return `${req.protocol}://${req.get("host")}`;
  }
}
