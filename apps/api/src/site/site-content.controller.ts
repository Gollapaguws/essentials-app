import { Body, Controller, Delete, Get, Post, HttpCode, Param, UseGuards, Res, UploadedFile, UseInterceptors, BadRequestException } from "@nestjs/common";
import { SupabaseAuthGuard } from "../auth/supabase-auth.guard";
import { ConfigService } from "@nestjs/config";
import type { Response } from "express";
import { FileInterceptor } from "@nestjs/platform-express";
import { randomBytes } from "crypto";
import { mkdirSync, writeFileSync } from "fs";
import { join, extname } from "path";
import { SiteContentService, FrontPageContent } from "./site-content.service";
import { SiteStatsService } from "./site-stats.service";
import { PublicEventsService } from "./public-events.service";
import { PublicDjsService } from "./public-djs.service";
import { ChangelogService } from "./changelog.service";
import { Auth, CurrentUser } from "../common/auth.decorator";
import type { JwtUser } from "../common/roles.guard";
import { IsString, MaxLength } from "class-validator";

class SiteVisitDto {
  @IsString() @MaxLength(100) path!: string;
}

/**
 * Public + admin front-page endpoints for essentialsedm.com.
 * GET /site/content public · POST /site/content admin · media upload admin ·
 * visit beacon public · my-data export authenticated · health public.
 */
@Controller("site")
export class SiteContentController {
  constructor(
    private content: SiteContentService,
    private siteStats: SiteStatsService,
    private config: ConfigService,
    private publicEvents: PublicEventsService,
    private publicDjs: PublicDjsService,
    private changelog: ChangelogService,
  ) {}

  @Get("content")
  get() {
    return this.content.get();
  }

  /** Release notes for the site's what's-new page, read from CHANGELOG.md. */
  @Get("changelog")
  changelogNotes() {
    return this.changelog.get();
  }

  /** Public event pages and the links inside guest emails. No session. */
  @Get("events")
  events() {
    return this.publicEvents.list();
  }

  @Get("events/:id")
  event(@Param("id") id: string) {
    return this.publicEvents.detail(id);
  }

  /** Public DJ roster and profiles. No session: the lineup links to these. */
  @Get("djs")
  djs() {
    return this.publicDjs.list();
  }

  @Get("djs/:id")
  dj(@Param("id") id: string) {
    return this.publicDjs.detail(id);
  }

  @Post("content")
  @HttpCode(200)
  @UseGuards(SupabaseAuthGuard)
  @Auth("admin")
  save(@Body() body: FrontPageContent) {
    return this.content.save(body);
  }

  @Delete("content")
  @UseGuards(SupabaseAuthGuard)
  @Auth("admin")
  reset() {
    return this.content.reset();
  }

  /** Admin image/video upload for the front-page editor (slides, visuals, room loop). */
  @Post("media")
  @UseGuards(SupabaseAuthGuard)
  @Auth("admin")
  @UseInterceptors(FileInterceptor("file", { limits: { fileSize: 120 * 1024 * 1024 } }))
  upload(@UploadedFile() file?: Express.Multer.File) {
    if (!file) throw new BadRequestException("No file");
    const ext = extname(file.originalname).toLowerCase();
    const isImage = [".jpg", ".jpeg", ".png", ".webp", ".avif"].includes(ext) && file.mimetype.startsWith("image/");
    const isVideo = [".mp4", ".webm", ".mov"].includes(ext) && file.mimetype.startsWith("video/");
    if (!isImage && !isVideo) {
      throw new BadRequestException("Only jpg/png/webp/avif images or mp4/webm/mov video");
    }
    if (isImage && file.size > 10 * 1024 * 1024) {
      throw new BadRequestException("Images must be 10 MB or smaller");
    }
    if (isVideo && file.size > 120 * 1024 * 1024) {
      throw new BadRequestException("Video must be 120 MB or smaller");
    }
    const mediaDir = this.config.get("MEDIA_DIR") ?? "/var/www/essentialsedm/media";
    mkdirSync(mediaDir, { recursive: true });
    const name = `${Date.now()}-${randomBytes(4).toString("hex")}${ext}`;
    writeFileSync(join(mediaDir, name), file.buffer);
    const publicBase = this.config.get("PUBLIC_MEDIA_URL") ?? "/media";
    return { ok: true, url: `${publicBase}/${name}` };
  }

  /** POPIA-friendly analytics beacon (no cookies, IP hashed daily). */
  @Post("visit")
  @HttpCode(200)
  visit(@Body() dto: SiteVisitDto, @Res() res: Response) {
    const ip = (res.req.headers["x-forwarded-for"] as string)?.split(",")[0] ?? res.req.socket.remoteAddress ?? "";
    void this.siteStats.recordVisit(dto.path ?? "/", ip.trim());
    res.json({ ok: true });
  }

  /** Privacy data export for the signed-in user. */
  @Get("my-data")
  @UseGuards(SupabaseAuthGuard)
  myData(@CurrentUser() user: JwtUser) {
    return this.siteStats.myData(user);
  }

  /** Admin: front-page traffic, last 30 days. */
  @Get("stats")
  @UseGuards(SupabaseAuthGuard)
  @Auth("admin")
  stats() {
    return this.siteStats.stats();
  }

  @Get("health")
  @HttpCode(200)
  health() {
    return { ok: true, service: "essentials-api", time: new Date().toISOString() };
  }
}
