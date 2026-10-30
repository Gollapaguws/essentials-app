import { Module } from "@nestjs/common";
import { SiteController } from "./site.controller";
import { SiteContentController } from "./site-content.controller";
import { SiteContentService } from "./site-content.service";
import { SiteService } from "./site.service";

@Module({ controllers: [SiteController, SiteContentController], providers: [SiteService, SiteContentService] })
export class SiteModule {}
