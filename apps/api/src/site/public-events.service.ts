import { Injectable, NotFoundException } from "@nestjs/common";
import { prisma, ArtistBookingStatus, EventStatus } from "@essentials/db";

/**
 * The one event surface a guest can read without a session. Email CTAs and the
 * public site link here, so a guest never lands on the promoter login.
 */
@Injectable()
export class PublicEventsService {
  private readonly live = [EventStatus.approved, EventStatus.live];

  async list() {
    const events = await prisma.event.findMany({
      where: { status: { in: this.live }, date: { gte: new Date() } },
      include: {
        venue: { select: { name: true, address: true } },
        _count: { select: { guestLists: { where: { status: { not: "waitlisted" } } } } },
      },
      orderBy: { date: "asc" },
      take: 50,
    });
    return this.withArtists(events.map((e) => this.shape(e)));
  }

  async detail(id: string) {
    const event = await prisma.event.findFirst({
      where: { id, status: { in: this.live } },
      include: {
        venue: { select: { name: true, address: true } },
        _count: { select: { guestLists: { where: { status: { not: "waitlisted" } } } } },
      },
    });
    if (!event) throw new NotFoundException("Event not found");
    return (await this.withArtists([this.shape(event)]))[0];
  }

  /**
   * A confirmed DJ is public: the set time on the card and the artist name.
   * Read at request time, so a confirmation shows up on the next page load
   * without anyone editing the event.
   */
  private async withArtists<T extends { id: string }>(
    rows: T[],
  ): Promise<
    (T & { artists: { id: string; name: string; time: string | null; role: string | null; bpm: string | null }[] })[]
  > {
    const ids = rows.map((r) => r.id);
    if (!ids.length) return rows.map((r) => ({ ...r, artists: [] }));

    const bookings = await prisma.artistBooking.findMany({
      where: { eventId: { in: ids }, status: ArtistBookingStatus.confirmed },
      select: {
        eventId: true,
        slot: true,
        slotRef: { select: { label: true, role: true, bpmRange: true } },
        artist: { select: { id: true, stageName: true } },
      },
      orderBy: { startAt: "asc" },
    });

    const byEvent = new Map<
      string,
      { id: string; name: string; time: string | null; role: string | null; bpm: string | null }[]
    >();
    for (const b of bookings) {
      const list = byEvent.get(b.eventId) ?? [];
      list.push({
        id: b.artist.id,
        name: b.artist.stageName,
        time: b.slotRef?.label ?? b.slot ?? null,
        role: b.slotRef?.role ?? null,
        bpm: b.slotRef?.bpmRange ?? null,
      });
      byEvent.set(b.eventId, list);
    }
    return rows.map((r) => ({ ...r, artists: byEvent.get(r.id) ?? [] }));
  }

  /** Only what a guest may see: no promoter, no guest list, no fees. */
  private shape(e: {
    id: string;
    title: string;
    description: string | null;
    date: Date;
    lineup: unknown;
    capacity: number;
    dressCode: string | null;
    ticketUrl: string | null;
    status: string;
    venue: { name: string; address: string | null };
    _count: { guestLists: number };
  }) {
    return {
      id: e.id,
      title: e.title,
      description: e.description,
      date: e.date,
      lineup: Array.isArray(e.lineup) ? e.lineup : [],
      capacity: e.capacity,
      dressCode: e.dressCode,
      ticketUrl: e.ticketUrl,
      status: e.status,
      venue: e.venue,
      going: e._count.guestLists,
    };
  }
}
