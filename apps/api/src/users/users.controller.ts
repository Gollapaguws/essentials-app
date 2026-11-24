import { Body, Controller, Get, HttpCode, Param, Patch, Post, Query } from "@nestjs/common";
import { Throttle } from "@nestjs/throttler";
import { Auth, CurrentUser } from "../common/auth.decorator";
import type { JwtUser } from "../common/roles.guard";
import { UsersService } from "./users.service";
import { CreateUserDto, SetMfaDto, SetRoleDto, UpdateProfileDto } from "./users.dto";
import { parsePaging } from "../common/paging";

/** Admin-only account administration: who is registered, and what they are. */
@Controller("users")
@Auth("admin")
export class UsersController {
  constructor(private readonly users: UsersService) {}

  /** Paged: an admin screen renders a page, never the whole account table. */
  @Get()
  list(
    @Query("q") q?: string,
    @Query("limit") limit?: string,
    @Query("offset") offset?: string,
  ) {
    return this.users.list(q, parsePaging(limit, offset));
  }

  /** Provision an account with a temporary password; it must be reset on first sign-in. */
  @Post()
  create(@Body() dto: CreateUserDto) {
    return this.users.create(dto);
  }

  /**
   * Unlock a locked-out account: remove the lost authenticator, issue a temporary
   * password and sign out every device. Returns the password once.
   */
  @Post(":id/auth-reset")
  @HttpCode(200)
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  resetSignIn(@Param("id") id: string, @CurrentUser() actor: JwtUser) {
    return this.users.resetSignIn(id, actor);
  }

  /** Grant or withdraw this account's exemption from mandatory two-step. */
  @Patch(":id/mfa")
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  setMfa(@Param("id") id: string, @Body() dto: SetMfaDto, @CurrentUser() actor: JwtUser) {
    return this.users.setMfaDisabled(id, dto.disabled, actor);
  }

  @Patch(":id/role")
  setRole(@Param("id") id: string, @Body() dto: SetRoleDto) {
    return this.users.setRole(id, dto);
  }

  /** Rename or clear the DJ stage name / venue without changing the role. */
  @Patch(":id/profile")
  updateProfile(@Param("id") id: string, @Body() dto: UpdateProfileDto) {
    return this.users.updateProfile(id, dto);
  }
}
