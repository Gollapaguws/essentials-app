import { Controller, Get, UseGuards } from "@nestjs/common";
import { AuthGuard } from "@nestjs/passport";
import { InsightsService } from "./insights.service";
import { Auth, CurrentUser } from "../common/auth.decorator";
import type { JwtUser } from "../common/roles.guard";

@Controller("insights")
@UseGuards(AuthGuard("jwt"))
export class InsightsController {
  constructor(private insights: InsightsService) {}

  @Get("ltv")
  @Auth("promoter")
  ltv(@CurrentUser() user: JwtUser) {
    return this.insights.ltv(user);
  }

  @Get("cohorts")
  @Auth("promoter")
  cohorts(@CurrentUser() user: JwtUser) {
    return this.insights.cohorts(user);
  }
}
