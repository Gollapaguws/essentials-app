import { NotFoundException } from "@nestjs/common";
import { prisma } from "@essentials/db";
import { EmailEngineService } from "./email-engine.service";
import type { JwtUser } from "../common/roles.guard";

jest.mock("@essentials/db", () => ({
  ConsentStatus: { granted: "granted", revoked: "revoked" },
  EventStatus: {},
  prisma: {
    emailSegment: { findUnique: jest.fn() },
    user: { findMany: jest.fn() },
    campaign: { create: jest.fn() },
    consent: { findUnique: jest.fn() },
    emailJob: { create: jest.fn() },
  },
}));

const db = prisma as unknown as {
  emailSegment: { findUnique: jest.Mock };
  user: { findMany: jest.Mock };
  campaign: { create: jest.Mock };
  consent: { findUnique: jest.Mock };
  emailJob: { create: jest.Mock };
};

const promoter: JwtUser = { sub: "promoter-1", email: "promoter@example.com", role: "promoter" };
const service = () => new EmailEngineService();

beforeEach(() => {
  jest.clearAllMocks();
  db.campaign.create.mockResolvedValue({ id: "campaign-1" });
  db.emailJob.create.mockResolvedValue({ id: "job-1" });
  db.consent.findUnique.mockResolvedValue({ status: "granted" });
});

describe("EmailEngineService mailing-list recipients", () => {
  it("targets every listed address, not only guest accounts", async () => {
    db.emailSegment.findUnique.mockResolvedValue({
      id: "segment-1",
      filter: { emails: ["curator@essentialsedm.com", "gollapagus@gmail.com"] },
    });
    db.user.findMany.mockResolvedValue([
      { id: "user-1", email: "curator@essentialsedm.com", name: "Curator" },
      { id: "user-2", email: "gollapagus@gmail.com", name: "Golla" },
    ]);

    const recipients = await service().resolveRecipients("segment-1");

    expect(db.user.findMany).toHaveBeenCalledWith({
      where: { email: { in: ["curator@essentialsedm.com", "gollapagus@gmail.com"] } },
      select: { id: true, email: true, name: true },
    });
    expect(recipients).toHaveLength(2);
  });

  it("still limits dynamic segments to guests", async () => {
    db.emailSegment.findUnique.mockResolvedValue({ id: "segment-2", filter: { vibeTag: "house" } });
    db.user.findMany.mockResolvedValue([]);

    await service().resolveRecipients("segment-2");

    expect(db.user.findMany).toHaveBeenCalledWith({
      where: { role: "guest", vibeTag: "house" },
      select: { id: true, email: true, name: true },
    });
  });

  it("queues an artist listed on a mailing list when they have granted consent", async () => {
    db.emailSegment.findUnique.mockResolvedValue({
      id: "segment-1",
      filter: { emails: ["gollapagus@gmail.com"] },
    });
    db.user.findMany.mockResolvedValue([{ id: "user-2", email: "gollapagus@gmail.com", name: "Golla" }]);
    const sender = { sendCampaignEmail: jest.fn().mockResolvedValue(undefined) };

    const result = await new EmailEngineService(undefined, sender as never).enqueueCampaign(promoter, {
      name: "Test",
      flow: "one_off",
      subject: "Hello",
      segmentId: "segment-1",
    });

    expect(db.emailJob.create).toHaveBeenCalledWith({ data: { campaignId: "campaign-1", userId: "user-2" } });
    expect(sender.sendCampaignEmail).toHaveBeenCalledWith("campaign-1", "user-2");
    expect(result).toEqual({ campaignId: "campaign-1", queued: 1 });
  });

  it("skips a listed address that revoked consent", async () => {
    db.emailSegment.findUnique.mockResolvedValue({
      id: "segment-1",
      filter: { emails: ["gone@example.com"] },
    });
    db.user.findMany.mockResolvedValue([{ id: "user-3", email: "gone@example.com", name: null }]);
    db.consent.findUnique.mockResolvedValue({ status: "revoked" });

    const result = await service().enqueueCampaign(promoter, {
      name: "Test",
      flow: "one_off",
      subject: "Hello",
      segmentId: "segment-1",
    });

    expect(db.emailJob.create).not.toHaveBeenCalled();
    expect(result).toEqual({ campaignId: "campaign-1", queued: 0 });
  });

  it("rejects an unknown segment", async () => {
    db.emailSegment.findUnique.mockResolvedValue(null);

    await expect(service().resolveRecipients("missing")).rejects.toBeInstanceOf(NotFoundException);
  });
});
