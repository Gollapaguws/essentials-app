import { HttpException, HttpStatus } from "@nestjs/common";
import { AuthRateGuard } from "./auth-rate.guard";

function mockRedis() {
  const counts = new Map<string, number>();
  return {
    incr: jest.fn(async (key: string) => {
      const next = (counts.get(key) ?? 0) + 1;
      counts.set(key, next);
      return next;
    }),
    expire: jest.fn(async () => 1),
    ttl: jest.fn(async () => 3600),
  };
}

const ctx = (req: any) =>
  ({ switchToHttp: () => ({ getRequest: () => req }), getHandler: () => ({}), getClass: () => ({}) }) as any;

const req = (over: any = {}) => ({ ip: "1.2.3.4", user: { email: "a@b.co" }, ...over });

describe("AuthRateGuard", () => {
  it("allows five attempts per ip+email per hour", async () => {
    const redis = mockRedis();
    const guard = new AuthRateGuard(redis as any);
    for (let i = 0; i < 5; i++) {
      await expect(guard.canActivate(ctx(req()))).resolves.toBe(true);
    }
  });

  it("rejects the sixth attempt with 429", async () => {
    const redis = mockRedis();
    const guard = new AuthRateGuard(redis as any);
    for (let i = 0; i < 5; i++) await guard.canActivate(ctx(req()));
    const err = await guard.canActivate(ctx(req())).catch((e) => e);
    expect(err).toBeInstanceOf(HttpException);
    expect(err.getStatus()).toBe(HttpStatus.TOO_MANY_REQUESTS);
    expect(err.getResponse()).toMatchObject({ code: "RATE_LIMITED" });
  });

  it("keys counters by email and ip independently", async () => {
    const redis = mockRedis();
    const guard = new AuthRateGuard(redis as any);
    for (let i = 0; i < 5; i++) await guard.canActivate(ctx(req()));
    await expect(guard.canActivate(ctx(req({ user: { email: "other@b.co" } })))).resolves.toBe(true);
    await expect(guard.canActivate(ctx(req({ ip: "5.6.7.8" })))).resolves.toBe(true);
  });

  it("normalizes the email to lower case", async () => {
    const redis = mockRedis();
    const guard = new AuthRateGuard(redis as any);
    await guard.canActivate(ctx(req({ user: { email: "A@B.co" } })));
    await guard.canActivate(ctx(req()));
    expect(redis.incr).toHaveBeenNthCalledWith(1, "auth:redeem:1.2.3.4:a@b.co");
    expect(redis.incr).toHaveBeenNthCalledWith(2, "auth:redeem:1.2.3.4:a@b.co");
  });
});
