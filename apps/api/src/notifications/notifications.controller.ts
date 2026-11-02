import { Body, Controller, Get, Post, UseGuards, HttpCode } from "@nestjs/common";
import { SupabaseAuthGuard } from "../auth/supabase-auth.guard";
import { CurrentUser } from "../common/auth.decorator";
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

  /** Badge count for the dashboard nav. */
  @Get("unread")
  async unread(@CurrentUser() user: JwtUser) {
    return { count: await this.notifications.unreadCount(user.sub) };
  }

  /** Mark one notification (`id`) or the whole feed. */
  @Post("read")
  @HttpCode(200)
  markRead(@CurrentUser() user: JwtUser, @Body("id") id?: string) {
    return this.notifications.markRead(user.sub, id);
  }
}
