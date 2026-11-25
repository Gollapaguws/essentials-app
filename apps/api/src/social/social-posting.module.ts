import { Module } from "@nestjs/common";
import { BillingModule } from "../billing/billing.module";
import { SocialController } from "./social.controller";
import { SocialPublishService } from "./social-publish.service";
import { SocialAgentService } from "./social-agent.service";
import { SocialSchedulerService } from "./social-scheduler.service";

@Module({
  imports: [BillingModule],
  controllers: [SocialController],
  providers: [SocialPublishService, SocialAgentService, SocialSchedulerService],
  exports: [SocialPublishService],
})
export class SocialPostingModule {}
