import { EmailProcessor } from "./email.processor";
import { MailQuotaError } from "../mail/mail-quota.error";

function processor(sender: { sendCampaignEmail: jest.Mock }, waitMs: number) {
  const quota = { waitMs: jest.fn().mockResolvedValue(waitMs) };
  const instance = new EmailProcessor(sender as never, quota as never);
  const rateLimit = jest.fn().mockResolvedValue(undefined);
  Object.defineProperty(instance, "worker", { value: { rateLimit }, configurable: true });
  return { instance, rateLimit, quota };
}

const job = { data: { campaignId: "campaign-1", userId: "user-1" } } as never;

describe("EmailProcessor quota pacing", () => {
  it("idles the worker without sending when today's allowance is spent", async () => {
    const sender = { sendCampaignEmail: jest.fn() };
    const { instance, rateLimit } = processor(sender, 3_600_000);

    await expect(instance.process(job)).rejects.toMatchObject({ name: "RateLimitError" });
    expect(sender.sendCampaignEmail).not.toHaveBeenCalled();
    expect(rateLimit).toHaveBeenCalledWith(3_600_000);
  });

  it("defers the job when the provider reports quota exhaustion mid-send", async () => {
    const sender = { sendCampaignEmail: jest.fn().mockRejectedValue(new MailQuotaError("daily email sending quota")) };
    const { instance, rateLimit } = processor(sender, 0);

    await expect(instance.process(job)).rejects.toMatchObject({ name: "RateLimitError" });
    expect(rateLimit).toHaveBeenCalledTimes(1);
    expect(rateLimit.mock.calls[0][0]).toBeGreaterThan(0);
  });

  it("still fails the job for a permanent send error", async () => {
    const sender = { sendCampaignEmail: jest.fn().mockRejectedValue(new Error("domain is not verified")) };
    const { instance, rateLimit } = processor(sender, 0);

    await expect(instance.process(job)).rejects.toThrow(/domain is not verified/);
    expect(rateLimit).not.toHaveBeenCalled();
  });
});
