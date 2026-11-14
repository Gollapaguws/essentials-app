import { prisma, ConsentStatus } from "@essentials/db";
import { WhatsNewMailerService } from "./whats-new-mailer.service";

jest.mock("@essentials/db", () => ({
  prisma: {
    whatsNewBroadcast: { findUnique: jest.fn(), create: jest.fn() },
    user: { findMany: jest.fn() },
  },
  ConsentStatus: { granted: "granted", revoked: "revoked" },
}));

const db = prisma as unknown as {
  whatsNewBroadcast: { findUnique: jest.Mock; create: jest.Mock };
  user: { findMany: jest.Mock };
};

const release = {
  date: "2026-11-20",
  sections: [{ title: "Front page", items: [{ title: "Lineup.", text: "It builds itself." }] }],
};

const build = (latest: unknown = release) => {
  const mail = { send: jest.fn().mockResolvedValue({ id: "1" }) };
  const config = { get: (key: string) => (key === "SITE_URL" ? "https://essentialsedm.com/" : undefined) };
  const changelog = { latest: jest.fn().mockResolvedValue(latest) };
  const service = new WhatsNewMailerService(changelog as never, mail as never, config as never);
  return { service, mail, changelog };
};

beforeEach(() => {
  db.whatsNewBroadcast.findUnique.mockReset().mockResolvedValue(null);
  db.whatsNewBroadcast.create.mockReset().mockResolvedValue({});
  db.user.findMany.mockReset().mockResolvedValue([{ email: "dj@example.test" }, { email: "promoter@example.test" }]);
});

describe("WhatsNewMailerService", () => {
  it("mails members and records the release once", async () => {
    const { service, mail } = build();

    await service.announce();

    expect(db.user.findMany.mock.calls[0][0].where.role).toEqual({ not: "guest" });
    expect(db.user.findMany.mock.calls[0][0].where.consentRecords).toEqual({
      none: { channel: "email", status: ConsentStatus.revoked },
    });
    expect(mail.send).toHaveBeenCalledTimes(2);
    expect(mail.send.mock.calls[0][0]).toMatchObject({
      to: "dj@example.test",
      unsubscribeUrl: expect.stringContaining("https://essentialsedm.com/api/email/unsubscribe?token="),
    });
    expect(db.whatsNewBroadcast.create).toHaveBeenCalledWith({
      data: { release: "2026-11-20", sentCount: 2 },
    });
  });

  it("stays silent for a release it has already announced", async () => {
    db.whatsNewBroadcast.findUnique.mockResolvedValue({ release: "2026-11-20", sentCount: 2 });
    const { service, mail } = build();

    await service.announce();

    expect(mail.send).not.toHaveBeenCalled();
    expect(db.whatsNewBroadcast.create).not.toHaveBeenCalled();
  });

  it("does nothing when there are no notes", async () => {
    const { service, mail } = build(null);

    await service.announce();

    expect(mail.send).not.toHaveBeenCalled();
    expect(db.whatsNewBroadcast.create).not.toHaveBeenCalled();
  });

  it("carries on when one address fails, and records what landed", async () => {
    const { service, mail } = build();
    mail.send.mockRejectedValueOnce(new Error("mailbox full"));

    await service.announce();

    expect(mail.send).toHaveBeenCalledTimes(2);
    expect(db.whatsNewBroadcast.create).toHaveBeenCalledWith({
      data: { release: "2026-11-20", sentCount: 1 },
    });
  });

  it("records a release with no reachable members so it is not retried forever", async () => {
    db.user.findMany.mockResolvedValue([]);
    const { service } = build();

    await service.announce();

    expect(db.whatsNewBroadcast.create).toHaveBeenCalledWith({
      data: { release: "2026-11-20", sentCount: 0 },
    });
  });
});
