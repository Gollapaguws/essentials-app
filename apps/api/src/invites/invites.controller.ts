import { Body, Controller, Delete, Get, Param, Post, UseGuards } from "@nestjs/common";
import { SupabaseAuthGuard } from "../auth/supabase-auth.guard";
import { ConfigService } from "@nestjs/config";
import { InvitesService } from "./invites.service";
import { Auth, CurrentUser } from "../common/auth.decorator";
import type { JwtUser } from "../common/roles.guard";
import { IsInt, IsOptional, IsString, IsIn, Min, Max } from "class-validator";
import type { Role } from "@prisma/client";

class CreateInviteDto {
  @IsString() @IsIn(["guest", "promoter", "artist", "venue_manager"]) role!: Role;
  @IsOptional() @IsInt() @Min(1) @Max(1000) maxUses?: number;
  @IsOptional() @IsInt() @Min(1) @Max(365) expiresInDays?: number;
}

@Controller("invites")
@UseGuards(SupabaseAuthGuard)
export class InvitesController {
  constructor(private invites: InvitesService, private config: ConfigService) {}

  @Post()
  @Auth("admin")
  create(@CurrentUser() user: JwtUser, @Body() dto: CreateInviteDto) {
    const siteUrl = this.config.get("SITE_URL") ?? "https://essentialsedm.com";
    return this.invites.create(user, dto).then((invite) => ({
      ...invite,
      link: this.invites.linkFor(invite.code, siteUrl),
    }));
  }

  @Get()
  @Auth("admin")
  list() {
    const siteUrl = this.config.get("SITE_URL") ?? "https://essentialsedm.com";
    return this.invites.list().then((rows) => rows.map((r) => ({ ...r, link: this.invites.linkFor(r.code, siteUrl) })));
  }

  @Delete(":id")
  @Auth("admin")
  revoke(@Param("id") id: string) {
    return this.invites.revoke(id);
  }
}
