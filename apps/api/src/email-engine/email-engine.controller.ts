import { Controller, Get, Post, Body, Param, Query, Res } from "@nestjs/common";
import type { Response } from "express";
import { EmailEngineService } from "./email-engine.service";
import { Auth, CurrentUser } from "../common/auth.decorator";
import type { JwtUser } from "../common/roles.guard";
import { IsString, IsOptional } from "class-validator";
import { Throttle } from "@nestjs/throttler";
import { escapeHtml } from "../common/html";
import { readUnsubscribeToken } from "../mail/unsubscribe";

class SegmentDto {
  @IsString() name!: string;
  @IsOptional() filter?: object;
}
class CampaignDto {
  @IsString() name!: string;
  @IsString() flow!: string;
  @IsString() subject!: string;
  @IsOptional() @IsString() segmentId?: string;
  @IsOptional() @IsString() eventId?: string;
}

@Controller("email")
export class EmailEngineController {
  constructor(private engine: EmailEngineService) {}

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
