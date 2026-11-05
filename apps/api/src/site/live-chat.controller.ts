import { Body, Controller, Get, HttpCode, Post } from "@nestjs/common";
import { Throttle } from "@nestjs/throttler";
import { IsString, Length } from "class-validator";
import { LiveChatService } from "./live-chat.service";

class ChatMessageDto {
  @IsString() @Length(2, 24) name!: string;
  @IsString() @Length(1, 280) body!: string;
}

/**
 * Public chat under the front-page stream: no account needed, so posting is
 * throttled well below the global limit and reads are cheap enough to poll.
 */
@Controller("site/chat")
export class LiveChatController {
  constructor(private chat: LiveChatService) {}

  @Get()
  @Throttle({ default: { limit: 60, ttl: 60_000 } })
  list() {
    return this.chat.recent();
  }

  @Post()
  @HttpCode(201)
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  post(@Body() dto: ChatMessageDto) {
    return this.chat.post(dto.name, dto.body);
  }
}
