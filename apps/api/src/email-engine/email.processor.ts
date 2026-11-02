import { Processor, WorkerHost } from "@nestjs/bullmq";
import { Job } from "bullmq";
import { EmailSenderService } from "./email-sender.service";

/** BullMQ worker — active only when REDIS_URL is configured. */
@Processor("email")
export class EmailProcessor extends WorkerHost {
  constructor(private sender: EmailSenderService) {
    super();
  }

  async process(job: Job<{ campaignId: string; userId: string }>) {
    await this.sender.sendCampaignEmail(job.data.campaignId, job.data.userId);
  }
}
