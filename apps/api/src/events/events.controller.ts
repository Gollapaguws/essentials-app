import { Controller, Get, Post, Body, Param, Delete, Patch, Query, HttpCode, UseGuards } from "@nestjs/common";
import { SupabaseAuthGuard } from "../auth/supabase-auth.guard";
import { EventsService } from "./events.service";
import { EventToolsService } from "./event-tools.service";
import { GroupChatService, MAX_MESSAGE_LENGTH } from "./group-chat.service";
import type { Response } from "express";
import { Res } from "@nestjs/common";
import { Auth, CurrentUser } from "../common/auth.decorator";
import { pageArgs, parsePaging, type Paging } from "../common/paging";
import type { JwtUser } from "../common/roles.guard";
import { IsArray, IsBoolean, IsDateString, IsInt, IsOptional, IsString, MaxLength, Min, MinLength } from "class-validator";

class RsvpDto {
  @IsOptional() @IsInt() @Min(1) headcount?: number;
}

class CreateEventDto {
  @IsString() venueId!: string;
  @IsString() @MinLength(1) @MaxLength(50) title!: string;
  @IsOptional() @IsString() description?: string;
  @IsString() date!: string;
  @IsOptional() lineup?: unknown;
  @IsInt() capacity!: number;
  @IsOptional() @IsString() dressCode?: string;
  @IsOptional() @IsString() ticketUrl?: string;
  @IsOptional() @IsInt() revenueSplitPromoterPct?: number;
  /** What the promoter pays a DJ per hour — every slot is priced off this. 0 = free gig. */
  @IsOptional() @IsInt() @Min(0) djFeePerHour?: number;
  /** Planning ceiling for the night's DJ spend. */
  @IsOptional() @IsInt() @Min(0) budget?: number;
  @IsOptional() @IsInt() @Min(1) slotCount?: number;
  @IsOptional() @IsInt() @Min(15) slotMinutes?: number;
  /** "HH:MM" — when the first slot starts on the event date. */
  @IsOptional() @IsString() slotStart?: string;
}

class DoorCheckInDto {
  @IsString() guestListId!: string;
}

/**
 * Editable event fields. Ownership, status and money are deliberately absent:
 * they move through dedicated endpoints (clone/cancel/reopen, venue decision,
 * slots) instead of a free-form Prisma write.
 */
class UpdateEventDto {
  @IsOptional() @IsString() @MinLength(1) @MaxLength(50) title?: string;
  @IsOptional() @IsString() @MaxLength(4000) description?: string;
  @IsOptional() @IsDateString() date?: string;
  @IsOptional() @IsArray() lineup?: unknown[];
  @IsOptional() @IsInt() @Min(1) capacity?: number;
  @IsOptional() @IsString() @MaxLength(120) dressCode?: string;
  @IsOptional() @IsString() @MaxLength(500) ticketUrl?: string;
  @IsOptional() @IsArray() genres?: string[];
}

class SlotFeeDto {
  @IsInt() @Min(1) fee!: number;
}

class ChatMessageDto {
  @IsString() @MinLength(1) @MaxLength(MAX_MESSAGE_LENGTH) body!: string;
  /** Staff only: mark this message as the room's icebreaker. */
  @IsOptional() @IsBoolean() icebreaker?: boolean;
}

class RepeatDto {
  /** How many extra weekly copies to create. */
  @IsInt() @Min(1) weeks!: number;
}

class SlotPlanDto {
  /** 0 is a free (unpaid) night. */
  @IsInt() @Min(0) djFeePerHour!: number;
  @IsOptional() @IsInt() @Min(0) budget?: number;
  @IsInt() @Min(1) slotCount!: number;
  @IsInt() @Min(15) slotMinutes!: number;
  @IsString() slotStart!: string;
}

@Controller("events")
@UseGuards(SupabaseAuthGuard)
export class EventsController {
  constructor(
    private events: EventsService,
    private tools: EventToolsService,
    private chat: GroupChatService,
  ) {}

  @Get()
  feed() {
    return this.events.feed();
  }

  /** The signed-in guest's upcoming door passes. Declared before `:id` on purpose. */
  @Get("mine")
  mine(@CurrentUser() user: JwtUser) {
    return this.events.mine(user);
  }

  /** Promoter/venue/admin: money promised and room left across every upcoming night. */
  @Get("budgets")
  @Auth("promoter", "venue_manager", "admin")
  budgets(@CurrentUser() user: JwtUser) {
    return this.events.budgetOverview(user);
  }

  /** Promoter: the night arc their slot plans are tagged with. */
  @Get("night-arc")
  @Auth("promoter", "admin")
  nightArc(@CurrentUser() user: JwtUser) {
    return this.events.nightArc(user);
  }

