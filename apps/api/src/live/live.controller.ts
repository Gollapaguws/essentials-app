import { Body, Controller, Delete, Get, HttpCode, Post, UseGuards } from "@nestjs/common";
import { SupabaseAuthGuard } from "../auth/supabase-auth.guard";
import { Auth } from "../common/auth.decorator";
import { LiveService } from "./live.service";
import { IsString, MaxLength } from "class-validator";

class SourceDto {
  @IsString() @MaxLength(500) url!: string;
}

@Controller("live")
export class LiveController {
  constructor(private live: LiveService) {}

  /** Public status: is someone live? is a restream active? (front page player). */
  @Get("status")
  status() {
    return this.live.status();
  }

  /** Admin: start restreaming a source (rtsp://… | https://… | m3u8 | "testsrc"). */
  @Post("source")
  @HttpCode(200)
  @UseGuards(SupabaseAuthGuard)
  @Auth("admin")
  source(@Body() dto: SourceDto) {
    return this.live.startSource(dto.url.trim());
  }

  /** Admin: stop the active restream. */
  @Delete("source")
  @UseGuards(SupabaseAuthGuard)
  @Auth("admin")
  stop() {
    return this.live.stopSource();
  }
}
