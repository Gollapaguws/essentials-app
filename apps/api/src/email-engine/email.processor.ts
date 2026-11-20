import { Processor, WorkerHost } from "@nestjs/bullmq";
import { Job, Worker } from "bullmq";
import { MailQuotaError } from "../mail/mail-quota.error";
import { EmailSenderService } from "./email-sender.service";
import { EmailQuotaService, msUntilNextUtcDay } from "./email-quota.service";

/** BullMQ worker — active only when REDIS_URL is configured. */
@Processor("email")
export class EmailProcessor extends WorkerHost {
  constructor(
    private sender: EmailSenderService,
    private quota: EmailQuotaService,
  ) {
    super();
  }

  async process(job: Job<{ campaignId: string; userId: string }>) {
    // A large campaign spreads across days: once the daily allowance is used,
    // the whole queue idles until the UTC quota window reopens.
    const wait = await this.quota.waitMs();
    if (wait > 0) return this.defer(wait);

    try {
      await this.sender.sendCampaignEmail(job.data.campaignId, job.data.userId);
    } catch (err) {
      // The provider can still say no if our own count drifted; treat it as a
      // window to wait for, not as a failed recipient.
      if (err instanceof MailQuotaError) return this.defer(msUntilNextUtcDay());
      throw err;
    }
  }

  /** Put the job back and idle the worker until the daily window reopens. */
  private async defer(waitMs: number): Promise<never> {
    await this.worker.rateLimit(waitMs);
    throw Worker.RateLimitError();
  }
}
