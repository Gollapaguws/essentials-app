import { Module } from "@nestjs/common";
import { ConfigModule, ConfigService } from "@nestjs/config";
import { ScheduleModule } from "@nestjs/schedule";
import { AuthModule } from "./auth/auth.module";
import { MailModule } from "./mail/mail.module";
import { EventsModule } from "./events/events.module";
import { TablesModule } from "./tables/tables.module";
import { LoyaltyModule } from "./loyalty/loyalty.module";
import { EmailEngineModule } from "./email-engine/email-engine.module";
import { AnalyticsModule } from "./analytics/analytics.module";
import { VenuesModule } from "./venues/venues.module";
import { SocialModule } from "./social/social.module";
import { PromotionsModule } from "./promotions/promotions.module";

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true, envFilePath: ["../../.env", ".env"] }),
    ScheduleModule.forRoot(),
    AuthModule,
    MailModule,
    EventsModule,
    TablesModule,
    LoyaltyModule,
    EmailEngineModule.register(),
    VenuesModule,
    SocialModule,
    PromotionsModule,
    AnalyticsModule,
  ],
})
export class AppModule {}
