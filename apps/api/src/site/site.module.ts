import { Module } from "@nestjs/common";
import { SiteController } from "./site.controller";
import { SiteContentController } from "./site-content.controller";
import { SiteContentService } from "./site-content.service";
import { SiteService } from "./site.service";
import { SiteStatsService } from "./site-stats.service";
import { RetentionService } from "./retention.service";

@Module({ controllers: [SiteController, SiteContentController], providers: [SiteService, SiteContentService, SiteStatsService, RetentionService],
  exports: [RetentionService] })
export class SiteModule {}
