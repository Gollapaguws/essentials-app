import { Body, Controller, Get, Param, Patch, Query } from "@nestjs/common";
import { Auth } from "../common/auth.decorator";
import { UsersService } from "./users.service";
import { SetRoleDto, UpdateProfileDto } from "./users.dto";

/** Admin-only account administration: who is registered, and what they are. */
@Controller("users")
@Auth("admin")
export class UsersController {
  constructor(private readonly users: UsersService) {}

  @Get()
  list(@Query("q") q?: string) {
    return this.users.list(q);
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
