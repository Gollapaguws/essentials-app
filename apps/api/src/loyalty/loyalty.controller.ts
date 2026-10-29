import { Controller, Get, UseGuards } from "@nestjs/common";
import { AuthGuard } from "@nestjs/passport";
import { ConfigService } from "@nestjs/config";
import { LoyaltyService } from "./loyalty.service";
import { CurrentUser } from "../common/auth.decorator";
import type { JwtUser } from "../common/roles.guard";

@Controller("loyalty")
@UseGuards(AuthGuard("jwt"))
export class LoyaltyController {
  constructor(private loyalty: LoyaltyService, private config: ConfigService) {}

  @Get()
  status(@CurrentUser() user: JwtUser) {
    return this.loyalty.status(user);
  }

  @Get("referral")
  referral(@CurrentUser() user: JwtUser) {
    return this.loyalty.referralInfo(user, this.config.get("APP_URL") ?? "http://localhost:3001");
  }
}
