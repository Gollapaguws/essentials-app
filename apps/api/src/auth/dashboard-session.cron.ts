import { Injectable, Logger } from "@nestjs/common";
import { Cron, CronExpression } from "@nestjs/schedule";
import { DashboardSessionService } from "./dashboard-session.service";

/**
 * Nightly sweep of dead sessions.
 *
 * A row is only removed when its cookie comes back or the account signs in
 * again, so sessions abandoned on a device that never returns would sit there
 * holding encrypted Supabase tokens for good. Nothing depends on the sweep
 * running — an expired session is still refused — it just stops the table
 * growing forever.
 */
@Injectable()
export class DashboardSessionCleanup {
  private readonly logger = new Logger(DashboardSessionCleanup.name);

  constructor(private readonly sessions: DashboardSessionService) {}

  @Cron(CronExpression.EVERY_DAY_AT_3AM)
  async prune(): Promise<void> {
    try {
      const removed = await this.sessions.pruneExpired();
      if (removed > 0) this.logger.log(`pruned ${removed} expired dashboard session(s)`);
    } catch (e) {
      // A failed sweep is not worth taking the API down over; it retries tonight.
      this.logger.error(`dashboard session prune failed: ${(e as Error).message}`);
    }
  }
}
