import { Body, Controller, Get, Patch } from "@nestjs/common";
import { Auth, CurrentUser } from "../common/auth.decorator";
import type { JwtUser } from "../common/roles.guard";
import { SetCatchAllDto } from "./user-mail.dto";
import { UserMailService } from "./user-mail.service";

/** Domain-wide mailbox settings: today, the single catch-all address. */
@Controller("mailbox")
@Auth("admin")
export class MailboxAdminController {
  constructor(private readonly mail: UserMailService) {}

  @Get("catch-all")
  getCatchAll() {
    return this.mail.getCatchAll();
  }

  @Patch("catch-all")
  setCatchAll(@Body() dto: SetCatchAllDto, @CurrentUser() actor: JwtUser) {
    return this.mail.setCatchAll(dto.address ?? null, actor);
  }
}
