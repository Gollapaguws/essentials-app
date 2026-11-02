import { RedisThrottlerStorage } from "./redis-throttler.storage";

function mockRedis() {
  let hits = 0;
  const store = new Map<string, number>();
  return {
    incr: jest.fn(async (key: string) => {
      const next = (store.get(key) ?? 0) + 1;
      store.set(key, next);
      hits = next;
      return next;
    }),
    pexpire: jest.fn(async (key: string, ms: number) => {
      store.set(`${key}:ttl`, ms);
      return 1;
    }),
    pttl: jest.fn(async (key: string) => store.get(key) ?? store.get(`${key}:ttl`) ?? -1),
    set: jest.fn(async (key: string, _v: string, _mode: string, ms: number) => {
      store.set(key, ms);
      return "OK";
    }),
    __hits: () => hits,
    __store: store,
  };
}

describe("RedisThrottlerStorage", () => {
  it("increments and returns a positive expiry", async () => {
    const redis = mockRedis();
    const storage = new RedisThrottlerStorage(redis as any);
    const rec = await storage.increment("k", 60_000, 5, 0, "default");
    expect(rec.totalHits).toBe(1);
    expect(rec.timeToExpire).toBeGreaterThan(0);
    expect(rec.isBlocked).toBe(false);
    expect(redis.pexpire).toHaveBeenCalledTimes(1);
  });

  it("sets the TTL only on the first hit", async () => {
    const redis = mockRedis();
    const storage = new RedisThrottlerStorage(redis as any);
    await storage.increment("k", 60_000, 5, 0, "default");
    await storage.increment("k", 60_000, 5, 0, "default");
    expect(redis.pexpire).toHaveBeenCalledTimes(1);
    expect((await storage.increment("k", 60_000, 5, 0, "default")).totalHits).toBe(3);
  });

  it("blocks after the limit and reports the block window", async () => {
    const redis = mockRedis();
    const storage = new RedisThrottlerStorage(redis as any);
    for (let i = 0; i < 5; i++) await storage.increment("k", 60_000, 5, 30_000, "default");
    const over = await storage.increment("k", 60_000, 5, 30_000, "default");
    expect(over.totalHits).toBe(6);
    expect(redis.set).toHaveBeenCalledWith("k:block", "1", "PX", 30_000, "NX");
    expect(over.isBlocked).toBe(true);
    expect(over.timeToBlockExpire).toBe(30_000);
  });

  it("counts independently per key", async () => {
    const redis = mockRedis();
    const storage = new RedisThrottlerStorage(redis as any);
    await storage.increment("a", 60_000, 5, 0, "default");
    expect((await storage.increment("b", 60_000, 5, 0, "default")).totalHits).toBe(1);
  });
});