  /** Promoter: save the five phases (length, role, BPM band, genres) for future plans. */
  @Patch("night-arc")
  @Auth("promoter", "admin")
  saveNightArc(@CurrentUser() user: JwtUser, @Body("phases") phases: unknown) {
    return this.events.saveNightArc(user, phases);
  }

  @Get(":id")
  detail(@Param("id") id: string, @CurrentUser() user: JwtUser) {
    return this.events.detail(id, user);
  }

  @Post(":id/rsvp")
  rsvp(@Param("id") id: string, @CurrentUser() user: JwtUser, @Body() dto: RsvpDto) {
    return this.events.rsvp(id, user, dto.headcount ?? 1);
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
  @Auth("promoter", "venue_manager", "door", "admin")
  checkIn(@CurrentUser() user: JwtUser, @Body("qrToken") qrToken: string) {
    return this.events.checkIn(qrToken, user);
  }

  /** The night's group chat. Members only: the list, the promoter, the venue, admins. */
  @Get(":id/chat")
  chatMessages(@Param("id") id: string, @CurrentUser() user: JwtUser) {
    return this.chat.messages(user, id);
  }

  /** Post to the night's chat. Staff can mark a message as an icebreaker. */
  @Post(":id/chat")
  @HttpCode(201)
  chatPost(@Param("id") id: string, @CurrentUser() user: JwtUser, @Body() dto: ChatMessageDto) {
    return this.chat.post(user, id, dto.body, dto.icebreaker ?? false);
  }

  /** Promoter/venue/door staff: the door list, searchable by guest name or email. */
  @Get(":id/guest-list")
  @Auth("promoter", "venue_manager", "door", "admin")
  guestList(@Param("id") id: string, @CurrentUser() user: JwtUser, @Query("q") q?: string) {
    return this.events.guestList(user, id, q?.trim() || undefined);
  }

  /** Promoter/venue/door staff: check a guest in by list entry, no QR scanner needed. */
  @Post(":id/check-in-guest")
  @HttpCode(200)
  @Auth("promoter", "venue_manager", "door", "admin")
  checkInGuest(@Param("id") id: string, @CurrentUser() user: JwtUser, @Body() dto: DoorCheckInDto) {
    return this.events.checkInGuest(user, id, dto.guestListId);
  }

  @Post()
  @Auth("promoter")
  create(@CurrentUser() user: JwtUser, @Body() dto: CreateEventDto) {
    return this.events.create(user, dto);
  }

  /** Price one slot differently — a headline set — while nobody holds it. */
  @Patch(":id/slots/:slotId/fee")
  @Auth("promoter", "admin")
  setSlotFee(
    @Param("id") id: string,
    @Param("slotId") slotId: string,
    @CurrentUser() user: JwtUser,
    @Body() dto: SlotFeeDto,
  ) {
    return this.events.setSlotFee(user, id, slotId, dto.fee);
  }

  /** Re-plan the night's slots and budget (refused once applications exist). */
  @Patch(":id/slots")
  @Auth("promoter", "admin")
  setSlots(@Param("id") id: string, @CurrentUser() user: JwtUser, @Body() dto: SlotPlanDto) {
    return this.events.setSlots(user, id, dto);
  }

  @Patch(":id")
  @Auth("promoter", "venue_manager")
  update(@Param("id") id: string, @CurrentUser() user: JwtUser, @Body() dto: UpdateEventDto) {
    return this.events.update(user, id, dto);
  }

  @Post(":id/clone")
  @Auth("promoter")
  clone(@Param("id") id: string, @CurrentUser() user: JwtUser) {
    return this.tools.clone(user, id);
  }

  /** Turn one night into a weekly run: N extra drafts, each carrying the plan. */
  @Post(":id/repeat")
  @Auth("promoter")
  repeat(@Param("id") id: string, @CurrentUser() user: JwtUser, @Body() dto: RepeatDto) {
    return this.tools.repeat(user, id, dto.weeks);
  }

  /** Admin: re-send the DJ call for a night that is already approved. */
  @Post(":id/announce")
  @HttpCode(200)
  @Auth("admin")
  announce(@Param("id") id: string) {
    return this.events.resendDjCall(id);
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

  /** The promoter's DJ spend for one night, with each invoice's state. */
  @Get(":id/spend.csv")
  @Auth("promoter", "admin")
  exportSpend(@Param("id") id: string, @CurrentUser() user: JwtUser, @Res() res: Response) {
    return this.tools.exportSpendCsv(user, id, res);
  }

  /** Paged, newest first: the events screen renders a page, not the whole catalogue. */
  @Get("manage/list")
  @Auth("promoter", "venue_manager", "door", "admin")
  listForPromoter(
    @CurrentUser() user: JwtUser,
    @Query("limit") limit?: string,
    @Query("offset") offset?: string,
  ) {
    return this.events.listForPromoter(user, parsePaging(limit, offset));
  }
}
