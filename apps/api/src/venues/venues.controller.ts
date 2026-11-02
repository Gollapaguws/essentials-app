import { Controller, Get, Post, Patch, Body, Param, Delete, Query, UseGuards } from "@nestjs/common";
import { SupabaseAuthGuard } from "../auth/supabase-auth.guard";
import { VenuesService } from "./venues.service";
import { Auth, CurrentUser } from "../common/auth.decorator";
import type { JwtUser } from "../common/roles.guard";
import { IsBoolean, IsInt, IsNumber, IsOptional, IsString, Max, MaxLength, Min } from "class-validator";

class TableDto {
  @IsString() tableNumber!: string;
  @IsInt() @Min(1) capacity!: number;
  @IsInt() @Min(0) minSpend!: number;
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
  @Auth("venue_manager", "admin")
  mine(@CurrentUser() user: JwtUser) {
    return this.venues.myVenues(user);
  }

  /** Promoter picker when creating an event; flags venues with no coordinates. */
  @Get("options")
  @Auth("promoter", "admin")
  options() {
    return this.venues.listForPicker();
  }

  @Get("events/pending")
  @Auth("venue_manager", "admin")
  pending(@CurrentUser() user: JwtUser, @Query("venueId") venueId?: string) {
    return this.venues.pendingEvents(user, venueId);
  }

  @Post("events/:id/decision")
  @Auth("venue_manager", "admin")
  decide(@CurrentUser() user: JwtUser, @Param("id") id: string, @Body("approve") approve: boolean) {
    return this.venues.decideEvent(user, id, approve);
  }

  @Patch(":venueId")
  @Auth("venue_manager", "admin")
  update(@CurrentUser() user: JwtUser, @Param("venueId") venueId: string, @Body() dto: VenueDetailsDto) {
    return this.venues.updateVenue(user, venueId, dto);
  }

  @Get(":venueId/tables")
  @Auth("venue_manager", "admin")
  tables(@CurrentUser() user: JwtUser, @Param("venueId") venueId: string) {
    return this.venues.listTables(user, venueId);
  }

  @Post(":venueId/tables")
  @Auth("venue_manager", "admin")
  upsertTable(@CurrentUser() user: JwtUser, @Param("venueId") venueId: string, @Body() dto: TableDto) {
    return this.venues.upsertTable(user, venueId, dto);
  }

  @Delete(":venueId/tables/:tableNumber")
  @Auth("venue_manager", "admin")
  deleteTable(@CurrentUser() user: JwtUser, @Param("venueId") venueId: string, @Param("tableNumber") tableNumber: string) {
    return this.venues.deleteTable(user, venueId, tableNumber);
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
