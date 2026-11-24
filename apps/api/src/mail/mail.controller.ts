import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Post,
  Query,
  Res,
} from "@nestjs/common";
import { Throttle } from "@nestjs/throttler";
import type { Response } from "express";
import { Auth, CurrentUser } from "../common/auth.decorator";
import type { JwtUser } from "../common/roles.guard";
import { MailService, type SendMailInput } from "./mail.service";

/**
 * The signed-in account's own mailbox: folders, messages, reads, flags, moves
 * and sending. Sign-in email and mailbox address are separate, so the mailbox
 * this returns is the one an admin provisioned for the account.
 */
@Controller("mail")
@Auth()
export class MailController {
  constructor(private readonly mail: MailService) {}

  @Get()
  summary(@CurrentUser() actor: JwtUser) {
    return this.mail.summary(actor.sub);
  }

  @Get("messages")
  list(
    @CurrentUser() actor: JwtUser,
    @Query("folder") folder?: string,
    @Query("offset") offset?: string,
    @Query("limit") limit?: string,
    @Query("q") q?: string,
  ) {
    return this.mail.list(actor.sub, folder, {
      offset: offset ? Number(offset) : 0,
      limit: limit ? Number(limit) : 25,
      query: q,
    });
  }

  @Get("messages/:uid")
  message(@CurrentUser() actor: JwtUser, @Param("uid") uid: string, @Query("folder") folder?: string) {
    return this.mail.message(actor.sub, folder, uid);
  }

  @Get("messages/:uid/attachments/:index")
  async attachment(
    @CurrentUser() actor: JwtUser,
    @Param("uid") uid: string,
    @Param("index") index: string,
    @Query("folder") folder: string | undefined,
    @Res() res: Response,
  ) {
    const file = await this.mail.attachment(actor.sub, folder, uid, index);
    // The browser only ever saves this; never render mail attachments inline.
    const safeName = file.filename.replace(/["\\\r\n]/g, "_");
    res.setHeader("Content-Type", file.contentType || "application/octet-stream");
    res.setHeader("Content-Length", String(file.content.length));
    res.setHeader("Content-Disposition", `attachment; filename="${safeName}"`);
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.end(file.content);
  }

  @Post("messages/:uid/flags")
  flags(
    @CurrentUser() actor: JwtUser,
    @Param("uid") uid: string,
    @Body() body: { folder?: string; seen?: boolean; flagged?: boolean },
  ) {
    return this.mail.setFlags(actor.sub, body.folder, uid, {
      seen: typeof body?.seen === "boolean" ? body.seen : undefined,
      flagged: typeof body?.flagged === "boolean" ? body.flagged : undefined,
    });
  }

  @Post("messages/:uid/move")
  move(
    @CurrentUser() actor: JwtUser,
    @Param("uid") uid: string,
    @Body() body: { folder?: string; to?: string },
  ) {
    return this.mail.move(actor.sub, body?.folder, uid, body?.to ?? "");
  }

  @Delete("messages/:uid")
  remove(@CurrentUser() actor: JwtUser, @Param("uid") uid: string, @Query("folder") folder?: string) {
    return this.mail.remove(actor.sub, folder, uid);
  }

  /** Sending is the one write that leaves the building, so it is rate-limited. */
  @Post("send")
  @Throttle({ default: { limit: 20, ttl: 60_000 } })
  send(@CurrentUser() actor: JwtUser, @Body() body: SendMailInput) {
    if (!body || typeof body !== "object") throw new BadRequestException("Nothing to send.");
    return this.mail.send(actor.sub, body);
  }
}
