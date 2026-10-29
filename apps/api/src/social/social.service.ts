import { Injectable, NotFoundException, ForbiddenException, BadRequestException } from "@nestjs/common";
import { prisma } from "@essentials/db";
import type { JwtUser } from "../common/roles.guard";

const ICEBREAKERS = [
  "Two people into {taste} here — settle it: warehouse or rooftop?",
  "{taste} on the lineup tonight. First track you're hoping for?",
  "Heads up: {taste} crowd is out in force. What's your vibe — front row or VIP table?",
];

/** Phase 2: smart matching + per-event group chats with AI icebreakers. */
@Injectable()
export class SocialService {
  /** "People like you are going": guests sharing music tastes, scored. */
  async matchesForEvent(eventId: string, user: JwtUser) {
    if (user.role !== "guest" && user.role !== "admin") throw new ForbiddenException("Guests only");
    const me = await prisma.user.findUnique({ where: { id: user.sub } });
    if (!me) throw new NotFoundException();

    const attending = await prisma.guestList.findMany({
      where: { eventId, status: "attending", userId: { not: user.sub } },
      include: { user: { select: { id: true, name: true, avatar: true, musicTastes: true, vibeTag: true } } },
    });

    const scored = attending
      .map((a) => {
        const shared = a.user.musicTastes.filter((t) => me.musicTastes.includes(t));
        return {
          userId: a.user.id,
          name: a.user.name,
          avatar: a.user.avatar,
          vibeTag: a.user.vibeTag,
          sharedTastes: shared,
          score: shared.length * 2 + (a.user.vibeTag === me.vibeTag ? 1 : 0),
        };
      })
      .filter((m) => m.score > 0)
      .sort((a, b) => b.score - a.score)
      .slice(0, 10);

    // persist top matches (idempotent)
    for (const m of scored) {
      const [u1, u2] = [user.sub, m.userId].sort();
      await prisma.match.upsert({
        where: { eventId_user1Id_user2Id: { eventId, user1Id: u1, user2Id: u2 } },
        update: { sharedMusicTasteScore: m.score },
        create: { eventId, user1Id: u1, user2Id: u2, sharedMusicTasteScore: m.score },
      });
    }
    return scored;
  }

  /** Per-event group chat. Attendees read; attendees + event staff write. */
  async getChat(eventId: string, user: JwtUser) {
    const chat = await prisma.eventGroupChat.findUnique({ where: { eventId } });
    if (!chat) throw new NotFoundException("No chat for this event");
    const messages = await prisma.groupMessage.findMany({
      where: { chatId: chat.id },
      include: { user: { select: { id: true, name: true, avatar: true } } },
      orderBy: { createdAt: "asc" },
      take: 200,
    });
    return { chatId: chat.id, messages };
  }

  async postMessage(eventId: string, user: JwtUser, body: string) {
    const chat = await prisma.eventGroupChat.findUnique({ where: { eventId } });
    if (!chat) throw new NotFoundException("No chat for this event");
    const event = await prisma.event.findUnique({ where: { id: eventId } });
    if (!event) throw new NotFoundException("Event not found");
    const isAttendee = await prisma.guestList.findFirst({
      where: { eventId, userId: user.sub, status: { not: "waitlisted" } },
    });
    const isStaff = event.promoterId === user.sub || user.role === "admin";
    if (!isAttendee && !isStaff) throw new ForbiddenException("Join the guest list to chat");

    const message = await prisma.groupMessage.create({
      data: { chatId: chat.id, userId: user.sub, body: body.slice(0, 500) },
      include: { user: { select: { id: true, name: true, avatar: true } } },
    });
    return message;
  }

  /** AI icebreakers: deterministic generator seeded on the event's lineup + attendee tastes. */
  async icebreakers(eventId: string, user: JwtUser) {
    const event = await prisma.event.findUnique({ where: { id: eventId } });
    if (!event) throw new NotFoundException("Event not found");
    const attendeeTastes = await prisma.guestList.findMany({
      where: { eventId, status: "attending" },
      include: { user: { select: { musicTastes: true } } },
    });
    const counts: Record<string, number> = {};
    for (const a of attendeeTastes) for (const t of a.user.musicTastes) counts[t] = (counts[t] ?? 0) + 1;
    const top = Object.entries(counts).sort((a, b) => b[1] - a[1])[0]?.[0] ?? "the headliner";
    const lineup = (event.lineup as { artistName: string }[] | null) ?? [];
    const headliner = lineup[0]?.artistName ?? "the headliner";

    return [
      ICEBREAKERS[0].replace("{taste}", top),
      `Who else is here for ${headliner}? Drop your favourite track 👇`,
      ICEBREAKERS[2].replace("{taste}", top),
    ];
  }
}
