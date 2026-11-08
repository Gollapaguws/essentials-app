import { DashboardSessionCleanup } from "./dashboard-session.cron";
import type { DashboardSessionService } from "./dashboard-session.service";

const build = (pruneExpired: jest.Mock) =>
  new DashboardSessionCleanup({ pruneExpired } as unknown as DashboardSessionService);

describe("DashboardSessionCleanup", () => {
  it("asks the session service to prune, which is where the cutoff lives", async () => {
    const pruneExpired = jest.fn().mockResolvedValue(4);

    await build(pruneExpired).prune();

    expect(pruneExpired).toHaveBeenCalledTimes(1);
  });

  it("stays quiet when there is nothing to remove", async () => {
    const pruneExpired = jest.fn().mockResolvedValue(0);

    await expect(build(pruneExpired).prune()).resolves.toBeUndefined();
  });

  it("survives a failed sweep instead of taking the scheduler down", async () => {
    const pruneExpired = jest.fn().mockRejectedValue(new Error("database is down"));
    const error = jest.spyOn(console, "error").mockImplementation(() => {});

    await expect(build(pruneExpired).prune()).resolves.toBeUndefined();
    error.mockRestore();
  });
});
