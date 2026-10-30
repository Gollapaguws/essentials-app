import { Module } from "@nestjs/common";
import { ConfigModule, ConfigService } from "@nestjs/config";
import { ScheduleModule } from "@nestjs/schedule";
import { ThrottlerModule, ThrottlerGuard } from "@nestjs/throttler";
import { APP_GUARD } from "@nestjs/core";
import { AuthModule } from "./auth/auth.module";
import { MailModule } from "./mail/mail.module";
import { EventsModule } from "./events/events.module";
import { LoyaltyModule } from "./loyalty/loyalty.module";
import { EmailEngineModule } from "./email-engine/email-engine.module";
import { AnalyticsModule } from "./analytics/analytics.module";
import { VenuesModule } from "./venues/venues.module";
import { SocialModule } from "./social/social.module";
import { PromotionsModule } from "./promotions/promotions.module";
import { ArtistsModule } from "./artists/artists.module";
import { PaymentsModule } from "./payments/payments.module";
import { InsightsModule } from "./insights/insights.module";
import { SiteModule } from "./site/site.module";

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true, envFilePath: ["../../.env", ".env"] }),
    ScheduleModule.forRoot(),
    ThrottlerModule.forRoot([{ ttl: 60_000, limit: 120 }]),
    AuthModule,
    MailModule,
    EventsModule,
    LoyaltyModule,
    EmailEngineModule.register(),
    VenuesModule,
    SocialModule,
    PromotionsModule,
    ArtistsModule,
    AnalyticsModule,
    PaymentsModule,
    InsightsModule,
    SiteModule,
  ],
  providers: [{ provide: APP_GUARD, useClass: ThrottlerGuard }],
})
export class AppModule {}
