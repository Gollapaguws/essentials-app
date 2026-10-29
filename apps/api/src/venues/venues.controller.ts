import { Controller, Get, Post, Body, Param, Delete, Query, UseGuards } from "@nestjs/common";
import { AuthGuard } from "@nestjs/passport";
import { VenuesService } from "./venues.service";
import { Auth, CurrentUser } from "../common/auth.decorator";
import type { JwtUser } from "../common/roles.guard";
import { IsBoolean, IsInt, IsOptional, IsString, Min } from "class-validator";

class TableDto {
  @IsString() tableNumber!: string;
  @IsInt() @Min(1) capacity!: number;
  @IsInt() @Min(0) minSpend!: number;
}

@Controller("venues")
@UseGuards(AuthGuard("jwt"))
export class VenuesController {
  constructor(private venues: VenuesService) {}

  @Get("mine")
  @Auth("venue_manager", "admin")
  mine(@CurrentUser() user: JwtUser) {
    return this.venues.myVenues(user);
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
