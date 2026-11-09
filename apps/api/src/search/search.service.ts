import { Injectable } from "@nestjs/common";
import { prisma } from "@essentials/db";
import type { Prisma } from "@prisma/client";
import type { JwtUser } from "../common/roles.guard";

export interface SearchResults {
  events: { id: string; title: string; date: Date; status: string; venue: string }[];
  artists: { id: string; name: string }[];
  guests: { id: string; name: string | null; email: string; status: string; eventId: string; eventTitle: string }[];
}

/**
 * One query box for the whole dashboard. Scoping mirrors the pages it jumps to:
 * a promoter only finds their own events and their guests, a venue manager also
 * finds events at venues they run, and an admin finds everything. Roles with no
 * dashboard (guest/artist) get the public artist roster and nothing private.
 */
@Injectable()
export class SearchService {
  /** The event filter every group is measured against, or null for no private data. */
  private eventScope(user: JwtUser): Prisma.EventWhereInput | null {
    if (user.role === "admin") return {};
    if (user.role === "venue_manager") {
      return { OR: [{ promoterId: user.sub }, { venue: { managerId: user.sub } }] };
    }
    if (user.role === "promoter") return { promoterId: user.sub };
    return null;
  }

  async find(user: JwtUser, raw: string): Promise<SearchResults> {
    // One character matches most of the database; two is where a query starts to
    // mean something, and it keeps a keystroke storm off the connection pool.
    const q = raw.trim();
    if (q.length < 2) return { events: [], artists: [], guests: [] };

    const scope = this.eventScope(user);
    const contains = { contains: q, mode: "insensitive" as const };

    const [events, artists, guests] = await Promise.all([
      scope
        ? prisma.event.findMany({
            where: {
              AND: [scope, { OR: [{ title: contains }, { venue: { name: contains } }] }],
            },
            select: { id: true, title: true, date: true, status: true, venue: { select: { name: true } } },
            orderBy: { date: "desc" },
            take: 8,
          })
        : Promise.resolve([]),
      prisma.artistProfile.findMany({
        where: { stageName: contains },
        select: { id: true, stageName: true },
        orderBy: { stageName: "asc" },
        take: 8,
      }),
      scope
        ? prisma.guestList.findMany({
            where: { event: scope, user: { OR: [{ name: contains }, { email: contains }] } },
            select: {
              id: true,
              status: true,
              user: { select: { name: true, email: true } },
              event: { select: { id: true, title: true } },
            },
            orderBy: { createdAt: "desc" },
            take: 8,
          })
        : Promise.resolve([]),
    ]);

    return {
      events: events.map((e) => ({
        id: e.id,
        title: e.title,
        date: e.date,
        status: e.status,
        venue: e.venue.name,
      })),
      artists: artists.map((a) => ({ id: a.id, name: a.stageName })),
      guests: guests.map((g) => ({
        id: g.id,
        name: g.user.name,
        email: g.user.email,
        status: g.status,
        eventId: g.event.id,
        eventTitle: g.event.title,
      })),
    };
  }
}
