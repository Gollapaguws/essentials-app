import { Global, Module, type Provider } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import Redis from "ioredis";

export const REDIS = Symbol("REDIS");

/** The subset of ioredis the throttler and rate guard use (easy to fake in tests). */
export interface RedisCommands {
  incr(key: string): Promise<number>;
  expire(key: string, seconds: number): Promise<number>;
  ttl(key: string): Promise<number>;
  pexpire(key: string, ms: number): Promise<number>;
  pttl(key: string): Promise<number>;
  set(key: string, value: string, mode: "PX", ms: number, nx: "NX"): Promise<unknown>;
}

export const redisProvider: Provider = {
  provide: REDIS,
  inject: [ConfigService],
  useFactory: (config: ConfigService): RedisCommands => {
    const url = config.get<string>("REDIS_URL") ?? "redis://localhost:6379";
    const client = new Redis(url, { maxRetriesPerRequest: null });
    client.on("error", (e: Error) => console.warn(`redis: ${e.message}`));
    return client as unknown as RedisCommands;
  },
};

/** Global so both the throttler factory and feature modules can inject REDIS. */
@Global()
@Module({ providers: [redisProvider], exports: [REDIS] })
export class RedisModule {}
