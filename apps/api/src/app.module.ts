import { Module } from "@nestjs/common";
import { ConfigModule, ConfigService } from "@nestjs/config";
import { ScheduleModule } from "@nestjs/schedule";
import { ThrottlerModule, ThrottlerGuard } from "@nestjs/throttler";
import { APP_GUARD } from "@nestjs/core";
import { REDIS, RedisModule } from "./common/redis.provider";
import { RedisThrottlerStorage } from "./common/redis-throttler.storage";
import { AuthModule } from "./auth/auth.module";
import { MailModule } from "./mail/mail.module";
import { EventsModule } from "./events/events.module";
import { LoyaltyModule } from "./loyalty/loyalty.module";
import { EmailEngineModule } from "./email-engine/email-engine.module";
import { AnalyticsModule } from "./analytics/analytics.module";
import { VenuesModule } from "./venues/venues.module";
import { PromotionsModule } from "./promotions/promotions.module";
import { ArtistsModule } from "./artists/artists.module";
import { PaymentsModule } from "./payments/payments.module";
import { InsightsModule } from "./insights/insights.module";
import { SiteModule } from "./site/site.module";
import { LiveModule } from "./live/live.module";
import { MailboxesModule } from "./mailboxes/mailboxes.module";
import { NotificationsModule } from "./notifications/notifications.module";
import { SocialPostingModule } from "./social/social-posting.module";

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true, envFilePath: ["../../.env", ".env"] }),
    ScheduleModule.forRoot(),
    RedisModule,
    ThrottlerModule.forRootAsync({
      imports: [RedisModule],
      inject: [REDIS],
      useFactory: (redis: ConstructorParameters<typeof RedisThrottlerStorage>[0]) => ({
        throttlers: [{ ttl: 60_000, limit: 120 }],
        storage: new RedisThrottlerStorage(redis),
      }),
    }),
    AuthModule,
    MailModule,
    EventsModule,
    LoyaltyModule,
    EmailEngineModule.register(),
    VenuesModule,
    PromotionsModule,
    ArtistsModule,
    AnalyticsModule,
    PaymentsModule,
    InsightsModule,
    SiteModule,
    LiveModule,
    MailboxesModule,
    NotificationsModule,
    SocialPostingModule,
  ],
  providers: [{ provide: APP_GUARD, useClass: ThrottlerGuard }],
})
export class AppModule {}
