import { Controller, Get, Post, Body, Param, UseGuards } from "@nestjs/common";
import { AuthGuard } from "@nestjs/passport";
import { SocialService } from "./social.service";
import { Auth, CurrentUser } from "../common/auth.decorator";
import type { JwtUser } from "../common/roles.guard";
import { IsString, MaxLength } from "class-validator";

class MessageDto {
  @IsString() @MaxLength(500) body!: string;
}

@Controller("social")
@UseGuards(AuthGuard("jwt"))
export class SocialController {
  constructor(private social: SocialService) {}

  @Get("events/:id/matches")
  matches(@Param("id") id: string, @CurrentUser() user: JwtUser) {
    return this.social.matchesForEvent(id, user);
  }

  @Get("events/:id/chat")
  chat(@Param("id") id: string, @CurrentUser() user: JwtUser) {
    return this.social.getChat(id, user);
  }

  @Post("events/:id/chat")
  post(@Param("id") id: string, @CurrentUser() user: JwtUser, @Body() dto: MessageDto) {
    return this.social.postMessage(id, user, dto.body);
  }

  @Get("events/:id/icebreakers")
  icebreakers(@Param("id") id: string, @CurrentUser() user: JwtUser) {
    return this.social.icebreakers(id, user);
  }
}
