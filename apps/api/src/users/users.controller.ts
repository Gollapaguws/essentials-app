import { Body, Controller, Get, Param, Patch, Post, Query } from "@nestjs/common";
import { Auth } from "../common/auth.decorator";
import { UsersService } from "./users.service";
import { CreateUserDto, SetRoleDto, UpdateProfileDto } from "./users.dto";

/** Admin-only account administration: who is registered, and what they are. */
@Controller("users")
@Auth("admin")
export class UsersController {
  constructor(private readonly users: UsersService) {}

  @Get()
  list(@Query("q") q?: string) {
    return this.users.list(q);
  }

  /** Provision an account with a temporary password; it must be reset on first sign-in. */
  @Post()
  create(@Body() dto: CreateUserDto) {
    return this.users.create(dto);
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
