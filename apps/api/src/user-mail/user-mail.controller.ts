import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  Patch,
  Post,
} from "@nestjs/common";
import { Throttle } from "@nestjs/throttler";
import { Auth, CurrentUser } from "../common/auth.decorator";
import type { JwtUser } from "../common/roles.guard";
import { CreateMailboxDto, SetAliasesDto, SetMailboxStatusDto } from "./user-mail.dto";
import { UserMailService } from "./user-mail.service";

/** Admin-only: the mailbox belonging to one account. */
@Controller("users/:userId/mailbox")
@Auth("admin")
export class UserMailController {
  constructor(private readonly mail: UserMailService) {}

  @Get()
  get(@Param("userId") userId: string) {
    return this.mail.get(userId);
  }

  /** Provision the mailbox and return its one-time password. */
  @Post()
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  create(
    @Param("userId") userId: string,
    @Body() dto: CreateMailboxDto,
    @CurrentUser() actor: JwtUser,
  ) {
    return this.mail.create(userId, dto.localpart, actor);
  }

  /** Replace the extra local parts that deliver to this mailbox. */
  @Patch("aliases")
  setAliases(
    @Param("userId") userId: string,
    @Body() dto: SetAliasesDto,
    @CurrentUser() actor: JwtUser,
  ) {
    return this.mail.updateAliases(userId, dto.aliases, actor);
  }

  /** Email the connection settings to the account's sign-in address. */
  @Post("settings-email")
  @HttpCode(200)
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  emailSettings(@Param("userId") userId: string, @CurrentUser() actor: JwtUser) {
    return this.mail.emailSettings(userId, actor);
  }

  /** Set a new password and return it once; the old one stops working. */
  @Post("password")
  @HttpCode(200)
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  resetPassword(@Param("userId") userId: string, @CurrentUser() actor: JwtUser) {
    return this.mail.resetPassword(userId, actor);
  }

  /** Disable (lock the password) or re-enable the mailbox. */
  @Patch()
  setStatus(
    @Param("userId") userId: string,
    @Body() dto: SetMailboxStatusDto,
    @CurrentUser() actor: JwtUser,
  ) {
    return this.mail.setStatus(userId, dto.status, actor);
  }

  /** Delete the mailbox and its stored mail. */
  @Delete()
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  remove(@Param("userId") userId: string, @CurrentUser() actor: JwtUser) {
    return this.mail.remove(userId, actor);
  }
}
