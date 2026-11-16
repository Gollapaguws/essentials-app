import { Injectable, NotFoundException } from "@nestjs/common";
import { ArtistBookingStatus, EventStatus, prisma } from "@essentials/db";

/**
 * DJ profiles as a guest sees them: stage name, photo, bio and the nights they
 * are confirmed for. Fees, travel rates, home address, bank details and
 * promoter notes stay private — a public page must never carry booking terms.
 */
@Injectable()
export class PublicDjsService {
  private readonly live = [EventStatus.approved, EventStatus.live];

  async list() {
    const profiles = await prisma.artistProfile.findMany({
      select: { id: true, stageName: true, bio: true, imageUrl: true },
      orderBy: { stageName: "asc" },
    });
    if (!profiles.length) return [];

    // A DJ with dates on the poster is the one to lead with, so count the
    // confirmed nights still ahead of us in one read.
    const bookings = await prisma.artistBooking.findMany({
      where: {
        status: ArtistBookingStatus.confirmed,
        startAt: { gte: new Date() },
        event: { status: { in: this.live } },
      },
      select: { artistId: true },
    });
    const upcoming = new Map<string, number>();
    for (const b of bookings) upcoming.set(b.artistId, (upcoming.get(b.artistId) ?? 0) + 1);

    return profiles
      .map((p) => ({ ...p, upcoming: upcoming.get(p.id) ?? 0 }))
      .sort(
        (a, b) =>
          Number(Boolean(b.imageUrl)) - Number(Boolean(a.imageUrl)) ||
          b.upcoming - a.upcoming ||
          a.stageName.localeCompare(b.stageName),
      );
  }

  async detail(id: string) {
    const profile = await prisma.artistProfile.findUnique({
      where: { id },
      select: { id: true, stageName: true, bio: true, imageUrl: true },
    });
    if (!profile) throw new NotFoundException("DJ not found");

    const bookings = await prisma.artistBooking.findMany({
      where: {
        artistId: id,
        status: ArtistBookingStatus.confirmed,
        startAt: { gte: new Date() },
        event: { status: { in: this.live } },
      },
      select: {
        slot: true,
        startAt: true,
        slotRef: { select: { label: true } },
        event: {
          select: {
            id: true,
            title: true,
            date: true,
            venue: { select: { name: true, address: true } },
          },
        },
      },
      orderBy: { startAt: "asc" },
      take: 20,
    });

    return {
      ...profile,
      sets: bookings.map((b) => ({
        eventId: b.event.id,
        title: b.event.title,
        date: b.event.date,
        venue: b.event.venue,
        time: b.slotRef?.label ?? b.slot ?? null,
      })),
    };
  }
}
