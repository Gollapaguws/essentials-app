import { HttpException, HttpStatus } from "@nestjs/common";
import { prisma } from "@essentials/db";
import { EntitlementsService, PaymentRequiredException } from "./entitlements.service";

jest.mock("@essentials/db", () => ({
  prisma: {
    subscription: { findUnique: jest.fn() },
    usageCounter: { findUnique: jest.fn() },
  },
}));

const db = prisma as unknown as {
  subscription: { findUnique: jest.Mock };
  usageCounter: { findUnique: jest.Mock };
};

const start = new Date("2026-11-10T00:00:00.000Z");

function subscription(entitlements: Record<string, number>) {
  return { currentPeriodStart: start, plan: { entitlements } };
}

beforeEach(() => {
  jest.clearAllMocks();
  db.usageCounter.findUnique.mockResolvedValue(null);
});

describe("EntitlementsService.allowance", () => {
  it("allows a metric the plan does not limit, without reading a counter", async () => {
    db.subscription.findUnique.mockResolvedValue(subscription({ "email.sends": 1000 }));

    await expect(new EntitlementsService().allowance("org-1", "social.publishes")).resolves.toBeNull();
    expect(db.usageCounter.findUnique).not.toHaveBeenCalled();
  });

  it("reports the limit, use and remaining for a metered metric", async () => {
    db.subscription.findUnique.mockResolvedValue(subscription({ "social.publishes": 60 }));
    db.usageCounter.findUnique.mockResolvedValue({ used: 5 });

    await expect(new EntitlementsService().allowance("org-1", "social.publishes")).resolves.toEqual({
      metric: "social.publishes",
      limit: 60,
      used: 5,
      remaining: 55,
    });
    expect(db.usageCounter.findUnique).toHaveBeenCalledWith({
      where: {
        orgId_metric_periodStart: {
          orgId: "org-1",
          metric: "social.publishes",
          periodStart: start,
        },
      },
      select: { used: true },
    });
  });

  it("does not meter a workspace with no plan", async () => {
    db.subscription.findUnique.mockResolvedValue(null);

    await expect(new EntitlementsService().allowance("org-1", "social.publishes")).resolves.toBeNull();
    expect(db.usageCounter.findUnique).not.toHaveBeenCalled();
  });
});

describe("EntitlementsService.check", () => {
  it("passes when the use is below the limit", async () => {
    db.subscription.findUnique.mockResolvedValue(subscription({ "social.publishes": 60 }));
    db.usageCounter.findUnique.mockResolvedValue({ used: 59 });

    await expect(
      new EntitlementsService().check("org-1", "social.publishes", 1),
    ).resolves.toMatchObject({ remaining: 1 });
  });

  it("refuses with a 402 that carries the allowance", async () => {
    db.subscription.findUnique.mockResolvedValue(subscription({ "social.publishes": 60 }));
    db.usageCounter.findUnique.mockResolvedValue({ used: 60 });

    const error = await new EntitlementsService()
      .check("org-1", "social.publishes")
      .catch((err: unknown) => err);

    expect(error).toBeInstanceOf(PaymentRequiredException);
    expect(error).toBeInstanceOf(HttpException);
    expect((error as HttpException).getStatus()).toBe(HttpStatus.PAYMENT_REQUIRED);
    expect((error as HttpException).getResponse()).toEqual({
      statusCode: 402,
      code: "payment_required",
      message: "The social.publishes allowance for this period does not cover this request.",
      metric: "social.publishes",
      limit: 60,
      used: 60,
      remaining: 0,
      requested: 1,
    });
  });

  it("refuses a request larger than the remaining allowance", async () => {
    db.subscription.findUnique.mockResolvedValue(subscription({ "email.sends": 1000 }));
    db.usageCounter.findUnique.mockResolvedValue({ used: 990 });

    await expect(new EntitlementsService().check("org-1", "email.sends", 20)).rejects.toBeInstanceOf(
      PaymentRequiredException,
    );
  });

  it("treats an unmetered feature as unlimited", async () => {
    db.subscription.findUnique.mockResolvedValue(subscription({}));

    await expect(new EntitlementsService().check("org-1", "door.scans", 500)).resolves.toBeNull();
  });
});
