import { Controller, Get, Query, UseGuards } from "@nestjs/common";
import { Throttle } from "@nestjs/throttler";
import { SupabaseAuthGuard } from "../auth/supabase-auth.guard";
import { CurrentUser } from "../common/auth.decorator";
import type { JwtUser } from "../common/roles.guard";
import { SearchService } from "./search.service";

@Controller("search")
@UseGuards(SupabaseAuthGuard)
export class SearchController {
  constructor(private readonly search: SearchService) {}

  /** The dashboard palette: one query, three groups, scoped by role. */
  @Get()
  @Throttle({ default: { limit: 120, ttl: 60_000 } })
  find(@Query("q") q: string, @CurrentUser() user: JwtUser) {
    return this.search.find(user, q ?? "");
  }
}
