import { Controller, Get, Post, Param, UseGuards, HttpCode } from "@nestjs/common";
import { SupabaseAuthGuard } from "../auth/supabase-auth.guard";
import { Auth, CurrentUser } from "../common/auth.decorator";
import type { JwtUser } from "../common/roles.guard";
import { NotificationsService } from "./notifications.service";

@Controller("notifications")
@UseGuards(SupabaseAuthGuard)
export class NotificationsController {
  constructor(private notifications: NotificationsService) {}

  @Get()
  list(@CurrentUser() user: JwtUser) {
    return this.notifications.listFor(user.sub);
  }

  @Post("read")
  @HttpCode(200)
  markRead(@CurrentUser() user: JwtUser) {
    return this.notifications.markRead(user.sub);
  }
}
