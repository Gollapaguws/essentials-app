import { Body, Controller, Delete, Get, HttpCode, Param, Post, UseGuards } from "@nestjs/common";
import { SupabaseAuthGuard } from "../auth/supabase-auth.guard";
import { Auth, CurrentUser } from "../common/auth.decorator";
import { LiveService } from "./live.service";
import { LiveBookingService } from "./live-booking.service";
import { SimulcastService } from "./simulcast.service";
import { IsIn, IsOptional, IsString, MaxLength } from "class-validator";
import { ConfigService } from "@nestjs/config";
import { prisma } from "@essentials/db";
import type { JwtUser } from "../common/roles.guard";

class SourceDto {
  @IsString() @MaxLength(500) url!: string;
}

class TargetDto {
  @IsString() @IsIn(["youtube", "tiktok", "mixcloud", "facebook", "instagram", "custom"]) platform!: string;
  @IsString() @MaxLength(500) url!: string;
  @IsOptional() @IsString() @MaxLength(80) label?: string;
}

class LiveBookingDto {
  /** ISO timestamp for the start of the DJ's session. */
  @IsString() startsAt!: string;
  /** ISO timestamp for the end; must be after startsAt and at most 12 hours later. */
  @IsString() endsAt!: string;
  @IsOptional() @IsString() @MaxLength(80) title?: string;
}

@Controller("live")
export class LiveController {
  constructor(
    private live: LiveService,
    private simulcast: SimulcastService,
    private liveBookings: LiveBookingService,
    private config: ConfigService,
  ) {}

  /** Public status: is someone live? is a restream active? (front page player). */
  @Get("status")
  status() {
    return { ...this.live.status(), simulcast: this.simulcast.states() };
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
    this.simulcast.stopAll();
    return this.live.stopSource();
  }

  /** Admin: viewer RTSP URL including credentials (rotate via RTSP_VIEWER_PASS env). */
  @Get("viewer-url")
  @UseGuards(SupabaseAuthGuard)
  @Auth("admin")
  viewerUrl() {
    const user = this.config.get("RTSP_VIEWER_USER") ?? "essentials";
    const pass = this.config.get("RTSP_VIEWER_PASS") ?? "";
    return { url: `rtsp://${user}:${pass}@essentialsedm.com:8554/essentials`, user, live: this.live.status().live };
  }

  /** Admin: encoder settings for Meld Studio / OBS / any RTMP app. */
  @Get("encoder-settings")
  @UseGuards(SupabaseAuthGuard)
  @Auth("admin")
  encoderSettings() {
    const key = this.config.get("MELD_STREAM_KEY") ?? "";
    // 443 carries both HTTPS and plain RTMP (nginx stream ssl_preread), so an
    // encoder that only fills in server + key lands on the MediaMTX path too.
    const server = "rtmp://essentialsedm.com:443";
    return {
      server,
      streamKey: key,
      fullUrl: key ? `${server}/${key}` : server,
      viewerHls: "https://essentialsedm.com/hls/live.m3u8",
      viewerRtsp: `rtsp://essentialsedm.com:8554/${key}`,
    };
  }

  // ===== DJ live-session bookings =====

  /** DJ: their upcoming live-session bookings, soonest first. */
  @Get("bookings")
  @Auth("artist", "admin")
  bookings(@CurrentUser() user: JwtUser) {
    return this.liveBookings.list(user);
  }

  /** DJ: the booking covering right now, and whether one is required (admins are exempt). */
  @Get("bookings/active")
  @Auth("artist", "admin")
  activeBooking(@CurrentUser() user: JwtUser) {
    return this.liveBookings.active(user);
  }

  /** DJ: book a stream window. Going live is refused outside it. */
  @Post("bookings")
  @HttpCode(200)
  @Auth("artist", "admin")
  createBooking(@CurrentUser() user: JwtUser, @Body() dto: LiveBookingDto) {
    return this.liveBookings.create(user, dto);
  }

  /** DJ: cancel one of their own sessions. */
  @Delete("bookings/:id")
  @Auth("artist", "admin")
  cancelBooking(@CurrentUser() user: JwtUser, @Param("id") id: string) {
    return this.liveBookings.cancel(user, id);
  }

  // ===== Simulcast targets (YouTube / TikTok / Mixcloud / Facebook / Instagram / custom) =====

  /** Admin: list stream targets (stream keys masked). */
  @Get("targets")
  @UseGuards(SupabaseAuthGuard)
  @Auth("admin")
  async targets() {
    const states = this.simulcast.states();
    const rows = await prisma.streamTarget.findMany({ orderBy: { createdAt: "asc" } });
    return rows.map((t) => ({
      id: t.id,
      platform: t.platform,
      label: t.label,
      url: t.url.replace(/\/([^/]{4})[^/]*$/, "/…$1"),
      enabled: t.enabled,
      live: !!states[t.id],
    }));
  }

  /** Admin: add a platform target. URL = full RTMP(S) push URL including stream key. */
  @Post("targets")
  @HttpCode(200)
  @UseGuards(SupabaseAuthGuard)
  @Auth("admin")
  async addTarget(@CurrentUser() user: JwtUser, @Body() dto: TargetDto) {
    const t = await prisma.streamTarget.create({
      data: { platform: dto.platform, url: dto.url.trim(), label: dto.label ?? null, createdBy: user.sub },
    });
    return { id: t.id, platform: t.platform, label: t.label, enabled: t.enabled };
  }

  /** Admin: enable/disable a target — starts/stops its push immediately when broadcasting. */
  @Post("targets/:id/toggle")
  @HttpCode(200)
  @UseGuards(SupabaseAuthGuard)
  @Auth("admin")
  async toggle(@Param("id") id: string) {
    const t = await prisma.streamTarget.findUnique({ where: { id } });
    if (!t) return { ok: false };
    const enabled = !t.enabled;
    await prisma.streamTarget.update({ where: { id }, data: { enabled } });
    const status = this.live.status();
    if (enabled && status.live) this.simulcast.startOne(id, t.url);
    else this.simulcast.stopOne(id);
    return { id, enabled };
  }

  /** Admin: delete a target. */
  @Delete("targets/:id")
  @UseGuards(SupabaseAuthGuard)
  @Auth("admin")
  async removeTarget(@Param("id") id: string) {
    this.simulcast.stopOne(id);
    await prisma.streamTarget.delete({ where: { id } }).catch(() => null);
    return { ok: true };
  }
}
