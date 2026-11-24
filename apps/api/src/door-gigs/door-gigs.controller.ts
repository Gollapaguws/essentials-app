import {
  BadRequestException,
  Body,
  Controller,
  Get,
  HttpCode,
  Param,
  Post,
  Query,
  Res,
  UseGuards,
} from "@nestjs/common";
import type { Response } from "express";
import { SupabaseAuthGuard } from "../auth/supabase-auth.guard";
import { Auth, CurrentUser } from "../common/auth.decorator";
import { parsePaging } from "../common/paging";
import type { JwtUser } from "../common/roles.guard";
import { DoorGigsService } from "./door-gigs.service";
import {
  IsBoolean,
  IsNumber,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
} from "class-validator";

class DoorProfileDto {
  /** Home base for invoice travel. Empty string clears it. */
  @IsOptional() @IsString() @MaxLength(240) homeAddress?: string;
  @IsOptional() @IsNumber() @Min(-90) @Max(90) homeLat?: number;
  @IsOptional() @IsNumber() @Min(-180) @Max(180) homeLng?: number;
  @IsOptional() @IsString() @MaxLength(120) bankAccountHolder?: string;
  @IsOptional() @IsString() @MaxLength(120) bankName?: string;
  @IsOptional() @IsString() @MaxLength(34) bankAccountNumber?: string;
  @IsOptional() @IsString() @MaxLength(20) bankBranchCode?: string;
  @IsOptional() @IsString() @MaxLength(40) bankAccountType?: string;
}

class ApplyDoorDto {
  @IsString() eventId!: string;
}

class DecideDoorDto {
  @IsBoolean() confirm!: boolean;
  /** Optional on a decline: the host is told why. */
  @IsOptional() @IsString() @MaxLength(500) reason?: string;
}

class DoorInvoiceDto {
  @IsString() bookingId!: string;
}

@Controller("door-gigs")
@UseGuards(SupabaseAuthGuard)
export class DoorGigsController {
  constructor(private door: DoorGigsService) {}

  /** Door host: private home base and payout details. */
  @Get("profile")
  @Auth("door", "admin")
  profile(@CurrentUser() user: JwtUser) {
    return this.door.profile(user);
  }

  @Post("profile")
  @Auth("door", "admin")
  saveProfile(@CurrentUser() user: JwtUser, @Body() dto: DoorProfileDto) {
    return this.door.saveProfile(user, dto);
  }

  /** Nights with a door fee that this host has not applied for yet. */
  @Get("open")
  @Auth("door", "admin")
  open(@CurrentUser() user: JwtUser) {
    return this.door.openGigs(user);
  }

  @Post("apply")
  @HttpCode(200)
  @Auth("door")
  apply(@CurrentUser() user: JwtUser, @Body() dto: ApplyDoorDto) {
    if (!dto.eventId?.trim()) throw new BadRequestException("eventId is required");
    return this.door.apply(user, dto.eventId);
  }

  /** Door host: their own applications and booked shifts. */
  @Get("mine")
  @Auth("door", "admin")
  mine(@CurrentUser() user: JwtUser) {
    return this.door.myGigs(user);
  }

  @Post("bookings/:id/withdraw")
  @HttpCode(200)
  @Auth("door")
  withdraw(@CurrentUser() user: JwtUser, @Param("id") id: string) {
    return this.door.withdraw(user, id);
  }

  /** Promoter: the door application queue. */
  @Get("applications")
  @Auth("promoter", "admin")
  applications(@CurrentUser() user: JwtUser, @Query("eventId") eventId?: string) {
    return this.door.applications(user, eventId);
  }

  @Post("applications/:id/decide")
  @HttpCode(200)
  @Auth("promoter", "admin")
  decide(@CurrentUser() user: JwtUser, @Param("id") id: string, @Body() dto: DecideDoorDto) {
    return this.door.decide(user, id, dto.confirm ?? false, dto.reason);
  }

  /** Promoter/venue: the shift was worked — unlocks invoicing. */
  @Post("bookings/:id/complete")
  @Auth("promoter", "venue_manager", "admin")
  complete(@CurrentUser() user: JwtUser, @Param("id") id: string) {
    return this.door.complete(user, id);
  }

  @Get("invoices")
  @Auth("door", "admin")
  invoices(@CurrentUser() user: JwtUser) {
    return this.door.invoices(user);
  }

  @Post("invoices/generate")
  @HttpCode(201)
  @Auth("door")
  generate(@CurrentUser() user: JwtUser, @Body() dto: DoorInvoiceDto) {
    return this.door.generateInvoice(user, dto.bookingId);
  }

  @Get("invoices/:id/print")
  @Auth("door", "admin")
  async print(@CurrentUser() user: JwtUser, @Param("id") id: string, @Res() res: Response) {
    const html = await this.door.renderInvoice(user, id);
    res.type("html").send(html);
  }

  /** Door host: own statements, grouped by month. */
  @Get("statements")
  @Auth("door")
  statements(@CurrentUser() user: JwtUser) {
    return this.door.statements(user);
  }

  /** Promoter: one statement per door host across their nights. */
  @Get("statements/hosts")
  @Auth("promoter", "admin")
  promoterStatements(
    @CurrentUser() user: JwtUser,
    @Query("limit") limit?: string,
    @Query("offset") offset?: string,
  ) {
    return this.door.promoterStatements(user, parsePaging(limit, offset));
  }

  /** One month of door money as a CSV. */
  @Get("statements.csv")
  @Auth("door", "promoter", "admin")
  statementCsv(
    @CurrentUser() user: JwtUser,
    @Res() res: Response,
    @Query("month") month?: string,
    @Query("profileId") profileId?: string,
  ) {
    return this.door.statementCsv(user, month, res, profileId);
  }
}
