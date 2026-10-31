import { Controller, Get, Post, Body, Param, Patch, UseGuards } from "@nestjs/common";
import { SupabaseAuthGuard } from "../auth/supabase-auth.guard";
import { TablesService } from "./tables.service";
import { Auth, CurrentUser } from "../common/auth.decorator";
import type { JwtUser } from "../common/roles.guard";
import { IsString, IsOptional } from "class-validator";

class BookDto {
  @IsString() eventId!: string;
  @IsString() venueTableId!: string;
  @IsOptional() @IsString() bottleServiceNotes?: string;
  @IsOptional() @IsString() sourceCampaignId?: string;
}

@Controller("tables")
@UseGuards(SupabaseAuthGuard)
export class TablesController {
  constructor(private tables: TablesService) {}

  @Get("inventory/:eventId")
  inventory(@Param("eventId") eventId: string) {
    return this.tables.inventory(eventId);
  }

  @Post("book")
  book(@CurrentUser() user: JwtUser, @Body() dto: BookDto) {
    return this.tables.book(user, dto);
  }

  @Get("bookings")
  @Auth("promoter")
  list(@CurrentUser() user: JwtUser, @Param("eventId") eventId?: string) {
    return this.tables.listForPromoter(user, eventId);
  }

  @Patch("bookings/:id/status")
  @Auth("promoter")
  setStatus(@CurrentUser() user: JwtUser, @Param("id") id: string, @Body("status") status: "pending" | "confirmed" | "seated" | "cancelled") {
    return this.tables.updateStatus(user, id, status);
  }
}
