import { Controller, Get, Post, Body, Param, Delete, Patch, UseGuards } from "@nestjs/common";
import { AuthGuard } from "@nestjs/passport";
import { EventsService } from "./events.service";
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
}

@Controller("events")
@UseGuards(AuthGuard("jwt"))
export class EventsController {
  constructor(private events: EventsService) {}

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

  @Patch(":id")
  @Auth("promoter", "venue_manager")
  update(@Param("id") id: string, @CurrentUser() user: JwtUser, @Body() data: Record<string, unknown>) {
    return this.events.update(user, id, data);
  }

  @Get("manage/list")
  @Auth("promoter")
  listForPromoter(@CurrentUser() user: JwtUser) {
    return this.events.listForPromoter(user);
  }
}
