import type { ThrottlerStorage } from "@nestjs/throttler";
import type { ThrottlerStorageRecord } from "@nestjs/throttler/dist/throttler-storage-record.interface";
import type { RedisCommands } from "./redis.provider";

/**
 * Shared rate-limit counters so limits survive restarts and work across instances.
 * INCR + PEXPIRE NX keeps the window fixed per key; blocking uses a sibling key.
 */
export class RedisThrottlerStorage implements ThrottlerStorage {
  constructor(private readonly redis: RedisCommands) {}

  async increment(
    key: string,
    ttl: number,
    limit: number,
    blockDuration: number,
    _throttlerName: string,
  ): Promise<ThrottlerStorageRecord> {
    const totalHits = await this.redis.incr(key);
    if (totalHits === 1) await this.redis.pexpire(key, ttl);

    let timeToExpire = await this.redis.pttl(key);
    if (timeToExpire < 0) {
      await this.redis.pexpire(key, ttl);
      timeToExpire = ttl;
    }

    let isBlocked = false;
    let timeToBlockExpire = 0;
    if (totalHits > limit && blockDuration > 0) {
      const blockKey = `${key}:block`;
      await this.redis.set(blockKey, "1", "PX", blockDuration, "NX");
      const blockTtl = await this.redis.pttl(blockKey);
      if (blockTtl > 0) {
        isBlocked = true;
        timeToBlockExpire = blockTtl;
      }
    }

    return { totalHits, timeToExpire, isBlocked, timeToBlockExpire };
  }
}
