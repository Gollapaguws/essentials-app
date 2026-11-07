import { Controller, Get, Post, Patch, Body, Param, Query, UseGuards, HttpCode, BadRequestException, Req, Res, UploadedFile, UseInterceptors } from "@nestjs/common";
import type { Response } from "express";
import { FileInterceptor } from "@nestjs/platform-express";
import type { Request } from "express";
import { SupabaseAuthGuard } from "../auth/supabase-auth.guard";
import { ArtistsService } from "./artists.service";
import { DjBookingService } from "./dj-booking.service";
import { Auth, CurrentUser } from "../common/auth.decorator";
import type { JwtUser } from "../common/roles.guard";
import { MAX_PROFILE_IMAGE_BYTES } from "../common/media-storage";
import { IsBoolean, IsNumber, IsOptional, IsString, MaxLength, Min } from "class-validator";

class ProfileDto {
  @IsString() stageName!: string;
  /** Free text for the DJ's public profile. Empty string clears it. */
  @IsOptional() @IsString() @MaxLength(2000) bio?: string;
  /** Absolute http(s) URL of the profile image. Empty string clears it. */
  @IsOptional() @IsString() @MaxLength(500) imageUrl?: string;
  @IsOptional() @IsNumber() @Min(1) vehicleConsumptionLPer100km?: number;
  // travelRatePerKm is deliberately absent: it is the platform standard, set by
  // an admin (PATCH /artists/travel-rate), never by the DJ.
}

export class StandardTravelRateDto {
  // A zero rate would silently zero every DJ's travel pay, so the floor is a cent.
  @IsNumber() @Min(0.01) travelRatePerKm!: number;
}

class ApplyDto {
  /** Preferred: the promoter-defined slot, with its own time and fee. */
  @IsOptional() @IsString() slotId?: string;
  /** Legacy path for events planned before slots existed. */
  @IsOptional() @IsString() eventId?: string;
  @IsOptional() @IsString() slot?: "day" | "evening" | "late-night";
}

class NoteDto {
  /** The promoter's private note on a DJ. An empty string clears it. */
  @IsString() @MaxLength(2000) body!: string;
}

class DecideDto {
  @IsBoolean() confirm!: boolean;
  /** Optional on a decline: the DJ is told why. */
  @IsOptional() @IsString() @MaxLength(500) reason?: string;
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

  /** Admin only: the platform-wide travel rate every DJ's routing and invoices use. */
  @Get("travel-rate")
  @Auth("admin")
  travelRate() {
    return this.artists.standardTravelRate();
  }

  /** Admin only: change the platform-wide travel rate every DJ's routing and invoices use. */
  @Patch("travel-rate")
  @Auth("admin")
  setTravelRate(@Body() dto: StandardTravelRateDto) {
    return this.artists.setStandardTravelRate(dto.travelRatePerKm);
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

  /** Artist: money view — played gigs, what is invoiced, what is still owed. */
  @Get("earnings")
  @Auth("artist", "admin")
  earnings(@CurrentUser() user: JwtUser) {
    return this.artists.earnings(user);
  }

  /** Promoter: every night's DJ spend — committed, invoiced, paid, still out. */
  @Get("settlements")
  @Auth("promoter", "admin")
  settlements(@CurrentUser() user: JwtUser) {
    return this.artists.settlements(user);
  }

  /** Artist: confirmed and played gigs as an .ics file for any calendar app. */
  @Get("gigs.ics")
  @Auth("artist", "admin")
  async gigsIcs(@CurrentUser() user: JwtUser, @Res() res: Response) {
    const ics = await this.artists.gigsIcs(user);
    res.setHeader("Content-Type", "text/calendar; charset=utf-8");
    res.setHeader("Content-Disposition", 'attachment; filename="essentials-gigs.ics"');
    res.send(ics);
  }

  /** Apply for a slot: day | evening | late-night. */
  @Post("gig-calendar/apply")
  @HttpCode(200)
  @Auth("artist", "admin")
  apply(@CurrentUser() user: JwtUser, @Body() dto: ApplyDto) {
    return this.djBooking.apply(user, dto);
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
  decide(@CurrentUser() user: JwtUser, @Param("id") id: string, @Body() dto: DecideDto) {
    return this.djBooking.decide(user, id, dto.confirm ?? false, dto.reason);
  }

  /** Promoter/venue: the gig was played — the second confirmation that unlocks invoicing. */
  @Post("bookings/:id/complete")
  @Auth("promoter", "venue_manager", "admin")
  confirmCompleted(@CurrentUser() user: JwtUser, @Param("id") id: string) {
    return this.djBooking.confirmCompleted(user, id);
  }

  @Post("bookings/:id/status")
  @Auth("artist", "admin")
  bookingStatus(@CurrentUser() user: JwtUser, @Param("id") id: string, @Body("status") status: "pending" | "confirmed" | "cancelled") {
    return this.artists.updateBooking(user, id, { status });
  }

  /**
   * Promoter: their own private note on a DJ.
   *
   * Wrapped in an object on purpose: a bare `null` makes Nest answer with an
   * empty body, which the web client's `res.json()` cannot parse — an unsaved
   * note would surface as a failed request.
   */
  @Get(":id/note")
  @Auth("promoter", "admin")
  async note(@CurrentUser() user: JwtUser, @Param("id") id: string) {
    return { note: await this.artists.artistNote(user, id) };
  }

  /** Promoter: save (or clear) their private note on a DJ. Same envelope as GET. */
  @Patch(":id/note")
  @Auth("promoter", "admin")
  async saveNote(@CurrentUser() user: JwtUser, @Param("id") id: string, @Body() dto: NoteDto) {
    return { note: await this.artists.saveArtistNote(user, id, dto.body ?? "") };
  }

  /** Promoter: one DJ's full profile and every booking they have had, for judging an application. */
  @Get(":id")
  @Auth("promoter", "admin")
  detail(@CurrentUser() user: JwtUser, @Param("id") id: string) {
    return this.artists.artistDetail(user, id);
  }

  private requestOrigin(req: Request) {
    return `${req.protocol}://${req.get("host")}`;
  }
}
