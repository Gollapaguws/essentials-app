import { Injectable } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { prisma } from "@essentials/db";

/** Sends allowed per UTC day before the queue idles. `EMAIL_DAILY_LIMIT=0` disables pacing. */
export const DEFAULT_DAILY_EMAIL_LIMIT = 200;

/** UTC midnight at the start of the day containing `now`. */
export function startOfUtcDay(now: Date): Date {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
}

/** UTC midnight after `now` — the provider quota window is a UTC day. */
export function nextUtcMidnight(now: Date): Date {
  const next = startOfUtcDay(now);
  next.setUTCDate(next.getUTCDate() + 1);
  return next;
}

export function msUntilNextUtcDay(now = new Date()): number {
  return Math.max(1000, nextUtcMidnight(now).getTime() - now.getTime());
}

/** Positive integer limit; 0 (or unparseable) means unlimited. */
export function parseDailyLimit(raw: string | undefined): number {
  if (raw === undefined || raw.trim() === "") return DEFAULT_DAILY_EMAIL_LIMIT;
  const parsed = Number.parseInt(raw, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 0;
}

/**
 * Paces the email queue against the provider's daily quota. The count is the
 * `delivered` campaign events recorded since UTC midnight, which is also what
 * the dashboard shows, so "used today" matches what staff see.
 */
@Injectable()
export class EmailQuotaService {
  constructor(private readonly config: ConfigService) {}

  limit(): number {
    return parseDailyLimit(this.config.get<string>("EMAIL_DAILY_LIMIT"));
  }

  async usedToday(now = new Date()): Promise<number> {
    return prisma.emailEvent.count({ where: { type: "delivered", createdAt: { gte: startOfUtcDay(now) } } });
  }

  /** 0 when a send may go out now, otherwise how long to wait for the window to reopen. */
  async waitMs(now = new Date()): Promise<number> {
    const limit = this.limit();
    if (!limit) return 0;
    return (await this.usedToday(now)) >= limit ? msUntilNextUtcDay(now) : 0;
  }
}
