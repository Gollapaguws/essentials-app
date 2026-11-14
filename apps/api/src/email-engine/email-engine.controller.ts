import { Controller, Get, Post, Delete, Body, Param, Query, Res, Req, UploadedFile, UseInterceptors, BadRequestException } from "@nestjs/common";
import type { Request, Response } from "express";
import { FileInterceptor } from "@nestjs/platform-express";
import { ConfigService } from "@nestjs/config";
import { extname } from "path";
import { EmailEngineService } from "./email-engine.service";
import { Auth, CurrentUser } from "../common/auth.decorator";
import type { JwtUser } from "../common/roles.guard";
import { IsString, IsOptional, MaxLength, IsArray, ArrayMaxSize, IsEmail, IsBoolean } from "class-validator";
import { Throttle } from "@nestjs/throttler";
import { escapeHtml } from "../common/html";
import { readUnsubscribeToken } from "../mail/unsubscribe";
import { MAX_PROFILE_IMAGE_BYTES, storeImage } from "../common/media-storage";

class SegmentDto {
  @IsString() name!: string;
  @IsOptional() filter?: object;
}
class EmailDto {
  @IsString()
  @IsEmail()
  email!: string;
}
class ContactSelectionDto {
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(5000)
  @IsString({ each: true })
  emails?: string[];
  @IsOptional() @IsBoolean() allMatching?: boolean;
  @IsOptional() @IsString() @MaxLength(320) q?: string;
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(5000)
  @IsString({ each: true })
  excluded?: string[];
}
class CampaignDto {
  @IsString() name!: string;
  @IsString() flow!: string;
  @IsString() subject!: string;
  @IsOptional() @IsString() segmentId?: string;
  @IsOptional() @IsString() eventId?: string;
  @IsOptional() @IsString() @MaxLength(500_000) html?: string;
}

@Controller("email")
export class EmailEngineController {
  constructor(
    private engine: EmailEngineService,
    private config: ConfigService,
  ) {}

  @Post("segments")
  @Auth("promoter")
  createSegment(@CurrentUser() user: JwtUser, @Body() dto: SegmentDto) {
    return this.engine.createSegment(user, dto.name, dto.filter ?? {});
  }

  @Get("segments")
  @Auth("promoter")
  segments() {
    return this.engine.listSegments();
  }

  /** Paginated contacts for one imported mailing list. */
  @Get("segments/:id/contacts")
  @Auth("promoter")
  contacts(
    @CurrentUser() user: JwtUser,
    @Param("id") id: string,
    @Query("page") page?: string,
    @Query("pageSize") pageSize?: string,
    @Query("q") q?: string,
  ) {
    return this.engine.listSegmentContacts(user, id, Number(page) || 1, Number(pageSize) || 50, q ?? "");
  }

  /** Remove an address from a list without revoking consent or deleting the guest. */
  @Delete("segments/:id/contacts")
  @Auth("promoter")
  removeContact(@CurrentUser() user: JwtUser, @Param("id") id: string, @Query("email") email?: string) {
    if (!email) throw new BadRequestException("Email is required");
    return this.engine.removeSegmentContact(user, id, email);
  }

  /** Remove several contacts from a list in one request. */
  @Post("segments/:id/contacts/bulk-remove")
  @Auth("promoter")
  bulkRemoveContacts(@CurrentUser() user: JwtUser, @Param("id") id: string, @Body() dto: ContactSelectionDto) {
    return this.engine.removeSegmentContacts(user, id, dto);
  }

  /** Revoke email consent for selected contacts without removing them from the list. */
  @Post("segments/:id/contacts/bulk-unsubscribe")
  @Auth("promoter")
  bulkUnsubscribeContacts(@CurrentUser() user: JwtUser, @Param("id") id: string, @Body() dto: ContactSelectionDto) {
    return this.engine.unsubscribeContacts(user, id, dto);
  }

  /** Revoke email consent for one contact from the manager. */
  @Post("consent/unsubscribe")
  @Auth("promoter")
  unsubscribeContact(@CurrentUser() user: JwtUser, @Body() dto: EmailDto) {
    return this.engine.unsubscribeContact(user, dto.email);
  }

  /** Download a saved list as CSV (email, name, consent). */
  @Get("segments/:id/export")
  @Auth("promoter")
  async exportSegment(@CurrentUser() user: JwtUser, @Param("id") id: string, @Res() res: Response) {
    const { filename, csv } = await this.engine.exportSegmentCsv(user, id);
    this.sendCsv(res, filename, csv);
  }

  /** Download only the selected contacts (or all contacts matching a search) as CSV. */
  @Post("segments/:id/export")
  @Auth("promoter")
  async exportSelectedContacts(
    @CurrentUser() user: JwtUser,
    @Param("id") id: string,
    @Body() dto: ContactSelectionDto,
    @Res() res: Response,
  ) {
    const { filename, csv } = await this.engine.exportSegmentCsv(user, id, dto);
    this.sendCsv(res, filename, csv);
  }

  private sendCsv(res: Response, filename: string, csv: string) {
    res.setHeader("Content-Type", "text/csv; charset=utf-8");
    res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
    res.send(csv);
  }

  /** Delete a saved list. Campaigns keep their history; their segment reference is cleared. */
  @Delete("segments/:id")
  @Auth("promoter")
  deleteSegment(@CurrentUser() user: JwtUser, @Param("id") id: string) {
    return this.engine.deleteSegment(user, id);
  }

