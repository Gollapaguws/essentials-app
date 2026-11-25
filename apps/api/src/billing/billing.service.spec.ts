import { Logger } from "@nestjs/common";
import { prisma } from "@essentials/db";
import { BillingService, monthEnd, monthStart } from "./billing.service";

jest.mock("@essentials/db", () => ({
  prisma: {
    plan: { findMany: jest.fn() },
    organisation: { findUnique: jest.fn(), findMany: jest.fn() },
    subscription: { findUnique: jest.fn() },
    usageCounter: { findMany: jest.fn(), upsert: jest.fn() },
  },
}));

const db = prisma as unknown as {
  plan: { findMany: jest.Mock };
  organisation: { findUnique: jest.Mock; findMany: jest.Mock };
  subscription: { findUnique: jest.Mock };
  usageCounter: { findMany: jest.Mock; upsert: jest.Mock };
};

const start = new Date("2026-11-10T00:00:00.000Z");
const end = new Date("2026-12-10T00:00:00.000Z");

const plan = {
  id: "plan-edm-pro",
  key: "pro",
  name: "Complete professional package",
  priceZar: 39900,
  entitlements: { "email.sends": 1000, "social.publishes": 60 },
};

const organisation = {
  id: "org-1",
  name: "Night Shift",
  slug: "night-shift",
  kind: "promoter",
  hub: { slug: "edm" },
};

function subscription(overrides: Record<string, unknown> = {}) {
  return {
    status: "active",
    provider: "comp",
    currentPeriodStart: start,
    currentPeriodEnd: end,
    cancelAtPeriodEnd: false,
    plan,
    ...overrides,
  };
}

beforeEach(() => {
  jest.clearAllMocks();
  db.usageCounter.findMany.mockResolvedValue([]);
  db.usageCounter.upsert.mockResolvedValue({});
  db.organisation.findUnique.mockResolvedValue(organisation);
});

describe("BillingService.summaryFor", () => {
  it("reads the period from the subscription and limits from the plan", async () => {
    db.subscription.findUnique.mockResolvedValue(subscription());
    db.usageCounter.findMany.mockResolvedValue([{ metric: "social.publishes", used: 5 }]);

    const summary = await new BillingService().summaryFor("org-1");

    expect(db.usageCounter.findMany).toHaveBeenCalledWith({
      where: { orgId: "org-1", periodStart: start },
      orderBy: { metric: "asc" },
    });
    expect(summary.period).toEqual({ start: start.toISOString(), end: end.toISOString() });
    expect(summary.plan?.key).toBe("pro");
    expect(summary.usage).toEqual([
      { metric: "social.publishes", used: 5, limit: 60, remaining: 55 },
    ]);
  });

  it("reports a counter the plan does not limit without inventing a limit", async () => {
    db.subscription.findUnique.mockResolvedValue(subscription());
    db.usageCounter.findMany.mockResolvedValue([{ metric: "door.scans", used: 12 }]);

    const summary = await new BillingService().summaryFor("org-1");

    expect(summary.usage).toEqual([{ metric: "door.scans", used: 12, limit: null, remaining: null }]);
  });

  it("falls back to the calendar month and no plan when there is no subscription", async () => {
    db.subscription.findUnique.mockResolvedValue(null);

    const summary = await new BillingService().summaryFor("org-1");

    expect(summary.plan).toBeNull();
    expect(summary.subscription).toBeNull();
    expect(summary.period.start).toBe(monthStart().toISOString());
    expect(summary.period.end).toBe(monthEnd().toISOString());
    expect(summary.usage).toEqual([]);
  });
});

describe("BillingService.overview", () => {
  it("counts only counters from each workspace's own period", async () => {
    db.organisation.findMany.mockResolvedValue([
      {
        ...organisation,
        subscription: subscription(),
        usageCounters: [
          { metric: "social.publishes", periodStart: start, used: 5 },
          { metric: "social.publishes", periodStart: new Date("2026-10-10T00:00:00.000Z"), used: 9 },
        ],
        _count: { members: 2 },
      },
      {
        ...organisation,
        id: "org-2",
        name: "Platform",
        slug: "sonus",
        kind: "platform",
        subscription: null,
        usageCounters: [],
        _count: { members: 4 },
      },
    ]);

    const overview = await new BillingService().overview();

    expect(overview.workspaces).toHaveLength(2);
    expect(overview.workspaces[0].usage).toEqual([
      { metric: "social.publishes", used: 5, limit: 60, remaining: 55 },
    ]);
    expect(overview.workspaces[0].members).toBe(2);
    expect(overview.workspaces[1].plan).toBeNull();
    expect(overview.workspaces[1].members).toBe(4);
  });
});

describe("BillingService.record", () => {
  it("increments the counter on the subscription's period", async () => {
    db.subscription.findUnique.mockResolvedValue({ currentPeriodStart: start });

    await new BillingService().record("org-1", "social.publishes");

    expect(db.usageCounter.upsert).toHaveBeenCalledWith({
      where: {
        orgId_metric_periodStart: { orgId: "org-1", metric: "social.publishes", periodStart: start },
      },
      update: { used: { increment: 1 } },
      create: { orgId: "org-1", metric: "social.publishes", periodStart: start, used: 1 },
    });
  });

  it("does nothing for an account with no workspace", async () => {
    await new BillingService().record(null, "social.publishes");

    expect(db.usageCounter.upsert).not.toHaveBeenCalled();
  });

  it("never breaks the feature it is counting", async () => {
    const warn = jest.spyOn(Logger.prototype, "warn").mockImplementation(() => undefined);
    db.subscription.findUnique.mockResolvedValue({ currentPeriodStart: start });
    db.usageCounter.upsert.mockRejectedValue(new Error("database is down"));

    await expect(new BillingService().record("org-1", "social.publishes")).resolves.toBeUndefined();
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });
});
