import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from "@nestjs/common";
import { prisma } from "@essentials/db";
import type { JwtUser } from "../common/roles.guard";

/** One message is a line in a busy room, not an announcement. */
export const MAX_MESSAGE_LENGTH = 500;

/**
 * The night's group chat: guests on the list talk to each other before and
 * during the event. `EventGroupChat` was created with every event and had no
 * surface until now.
 */
@Injectable()
export class GroupChatService {
  /** The chat row for an event, created on demand for nights that predate chats. */
  private async chatFor(eventId: string) {
    const chat = await prisma.eventGroupChat.findUnique({ where: { eventId }, select: { id: true } });
    if (chat) return chat.id;
    const created = await prisma.eventGroupChat.create({ data: { eventId }, select: { id: true } });
    return created.id;
  }

  /**
   * Who may read the room: the night's promoter and venue manager, admins, and
   * guests actually on the list. Everyone else gets a 403 instead of an empty
   * chat they were never part of.
   */
  private async assertMember(user: JwtUser, eventId: string) {
    const event = await prisma.event.findUnique({
      where: { id: eventId },
      select: { promoterId: true, venue: { select: { managerId: true } } },
    });
    if (!event) throw new NotFoundException("Event not found");
    if (user.role === "admin") return;
    if (user.role === "promoter" && event.promoterId === user.sub) return;
    if (user.role === "venue_manager" && event.venue.managerId === user.sub) return;

    const entry = await prisma.guestList.findFirst({
      where: { eventId, userId: user.sub, status: { in: ["attending", "checked_in"] } },
      select: { id: true },
    });
    if (!entry) throw new ForbiddenException("Only guests on this list can open the night chat");
  }

  /** The last 200 messages, oldest first, with the caller's own flagged. */
  async messages(user: JwtUser, eventId: string) {
    await this.assertMember(user, eventId);
    const chatId = await this.chatFor(eventId);
    const rows = await prisma.groupMessage.findMany({
      where: { chatId },
      orderBy: { createdAt: "desc" },
      take: 200,
      include: { user: { select: { id: true, name: true, avatar: true } } },
    });

    return {
      chatId,
      messages: rows.reverse().map((m) => ({
        id: m.id,
        body: m.body,
        createdAt: m.createdAt,
        isIcebreaker: m.isIcebreaker,
        mine: m.userId === user.sub,
        author: { id: m.user.id, name: m.user.name ?? "Guest", avatar: m.user.avatar },
      })),
    };
  }

  /** Post a message. Only staff can label one an icebreaker. */
  async post(user: JwtUser, eventId: string, body: string, icebreaker = false) {
    await this.assertMember(user, eventId);
    const text = body.trim();
    if (!text) throw new BadRequestException("Say something first");
    if (text.length > MAX_MESSAGE_LENGTH) {
      throw new BadRequestException(`Messages are limited to ${MAX_MESSAGE_LENGTH} characters`);
    }

    const canBreakIce = user.role === "promoter" || user.role === "venue_manager" || user.role === "admin";
    const chatId = await this.chatFor(eventId);
    const created = await prisma.groupMessage.create({
      data: { chatId, userId: user.sub, body: text, isIcebreaker: icebreaker && canBreakIce },
      include: { user: { select: { id: true, name: true, avatar: true } } },
    });

    return {
      id: created.id,
      body: created.body,
      createdAt: created.createdAt,
      isIcebreaker: created.isIcebreaker,
      mine: true,
      author: { id: created.user.id, name: created.user.name ?? "Guest", avatar: created.user.avatar },
    };
  }
}
