import { Body, Controller, Get, Patch } from "@nestjs/common";
import { Throttle } from "@nestjs/throttler";
import { Auth, CurrentUser } from "../common/auth.decorator";
import type { JwtUser } from "../common/roles.guard";
import { SetOwnMailboxPasswordDto } from "./user-mail.dto";
import { UserMailService } from "./user-mail.service";

/** The signed-in account's own mailbox: view it and set its password. */
@Controller("mailbox")
@Auth()
export class MailboxSelfController {
  constructor(private readonly mail: UserMailService) {}

  @Get("me")
  own(@CurrentUser() actor: JwtUser) {
    return this.mail.own(actor.sub);
  }

  @Patch("me/password")
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  setPassword(@CurrentUser() actor: JwtUser, @Body() dto: SetOwnMailboxPasswordDto) {
    return this.mail.setOwnPassword(actor.sub, dto.password, actor);
  }
}
