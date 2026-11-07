import { Injectable, NotFoundException, ForbiddenException, BadRequestException, ConflictException } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { prisma } from "@essentials/db";
import type { JwtUser } from "../common/roles.guard";
import { NotificationsService } from "../notifications/notifications.service";

export const SLOTS = ["day", "evening", "late-night"] as const;
export type Slot = (typeof SLOTS)[number];

const SLOT_HOURS: Record<Slot, { start: number; end: number }> = {
  day: { start: 14, end: 20 },
  evening: { start: 20, end: 24 },
  "late-night": { start: 0, end: 6 },
};

/**
 * DJ booking flow:
 * 1. event approved → all artists notified (email + notification), event posted to the front-page lineup
 * 2. artist applies for a slot (day / evening / late-night) → pending ArtistBooking
 * 3. promoter notified of the application
 * 4. promoter confirms → booking confirmed, DJ notified
 */
@Injectable()
export class DjBookingService {
  constructor(
    private notifications: NotificationsService,
    private config: ConfigService,
  ) {}

  private appUrl() {
    return this.config.get("APP_URL") ?? "https://essentialsedm.com";
  }

  /** Step 1 — called when an event gets approved: notify every artist + post to the front-page lineup. */
  async announceToArtists(eventId: string) {
    const event = await prisma.event.findUnique({ where: { id: eventId }, include: { venue: { select: { name: true } } } });
    if (!event) throw new NotFoundException("Event not found");

    const artists = await prisma.user.findMany({ where: { role: "artist" }, select: { id: true } });
    await this.notifications.deliver(
      artists.map((a) => a.id),
      {
        kind: "dj_call",
        title: `DJ CALL: ${event.title}`,
        body: `${event.venue.name} · ${event.date.toDateString()} — slots open (day / evening / late-night). Apply now.`,
        link: `${this.appUrl()}/artist`,
        channels: ["inapp", "email", "telegram"],
      },
    );
    return { notified: artists.length };
  }

  /** Step 2 — artist applies for a slot. */
  async apply(user: JwtUser, eventId: string, slot: Slot) {
    if (!SLOTS.includes(slot)) throw new BadRequestException(`Slot must be one of: ${SLOTS.join(", ")}`);
    const profile = await prisma.artistProfile.findUnique({ where: { userId: user.sub } });
    if (!profile) throw new BadRequestException("Create your artist profile first");

    const event = await prisma.event.findUnique({ where: { id: eventId } });
    if (!event) throw new NotFoundException("Event not found");

    const existing = await prisma.artistBooking.findFirst({
      where: { eventId, artistId: profile.id, status: { not: "cancelled" } },
    });
    if (existing) throw new ConflictException("You already applied for this event");

    const [y, m, d] = [event.date.getUTCFullYear(), event.date.getUTCMonth(), event.date.getUTCDate()];
    const { start, end } = SLOT_HOURS[slot];
    const startAt = end > start ? new Date(Date.UTC(y, m, d, start)) : new Date(Date.UTC(y, m, d, start));
    const endAt = end > start ? new Date(Date.UTC(y, m, d, end)) : new Date(Date.UTC(y, m + 1, d, end));

    const booking = await prisma.artistBooking.create({
      data: {
        eventId,
        artistId: profile.id,
        slot,
        startAt,
        endAt,
        appliedAt: new Date(),
        status: "pending",
      },
      include: { artist: { include: { user: { select: { email: true, name: true } } } } },
    });

    // Step 3 — notify the promoter
    await this.notifications.deliver([event.promoterId], {
      kind: "application",
      title: `DJ application: ${booking.artist.stageName}`,
      body: `${booking.artist.stageName} applied for ${slot} at ${event.title}. Confirm in your dashboard.`,
      link: `${this.appUrl()}/applications`,
      channels: ["inapp", "email", "telegram"],
    });
    return booking;
  }

  /** Step 4 — promoter confirms (or declines) an application. */
  async decide(user: JwtUser, bookingId: string, confirm: boolean) {
    const booking = await prisma.artistBooking.findUnique({
      where: { id: bookingId },
      include: { event: true, artist: { include: { user: { select: { id: true, email: true } } } } },
    });
    if (!booking) throw new NotFoundException("Application not found");
    if (user.role !== "admin" && booking.event.promoterId !== user.sub) throw new ForbiddenException("Not your event");

    const status = confirm ? "confirmed" : "cancelled";
    await prisma.artistBooking.update({ where: { id: bookingId }, data: { status } });

    const title = confirm ? `CONFIRMED — ${booking.event.title}` : `Application declined`;
    const body = confirm
      ? `You're playing ${booking.event.title} (${booking.slot} slot). ${booking.event.date.toDateString()} — see your gig calendar. Fee: ${booking.performanceFee}.`
      : `The promoter declined your application for ${booking.event.title}.`;
    await this.notifications.deliver([booking.artist.userId], {
      kind: confirm ? "confirmed" : "declined",
      title,
      body,
      link: `${this.appUrl()}/artist`,
      // A decline is worth a bell, not a message on every channel.
      channels: confirm ? ["inapp", "email", "telegram"] : ["inapp"],
    });
    return prisma.artistBooking.findUnique({ where: { id: bookingId } });
  }

  /** Promoter: applications for their events. */
  async applications(user: JwtUser, eventId?: string) {
    return prisma.artistBooking.findMany({
      where: {
        ...(eventId ? { eventId } : {}),
        event: user.role === "admin" ? {} : { promoterId: user.sub },
      },
      include: {
        artist: { include: { user: { select: { name: true, email: true } } } },
        event: { select: { title: true, date: true } },
      },
      orderBy: { appliedAt: "desc" },
      take: 100,
    });
  }
}
