import { Controller, Get, UseGuards } from "@nestjs/common";
import { AuthGuard } from "@nestjs/passport";
import { AnalyticsService } from "./analytics.service";
import { Auth, CurrentUser } from "../common/auth.decorator";
import type { JwtUser } from "../common/roles.guard";

@Controller("analytics")
@UseGuards(AuthGuard("jwt"))
export class AnalyticsController {
  constructor(private analytics: AnalyticsService) {}

  @Get("overview")
  @Auth("promoter")
  overview(@CurrentUser() user: JwtUser) {
    return this.analytics.overview(user);
  }
}
