import {
  DEFAULT_DAILY_EMAIL_LIMIT,
  msUntilNextUtcDay,
  nextUtcMidnight,
  parseDailyLimit,
  startOfUtcDay,
} from "./email-quota.service";

describe("email quota window", () => {
  it("defaults to the configured daily allowance when unset", () => {
    expect(parseDailyLimit(undefined)).toBe(DEFAULT_DAILY_EMAIL_LIMIT);
    expect(parseDailyLimit("")).toBe(DEFAULT_DAILY_EMAIL_LIMIT);
    expect(parseDailyLimit("250")).toBe(250);
  });

  it("treats zero or nonsense as unlimited", () => {
    expect(parseDailyLimit("0")).toBe(0);
    expect(parseDailyLimit("-5")).toBe(0);
    expect(parseDailyLimit("lots")).toBe(0);
  });

  it("uses UTC days", () => {
    const now = new Date("2026-11-19T23:30:00Z");
    expect(startOfUtcDay(now).toISOString()).toBe("2026-11-19T00:00:00.000Z");
    expect(nextUtcMidnight(now).toISOString()).toBe("2026-11-20T00:00:00.000Z");
  });

  it("waits until midnight, never a negative or zero delay", () => {
    expect(msUntilNextUtcDay(new Date("2026-11-19T23:00:00Z"))).toBe(3_600_000);
    expect(msUntilNextUtcDay(new Date("2026-11-19T00:00:00Z"))).toBe(86_400_000);
    expect(msUntilNextUtcDay(new Date("2026-11-19T23:59:59.999Z"))).toBe(1000);
  });
});
