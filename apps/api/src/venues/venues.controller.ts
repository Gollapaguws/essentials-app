import { Controller, Get, Post, Patch, Body, Param, Query, UseGuards } from "@nestjs/common";
import { SupabaseAuthGuard } from "../auth/supabase-auth.guard";
import { VenuesService } from "./venues.service";
import { Auth, CurrentUser } from "../common/auth.decorator";
import type { JwtUser } from "../common/roles.guard";
import { IsInt, IsNumber, IsOptional, IsString, Max, MaxLength, Min } from "class-validator";

/** Promoters create the venues they run nights at; they become its manager. */
class CreateVenueDto {
  @IsString() @MaxLength(120) name!: string;
  @IsOptional() @IsString() @MaxLength(240) address?: string;
  @IsInt() @Min(1) capacity!: number;
  @IsOptional() @IsNumber() @Min(-90) @Max(90) lat?: number;
  @IsOptional() @IsNumber() @Min(-180) @Max(180) lng?: number;
}

/** Venue profile + coordinates; lat/lng drive DJ route planning. */
class VenueDetailsDto {
  @IsOptional() @IsString() @MaxLength(120) name?: string;
  @IsOptional() @IsString() @MaxLength(240) address?: string;
  @IsOptional() @IsNumber() @Min(-90) @Max(90) lat?: number;
  @IsOptional() @IsNumber() @Min(-180) @Max(180) lng?: number;
}

@Controller("venues")
@UseGuards(SupabaseAuthGuard)
export class VenuesController {
  constructor(private venues: VenuesService) {}

  @Get("mine")
  @Auth("venue_manager", "promoter", "admin")
  mine(@CurrentUser() user: JwtUser) {
    return this.venues.myVenues(user);
  }

  /** A promoter adds a venue; the API makes them its manager so they can edit it. */
  @Post()
  @Auth("promoter", "admin")
  create(@CurrentUser() user: JwtUser, @Body() dto: CreateVenueDto) {
    return this.venues.create(user, dto);
  }

  /** Promoter picker when creating an event; flags venues with no coordinates. */
  @Get("options")
  @Auth("promoter", "admin")
  options() {
    return this.venues.listForPicker();
  }

  @Get("events/pending")
  @Auth("venue_manager", "promoter", "admin")
  pending(@CurrentUser() user: JwtUser, @Query("venueId") venueId?: string) {
    return this.venues.pendingEvents(user, venueId);
  }

  @Post("events/:id/decision")
  @Auth("venue_manager", "promoter", "admin")
  decide(@CurrentUser() user: JwtUser, @Param("id") id: string, @Body("approve") approve: boolean) {
    return this.venues.decideEvent(user, id, approve);
  }

  @Patch(":venueId")
  @Auth("venue_manager", "promoter", "admin")
  update(@CurrentUser() user: JwtUser, @Param("venueId") venueId: string, @Body() dto: VenueDetailsDto) {
    return this.venues.updateVenue(user, venueId, dto);
  }

  @Get(":venueId/door-logs")
  @Auth("venue_manager", "admin")
  doorLogs(@CurrentUser() user: JwtUser, @Param("venueId") venueId: string) {
    return this.venues.doorLogs(user, venueId);
  }

  @Get(":venueId/analytics")
  @Auth("venue_manager", "admin")
  analytics(@CurrentUser() user: JwtUser, @Param("venueId") venueId: string) {
    return this.venues.analytics(user, venueId);
  }
}
