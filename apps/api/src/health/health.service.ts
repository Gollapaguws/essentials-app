import { Inject, Injectable } from "@nestjs/common";
import { prisma } from "@essentials/db";
import { REDIS, type RedisCommands } from "../common/redis.provider";

/** A hung dependency must not hang the health check; 2s is well inside a probe's timeout. */
const CHECK_TIMEOUT_MS = 2_000;

export interface HealthCheck {
  ok: boolean;
  ms: number;
  error?: string;
}

export interface HealthReport {
  ok: boolean;
  checks: { db: HealthCheck; redis: HealthCheck };
}

async function timed(run: () => Promise<unknown>): Promise<HealthCheck> {
  const started = Date.now();
  let timer: NodeJS.Timeout | undefined;
  try {
    await Promise.race([
      run(),
      new Promise<never>((_, reject) => {
        timer = setTimeout(
          () => reject(new Error(`timed out after ${CHECK_TIMEOUT_MS}ms`)),
          CHECK_TIMEOUT_MS,
        );
        // Never keep the process alive just for a probe.
        timer.unref?.();
      }),
    ]);
    return { ok: true, ms: Date.now() - started };
  } catch (error) {
    return {
      ok: false,
      ms: Date.now() - started,
      error: error instanceof Error ? error.message : String(error),
    };
  } finally {
    if (timer) clearTimeout(timer);
  }
}

/**
 * Readiness, not liveness: `{ ok: true }` while Postgres is down is worse than no
 * health check at all, because it tells the monitor (and whoever is on call) that
 * everything is fine. Both dependency probes run in parallel and time out.
 */
@Injectable()
export class HealthService {
  constructor(@Inject(REDIS) private readonly redis: RedisCommands) {}

  async check(): Promise<HealthReport> {
    const [db, redis] = await Promise.all([
      timed(() => prisma.$queryRaw`select 1`),
      timed(() => this.redis.ping()),
    ]);
    return { ok: db.ok && redis.ok, checks: { db, redis } };
  }
}
