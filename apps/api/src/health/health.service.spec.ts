jest.mock("@essentials/db", () => ({ prisma: { $queryRaw: jest.fn() } }));

import { prisma } from "@essentials/db";
import { HealthService } from "./health.service";

const redis = { ping: jest.fn() };

const service = () => new HealthService(redis as never);

describe("HealthService", () => {
  afterEach(() => jest.clearAllMocks());

  it("reports ready only when both dependencies answer", async () => {
    (prisma.$queryRaw as jest.Mock).mockResolvedValue([{ "?column?": 1 }]);
    redis.ping.mockResolvedValue("PONG");

    const report = await service().check();
    expect(report.ok).toBe(true);
    expect(report.checks.db.ok).toBe(true);
    expect(report.checks.redis.ok).toBe(true);
  });

  it("reports not ready — and names the failure — when Redis is down", async () => {
    (prisma.$queryRaw as jest.Mock).mockResolvedValue([{ "?column?": 1 }]);
    redis.ping.mockRejectedValue(new Error("Connection is closed."));

    const report = await service().check();
    expect(report.ok).toBe(false);
    expect(report.checks.db.ok).toBe(true);
    expect(report.checks.redis).toMatchObject({ ok: false, error: "Connection is closed." });
  });

  it("times out a hung database instead of hanging the probe", async () => {
    jest.useFakeTimers();
    (prisma.$queryRaw as jest.Mock).mockReturnValue(new Promise(() => undefined));
    redis.ping.mockResolvedValue("PONG");

    const pending = service().check();
    await jest.advanceTimersByTimeAsync(2_100);
    const report = await pending;

    expect(report.ok).toBe(false);
    expect(report.checks.db.ok).toBe(false);
    expect(report.checks.db.error).toMatch(/timed out/);
    jest.useRealTimers();
  });
});
