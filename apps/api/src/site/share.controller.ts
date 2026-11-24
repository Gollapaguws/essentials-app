import { Controller, Get, Param, Res } from "@nestjs/common";
import { Throttle } from "@nestjs/throttler";
import type { Response } from "express";
import { ShareService } from "./share.service";

/**
 * Public social images. A link pasted into WhatsApp, Telegram or a story should
 * show the night, so these are generated per event/DJ instead of one brand logo
 * for every page. Public and cacheable: they carry nothing a logged-out visitor
 * cannot already see on the site.
 */
@Controller("site/share")
export class ShareController {
  constructor(private readonly share: ShareService) {}

  @Get("event/:id")
  @Throttle({ default: { limit: 120, ttl: 60_000 } })
  event(@Param("id") id: string, @Res() res: Response) {
    return this.send(res, () => this.share.eventCard(id));
  }

  @Get("dj/:id")
  @Throttle({ default: { limit: 120, ttl: 60_000 } })
  dj(@Param("id") id: string, @Res() res: Response) {
    return this.send(res, () => this.share.djCard(id));
  }

  private async send(res: Response, build: () => Promise<Buffer>): Promise<void> {
    const png = await build();
    res.setHeader("Content-Type", "image/png");
    res.setHeader("Content-Length", String(png.length));
    // Short enough that a lineup change appears, long enough that a share spike
    // does not re-render for every unfurl.
    res.setHeader("Cache-Control", "public, max-age=300");
    res.end(png);
  }
}
