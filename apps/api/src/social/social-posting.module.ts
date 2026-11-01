import { Module } from "@nestjs/common";
import { SocialController } from "./social.controller";
import { SocialPublishService } from "./social-publish.service";
import { SocialAgentService } from "./social-agent.service";
import { SocialSchedulerService } from "./social-scheduler.service";

@Module({
  controllers: [SocialController],
  providers: [SocialPublishService, SocialAgentService, SocialSchedulerService],
})
export class SocialPostingModule {}
