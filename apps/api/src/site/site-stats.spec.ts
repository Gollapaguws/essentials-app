import { prisma } from "@essentials/db";
import { SiteStatsService } from "./site-stats.service";

jest.mock("@essentials/db", () => ({
  prisma: {
    siteVisit: { upsert: jest.fn(), groupBy: jest.fn() },
    siteEvent: { create: jest.fn(), groupBy: jest.fn() },
  },
}));

const db = prisma as unknown as {
  siteVisit: { upsert: jest.Mock; groupBy: jest.Mock };
  siteEvent: { create: jest.Mock; groupBy: jest.Mock };
};

beforeEach(() => {
  db.siteVisit.upsert.mockReset().mockResolvedValue({});
  db.siteVisit.groupBy.mockReset().mockResolvedValue([]);
  db.siteEvent.create.mockReset().mockResolvedValue({});
  db.siteEvent.groupBy.mockReset().mockResolvedValue([]);
});

describe("SiteStatsService.recordEvent", () => {
  it("stores a daily hash rather than the raw IP", async () => {
    await new SiteStatsService().recordEvent("app_install", "203.0.113.9");

    const data = db.siteEvent.create.mock.calls[0][0].data;
    expect(data.name).toBe("app_install");
    expect(data.visitorKey).not.toContain("203.0.113.9");
    expect(data.day).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it("does not fail the request when the same event was already counted", async () => {
    db.siteEvent.create.mockRejectedValue(new Error("unique constraint"));

    await expect(
      new SiteStatsService().recordEvent("install_banner_dismiss", "127.0.0.1"),
    ).resolves.toEqual({ ok: true });
  });
});

describe("SiteStatsService.stats", () => {
  it("returns page views and zero-filled install events", async () => {
    db.siteVisit.groupBy.mockResolvedValue([
      { day: "2026-11-16", _sum: { views: 12 }, _count: { visitorKey: 7 } },
    ]);
    db.siteEvent.groupBy.mockResolvedValue([
      { name: "app_install", _count: { _all: 3 } },
    ]);

    await expect(new SiteStatsService().stats()).resolves.toMatchObject({
      days: [{ day: "2026-11-16", views: 12, uniqueVisitors: 7 }],
      events: {
        install_banner_dismiss: 0,
        install_prompt_open: 0,
        app_install: 3,
      },
    });
  });
});
