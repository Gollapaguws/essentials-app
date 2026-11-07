import { Controller, Get, Post, Body, Param, Delete, Patch, UseGuards } from "@nestjs/common";
import { SupabaseAuthGuard } from "../auth/supabase-auth.guard";
import { EventsService } from "./events.service";
import { EventToolsService } from "./event-tools.service";
import type { Response } from "express";
import { Res } from "@nestjs/common";
import { Auth, CurrentUser } from "../common/auth.decorator";
import type { JwtUser } from "../common/roles.guard";
import { IsInt, IsOptional, IsString, Min } from "class-validator";

class RsvpDto {
  @IsOptional() @IsInt() @Min(1) headcount?: number;
  @IsOptional() @IsString() sourceCampaignId?: string;
}

class CreateEventDto {
  @IsString() venueId!: string;
  @IsString() title!: string;
  @IsOptional() @IsString() description?: string;
  @IsString() date!: string;
  @IsOptional() lineup?: unknown;
  @IsInt() capacity!: number;
  @IsOptional() @IsString() dressCode?: string;
  @IsOptional() @IsString() ticketUrl?: string;
  @IsOptional() @IsInt() revenueSplitPromoterPct?: number;
  /** What the promoter pays a DJ per hour — every slot is priced off this. */
  @IsOptional() @IsInt() @Min(1) djFeePerHour?: number;
  /** Planning ceiling for the night's DJ spend. */
  @IsOptional() @IsInt() @Min(0) budget?: number;
  @IsOptional() @IsInt() @Min(1) slotCount?: number;
  @IsOptional() @IsInt() @Min(15) slotMinutes?: number;
  /** "HH:MM" — when the first slot starts on the event date. */
  @IsOptional() @IsString() slotStart?: string;
}

class SlotPlanDto {
  @IsInt() @Min(1) djFeePerHour!: number;
  @IsOptional() @IsInt() @Min(0) budget?: number;
  @IsInt() @Min(1) slotCount!: number;
  @IsInt() @Min(15) slotMinutes!: number;
  @IsString() slotStart!: string;
}

@Controller("events")
@UseGuards(SupabaseAuthGuard)
export class EventsController {
  constructor(private events: EventsService, private tools: EventToolsService) {}

  @Get()
  feed() {
    return this.events.feed();
  }

  @Get(":id")
  detail(@Param("id") id: string, @CurrentUser() user: JwtUser) {
    return this.events.detail(id, user);
  }

  @Post(":id/rsvp")
  rsvp(@Param("id") id: string, @CurrentUser() user: JwtUser, @Body() dto: RsvpDto) {
    return this.events.rsvp(id, user, dto.headcount ?? 1, dto.sourceCampaignId);
  }

  @Delete(":id/rsvp")
  cancel(@Param("id") id: string, @CurrentUser() user: JwtUser) {
    return this.events.cancelRsvp(id, user);
  }

  @Get(":id/door-pass")
  doorPass(@Param("id") id: string, @CurrentUser() user: JwtUser) {
    return this.events.doorPass(id, user);
  }

  @Post("check-in")
  checkIn(@CurrentUser() user: JwtUser, @Body("qrToken") qrToken: string) {
    return this.events.checkIn(qrToken, user);
  }

  @Post()
  @Auth("promoter")
  create(@CurrentUser() user: JwtUser, @Body() dto: CreateEventDto) {
    return this.events.create(user, dto);
  }

  /** Re-plan the night's slots and budget (refused once applications exist). */
  @Patch(":id/slots")
  @Auth("promoter", "admin")
  setSlots(@Param("id") id: string, @CurrentUser() user: JwtUser, @Body() dto: SlotPlanDto) {
    return this.events.setSlots(user, id, dto);
  }

  @Patch(":id")
  @Auth("promoter", "venue_manager")
  update(@Param("id") id: string, @CurrentUser() user: JwtUser, @Body() data: Record<string, unknown>) {
    return this.events.update(user, id, data);
  }

  @Post(":id/clone")
  @Auth("promoter")
  clone(@Param("id") id: string, @CurrentUser() user: JwtUser) {
    return this.tools.clone(user, id);
  }

  @Post(":id/cancel")
  @Auth("promoter")
  cancelEvent(@Param("id") id: string, @CurrentUser() user: JwtUser) {
    return this.tools.cancel(user, id);
  }

  @Post(":id/reopen")
  @Auth("promoter")
  reopen(@Param("id") id: string, @CurrentUser() user: JwtUser) {
    return this.tools.reopen(user, id);
  }

  @Delete(":id")
  @Auth("promoter")
  remove(@Param("id") id: string, @CurrentUser() user: JwtUser) {
    return this.tools.remove(user, id);
  }

  @Get(":id/guest-list.csv")
  @Auth("promoter", "venue_manager")
  exportCsv(@Param("id") id: string, @CurrentUser() user: JwtUser, @Res() res: Response) {
    return this.tools.exportCsv(user, id, res);
  }

  @Get("manage/list")
  @Auth("promoter")
  listForPromoter(@CurrentUser() user: JwtUser) {
    return this.events.listForPromoter(user);
  }
}
