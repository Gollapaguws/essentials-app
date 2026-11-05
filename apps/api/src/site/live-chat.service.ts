import { BadRequestException, Injectable } from "@nestjs/common";
import { prisma } from "@essentials/db";

/** The page only ever shows a screenful; older rows stay in the table. */
const KEEP = 60;
const NAME_MAX = 24;
const BODY_MAX = 280;

@Injectable()
export class LiveChatService {
  /** Newest messages, oldest first so the log reads top to bottom. */
  async recent() {
    const rows = await prisma.liveChatMessage.findMany({
      orderBy: { createdAt: "desc" },
      take: KEEP,
    });
    return rows.reverse();
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