  /**
   * Import a CSV/TSV address list as consenting guests + a targetable segment.
   * `attested` must be the string "true": the uploader confirms every contact
   * opted in, and that confirmation is stored with the segment and consent rows.
   */
  @Post("segments/upload")
  @Auth("promoter")
  @UseInterceptors(FileInterceptor("file", { limits: { fileSize: 2 * 1024 * 1024 } }))
  uploadMailingList(
    @CurrentUser() user: JwtUser,
    @Body() body: { attested?: string },
    @UploadedFile() file?: Express.Multer.File,
  ) {
    if (!file) throw new BadRequestException("No file");
    const ext = extname(file.originalname).toLowerCase();
    if (![".csv", ".tsv", ".txt"].includes(ext)) {
      throw new BadRequestException("Upload a CSV, TSV or TXT file");
    }
    return this.engine.importMailingList(user, file, body?.attested === "true");
  }

  /** Upload an image for pasted campaign HTML and return an absolute URL. */
  @Post("upload")
  @Auth("promoter")
  @UseInterceptors(FileInterceptor("file", { limits: { fileSize: MAX_PROFILE_IMAGE_BYTES } }))
  uploadImage(
    @UploadedFile() file: Express.Multer.File | undefined,
    @Req() req: Request,
  ) {
    if (!file) throw new BadRequestException("No file");
    const mediaDir = this.config.get<string>("MEDIA_DIR") ?? "/var/www/essentialsedm/media";
    const publicBase = this.config.get<string>("PUBLIC_MEDIA_URL") ?? "/media";
    const origin = (this.config.get<string>("SITE_URL") ?? `${req.protocol}://${req.get("host")}`).replace(/\/+$/, "");
    return { ok: true, ...storeImage(file, { mediaDir, publicBase, origin }) };
  }

  @Post("campaigns")
  @Auth("promoter")
  send(@CurrentUser() user: JwtUser, @Body() dto: CampaignDto) {
    return this.engine.enqueueCampaign(user, dto);
  }

  @Get("campaigns")
  @Auth("promoter")
  campaigns(@CurrentUser() user: JwtUser) {
    return this.engine.listCampaigns(user);
  }

  @Get("campaigns/:id/attribution")
  @Auth("promoter")
  attribution(@CurrentUser() user: JwtUser, @Param("id") id: string) {
    return this.engine.attribution(user, id);
  }

  // ---- public endpoints (no auth): unsubscribe & preference center ----
  //
  // Anyone can open these URLs, so the address is carried by an HMAC-signed,
  // expiring token (`mail/unsubscribe.ts`) instead of a raw `?email=`. A raw
  // address would let a stranger unsubscribe anyone they can name.

  @Get("unsubscribe")
  @Throttle({ default: { limit: 30, ttl: 60_000 } })
  async unsubscribePage(@Query("token") token: string | undefined, @Res() res: Response) {
    const email = token ? readUnsubscribeToken(token) : null;
    if (email) await this.engine.unsubscribe(email);
    const prefs = email ? `/api/email/preferences?token=${encodeURIComponent(token ?? "")}` : null;
    res.type("html").send(
      `<html><body style="background:#0A0A0A;color:#fff;font-family:sans-serif;display:grid;place-items:center;height:100vh">
      <div style="text-align:center"><h1 style="color:#00FF66">ESSENTIALS</h1>
      <p>${email ? "You're unsubscribed. No more emails." : "This unsubscribe link is invalid or has expired."}</p>
      ${prefs ? `<p><a href="${escapeHtml(prefs)}" style="color:#00FF66">Manage preferences</a></p>` : ""}
      </div></body></html>`,
    );
  }

  @Get("preferences")
  @Throttle({ default: { limit: 30, ttl: 60_000 } })
  async preferences(@Query("token") token: string | undefined, @Res() res: Response) {
    const email = token ? readUnsubscribeToken(token) : null;
    const status = email ? (await this.engine.getConsent(email)).status : "unknown";
    const safeToken = escapeHtml(token ?? "");
    const body = email
      ? `<p>Status for ${escapeHtml(email)}: <strong>${escapeHtml(status)}</strong></p>
      <form method="post" action="/api/email/resubscribe">
        <input type="hidden" name="token" value="${safeToken}" />
        <button style="background:#00FF66;color:#0A0A0A;padding:10px 20px;border:0;border-radius:6px;font-weight:bold">Re-subscribe</button>
      </form>`
      : `<p>This preferences link is invalid or has expired.</p>`;
    res.type("html").send(
      `<html><body style="background:#0A0A0A;color:#fff;font-family:sans-serif;display:grid;place-items:center;height:100vh">
      <div style="text-align:center"><h1 style="color:#00FF66">ESSENTIALS · Preferences</h1>
      ${body}</div></body></html>`,
    );
  }

  @Post("resubscribe")
  @Throttle({ default: { limit: 30, ttl: 60_000 } })
  async resubscribe(@Body("token") token: string | undefined, @Res() res: Response) {
    const email = token ? readUnsubscribeToken(token) : null;
    if (email) await this.engine.grantConsent(email);
    res.redirect(
      email ? `/api/email/preferences?token=${encodeURIComponent(token!)}` : "/api/email/preferences",
    );
  }
}
