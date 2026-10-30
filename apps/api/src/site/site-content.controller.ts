import { Body, Controller, Delete, Get, HttpCode, Post, UseGuards } from "@nestjs/common";
import { AuthGuard } from "@nestjs/passport";
import { SiteContentService, FrontPageContent } from "./site-content.service";
import { Auth } from "../common/auth.decorator";

/** Front-page content. GET is public (used by essentialsedm.com); POST/DELETE admin-only. */
@Controller("site")
export class SiteContentController {
  constructor(private content: SiteContentService) {}

  @Get("content")
  get() {
    return this.content.get();
  }

  @Post("content")
  @HttpCode(200)
  @UseGuards(AuthGuard("jwt"))
  @Auth("admin")
  save(@Body() body: FrontPageContent) {
    return this.content.save(body);
  }

  @Delete("content")
  @UseGuards(AuthGuard("jwt"))
  @Auth("admin")
  reset() {
    return this.content.reset();
  }
}
