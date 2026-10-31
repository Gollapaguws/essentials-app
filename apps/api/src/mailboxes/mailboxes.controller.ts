import { Body, Controller, Delete, Get, Param, Post, UseGuards } from "@nestjs/common";
import { SupabaseAuthGuard } from "../auth/supabase-auth.guard";
import { Auth } from "../common/auth.decorator";
import { IsString, Matches, MaxLength, MinLength } from "class-validator";
import { MailboxesService } from "./mailboxes.service";

class CreateMailboxDto {
  @IsString() @Matches(/^[a-z0-9][a-z0-9._-]{1,31}$/, { message: "2-32 chars: a-z 0-9 . _ -" }) username!: string;
  @IsString() @MinLength(10) @MaxLength(128) password!: string;
}
class PasswordDto {
  @IsString() @MinLength(10) @MaxLength(128) password!: string;
}

@Controller("mailboxes")
@UseGuards(SupabaseAuthGuard)
export class MailboxesController {
  constructor(private mailboxes: MailboxesService) {}

  @Get()
  @Auth("admin")
  list() {
    return this.mailboxes.list();
  }

  /** Create a real mailbox: user@essentialsedm.com (IMAP + webmail + inbound mail). */
  @Post()
  @Auth("admin")
  create(@Body() dto: CreateMailboxDto) {
    return this.mailboxes.create(dto.username, dto.password);
  }

  @Post(":username/password")
  @Auth("admin")
  setPassword(@Param("username") username: string, @Body() dto: PasswordDto) {
    return this.mailboxes.setPassword(username, dto.password);
  }

  @Delete(":username")
  @Auth("admin")
  remove(@Param("username") username: string) {
    return this.mailboxes.remove(username);
  }
}
