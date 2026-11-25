import { Body, Controller, Delete, Get, Headers, Param, Post, UseGuards } from "@nestjs/common";
import { SupabaseAuthGuard } from "../auth/supabase-auth.guard";
import { Auth, CurrentUser } from "../common/auth.decorator";
import type { JwtUser } from "../common/roles.guard";
import { AddOrganisationMemberDto, CreateOrganisationDto } from "./platform.dto";
import { PlatformService } from "./platform.service";

/**
 * Promoter workspaces. A signed-in account can read the workspace it is acting
 * in; only an admin can create one or move people between them.
 */
@Controller("platform")
@UseGuards(SupabaseAuthGuard)
export class PlatformController {
  constructor(private readonly platform: PlatformService) {}

  /** Active workspace plus every workspace the caller may use. */
  @Get("context")
  context(@CurrentUser() user: JwtUser, @Headers("x-org-id") orgId?: string) {
    return this.platform.context(user.sub, user.role, user.email, orgId?.trim() || undefined);
  }

  /** First-run checklist shown on a promoter's dashboard until setup is done. */
  @Get("onboarding")
  @Auth("promoter")
  onboarding(@CurrentUser() user: JwtUser) {
    return this.platform.onboarding(user);
  }

  @Get("organisations")
  @Auth("admin")
  list() {
    return this.platform.listAll();
  }

  @Post("organisations")
  @Auth("admin")
  create(@Body() dto: CreateOrganisationDto) {
    return this.platform.createOrganisation(dto.name);
  }

  @Get("organisations/:id/members")
  @Auth("admin")
  members(@Param("id") id: string) {
    return this.platform.members(id);
  }

  @Post("organisations/:id/members")
  @Auth("admin")
  addMember(@Param("id") id: string, @Body() dto: AddOrganisationMemberDto) {
    return this.platform.addMember(id, dto.email, dto.role);
  }

  @Delete("organisations/:id/members/:userId")
  @Auth("admin")
  removeMember(@Param("id") id: string, @Param("userId") userId: string) {
    return this.platform.removeMember(id, userId);
  }
}
