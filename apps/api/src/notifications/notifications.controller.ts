import { BadRequestException, Body, Controller, Get, Post, UseGuards, HttpCode } from "@nestjs/common";
import { SupabaseAuthGuard } from "../auth/supabase-auth.guard";
import { CurrentUser } from "../common/auth.decorator";
import { Roles } from "../common/roles.decorator";
import { RolesGuard } from "../common/roles.guard";
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

  /** Admin: the DJ accounts the test button can target. */
  @Get("djs")
  @UseGuards(RolesGuard)
  @Roles("admin")
  djTargets() {
    return this.notifications.djTargets();
  }

  /** Admin: prove the bell, email and Telegram paths reach a real DJ. */
  @Post("test")
  @HttpCode(200)
  @UseGuards(RolesGuard)
  @Roles("admin")
  sendTest(@Body("userId") userId?: string) {
    if (!userId) throw new BadRequestException("Choose a DJ first.");
    return this.notifications.sendTest(userId);
  }
}
