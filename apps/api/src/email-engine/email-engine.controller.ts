import { Controller, Get, Post, Body, Param, Query, Res } from "@nestjs/common";
import type { Response } from "express";
import { EmailEngineService } from "./email-engine.service";
import { Auth, CurrentUser } from "../common/auth.decorator";
import type { JwtUser } from "../common/roles.guard";
import { IsString, IsOptional } from "class-validator";

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
  @Get("unsubscribe")
  async unsubscribePage(@Query("email") email: string, @Res() res: Response) {
    if (email) await this.engine.unsubscribe(email);
    res.type("html").send(
      `<html><body style="background:#0A0A0A;color:#fff;font-family:sans-serif;display:grid;place-items:center;height:100vh">
      <div style="text-align:center"><h1 style="color:#00FF66">ESSENTIALS</h1>
      <p>${email ? "You're unsubscribed. No more emails." : "Missing email parameter."}</p>
      <p><a href="/api/email/preferences?email=${encodeURIComponent(email ?? "")}" style="color:#00FF66">Manage preferences</a></p></div></body></html>`,
    );
  }

  @Get("preferences")
  async preferences(@Query("email") email: string, @Res() res: Response) {
    const status = email ? (await this.engine.getConsent(email)).status : "unknown";
    res.type("html").send(
      `<html><body style="background:#0A0A0A;color:#fff;font-family:sans-serif;display:grid;place-items:center;height:100vh">
      <div style="text-align:center"><h1 style="color:#00FF66">ESSENTIALS · Preferences</h1>
      <p>Status for ${email ?? "—"}: <strong>${status}</strong></p>
      <form method="post" action="/api/email/resubscribe">
        <input type="hidden" name="email" value="${email ?? ""}" />
        <button style="background:#00FF66;color:#0A0A0A;padding:10px 20px;border:0;border-radius:6px;font-weight:bold">Re-subscribe</button>
      </form></div></body></html>`,
    );
  }

  @Post("resubscribe")
  async resubscribe(@Body("email") email: string, @Res() res: Response) {
    if (email) await this.engine.grantConsent(email);
    res.redirect(`/api/email/preferences?email=${encodeURIComponent(email ?? "")}`);
  }
}
