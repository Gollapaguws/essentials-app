import { BadRequestException, Injectable, Logger } from "@nestjs/common";
import { Cron, CronExpression } from "@nestjs/schedule";
import { prisma } from "@essentials/db";

/** The page only ever shows a screenful. */
const KEEP = 60;
const NAME_MAX = 24;
const BODY_MAX = 280;

/** Midnight in South African time (UTC+2, no daylight saving). */
function startOfTodaySast(now = new Date()): Date {
  const sast = new Date(now.getTime() + 2 * 60 * 60 * 1000);
  return new Date(
    Date.UTC(sast.getUTCFullYear(), sast.getUTCMonth(), sast.getUTCDate()) - 2 * 60 * 60 * 1000,
  );
}

@Injectable()
export class LiveChatService {
  private readonly logger = new Logger(LiveChatService.name);

  /**
   * Newest messages, oldest first so the log reads top to bottom. Anything
   * from before today is hidden as well as deleted, so a missed midnight sweep
   * (an API restart) can never leak yesterday's chat back onto the page.
   */
  async recent() {
    const rows = await prisma.liveChatMessage.findMany({
      where: { createdAt: { gte: startOfTodaySast() } },
      orderBy: { createdAt: "desc" },
      take: KEEP,
    });
    return rows.reverse();
  }

  /** The room is a tonight-only conversation: clear it at midnight, SA time. */
  @Cron(CronExpression.EVERY_DAY_AT_MIDNIGHT, { timeZone: "Africa/Johannesburg" })
  async clearDaily() {
    try {
      const { count } = await prisma.liveChatMessage.deleteMany();
      if (count > 0) this.logger.log(`cleared ${count} live chat message(s)`);
    } catch (e) {
      // A missed sweep must not take the API down; today's filter still hides the old rows.
      this.logger.error(`live chat clear failed: ${(e as Error).message}`);
    }
  }

  async post(name: string, body: string) {
    // Validation runs on the raw values, so a name of spaces still gets caught here.
    const cleanName = name.trim().replace(/\s+/g, " ").slice(0, NAME_MAX);
    const cleanBody = body.trim().slice(0, BODY_MAX);
    if (cleanName.length < 2) throw new BadRequestException("Pick a name of at least 2 characters");
    if (!cleanBody) throw new BadRequestException("Type a message first");

    return prisma.liveChatMessage.create({ data: { name: cleanName, body: cleanBody } });
  }
}
