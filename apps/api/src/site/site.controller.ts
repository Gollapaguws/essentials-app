import { Controller, Post, Body, HttpCode } from "@nestjs/common";
import { SiteService } from "./site.service";
import { IsEmail } from "class-validator";

class SubscribeDto {
  @IsEmail() email!: string;
}

/** Public (no auth) — used by the essentialsedm.com front page. */
@Controller("site")
export class SiteController {
  constructor(private site: SiteService) {}

  @Post("subscribe")
  @HttpCode(200)
  subscribe(@Body() dto: SubscribeDto) {
    return this.site.subscribe(dto.email);
  }
}
