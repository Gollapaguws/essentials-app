import { Module } from "@nestjs/common";
import { SiteController } from "./site.controller";
import { SiteContentController } from "./site-content.controller";
import { SiteContentService } from "./site-content.service";
import { SiteService } from "./site.service";
import { SiteStatsService } from "./site-stats.service";
import { RetentionService } from "./retention.service";
import { MediaCleanupService } from "./media-cleanup.service";
import { LiveChatController } from "./live-chat.controller";
import { LiveChatService } from "./live-chat.service";
import { PublicEventsService } from "./public-events.service";

@Module({ controllers: [SiteController, SiteContentController, LiveChatController], providers: [SiteService, SiteContentService, SiteStatsService, RetentionService, MediaCleanupService, LiveChatService, PublicEventsService],
  exports: [RetentionService] })
export class SiteModule {}
