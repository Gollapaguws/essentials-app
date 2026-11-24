import { Module } from "@nestjs/common";
import { SiteContentController } from "./site-content.controller";
import { SiteContentService } from "./site-content.service";
import { SiteStatsService } from "./site-stats.service";
import { MediaCleanupService } from "./media-cleanup.service";
import { LiveChatController } from "./live-chat.controller";
import { LiveChatService } from "./live-chat.service";
import { PublicEventsService } from "./public-events.service";
import { PublicDjsService } from "./public-djs.service";
import { ChangelogService } from "./changelog.service";
import { ShareController } from "./share.controller";
import { ShareService } from "./share.service";
import { SitemapController } from "./sitemap.controller";

@Module({ controllers: [SiteContentController, LiveChatController, ShareController, SitemapController], providers: [SiteContentService, SiteStatsService, MediaCleanupService, LiveChatService, PublicEventsService, PublicDjsService, ChangelogService, ShareService] })
export class SiteModule {}
