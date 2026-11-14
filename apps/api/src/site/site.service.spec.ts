import { BadRequestException } from "@nestjs/common";
import { prisma, ConsentStatus } from "@essentials/db";
import { SiteService } from "./site.service";

jest.mock("@essentials/db", () => ({
  prisma: {
    consent: { findUnique: jest.fn(), upsert: jest.fn() },
    user: { findUnique: jest.fn() },
    emailEvent: { create: jest.fn() },
  },
  ConsentStatus: { granted: "granted", revoked: "revoked" },
}));

const db = prisma as unknown as {
  consent: { findUnique: jest.Mock; upsert: jest.Mock };
  user: { findUnique: jest.Mock };
  emailEvent: { create: jest.Mock };
};

const service = () =>
  new SiteService({ send: jest.fn().mockResolvedValue({ id: "mail-1" }) } as never);

beforeEach(() => {
  db.consent.findUnique.mockReset().mockResolvedValue(null);
  db.consent.upsert.mockReset().mockResolvedValue({});
  db.user.findUnique.mockReset().mockResolvedValue({ id: "user-1" });
  db.emailEvent.create.mockReset().mockResolvedValue({});
});

describe("SiteService.subscribe", () => {
  it("refuses a newsletter signup without affirmative consent", async () => {
    await expect(service().subscribe("guest@example.com", false)).rejects.toBeInstanceOf(
      BadRequestException,
    );
    expect(db.consent.upsert).not.toHaveBeenCalled();
  });

  it("records the policy version and source when consent is granted", async () => {
    await service().subscribe("  Guest@Example.COM ", true);

    expect(db.consent.upsert).toHaveBeenCalledWith({
      where: { email_channel: { email: "guest@example.com", channel: "email" } },
      update: {
        status: "granted",
        source: "site_footer",
        policyVersion: "2026-11-14",
        revokedAt: null,
      },
      create: {
        email: "guest@example.com",
        userId: "user-1",
        status: "granted",
        source: "site_footer",
        policyVersion: "2026-11-14",
      },
    });
  });

  it("does not rewrite an existing granted consent", async () => {
    db.consent.findUnique.mockResolvedValue({ status: ConsentStatus.granted });

    await expect(service().subscribe("guest@example.com", true)).resolves.toEqual({
      ok: true,
      already: true,
    });
    expect(db.consent.upsert).not.toHaveBeenCalled();
  });
});
