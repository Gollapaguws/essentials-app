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
        body: `${event.venue.name} · ${event.date.toDateString()} — ${
          event.slotCount && event.slotMinutes
            ? `${event.slotCount} × ${event.slotMinutes} min slots, fees set by the promoter`
            : "slots open (day / evening / late-night)"
        }. Apply now.`,
        link: `${this.appUrl()}/artist`,
        channels: ["inapp", "email", "telegram"],
      },
    );
    return { notified: artists.length };
  }

  /**
   * Step 2 — artist applies for a slot.
   *
   * A slot id is the real contract: the promoter's own slot carries its time and
   * fee. `eventId` + `slot` stays for events planned before slots existed, whose
   * rows have none.
   */
  async apply(user: JwtUser, input: { eventId?: string; slot?: string; slotId?: string }) {
    const profile = await prisma.artistProfile.findUnique({ where: { userId: user.sub } });
    if (!profile) throw new BadRequestException("Create your artist profile first");

    let event: { id: string; title: string; promoterId: string; date: Date };
    let slotLabel: string;
    let slotId: string | null = null;
    let startAt: Date;
    let endAt: Date;
    let fee = 0;

    if (input.slotId) {
      const slot = await prisma.eventSlot.findUnique({ where: { id: input.slotId }, include: { event: true } });
      if (!slot) throw new NotFoundException("Slot not found");
      if (slot.event.status !== "approved" && slot.event.status !== "live") {
        throw new BadRequestException("This event is not taking applications");
      }
      if (slot.startsAt.getTime() <= Date.now()) throw new BadRequestException("That slot has already started");

      const held = await prisma.artistBooking.findFirst({
        where: { slotId: slot.id, status: { not: "cancelled" } },
      });
      if (held) throw new ConflictException("Another DJ already holds that slot");

      event = slot.event;
      slotLabel = slot.label;
      slotId = slot.id;
      startAt = slot.startsAt;
      endAt = slot.endsAt;
      fee = slot.fee;
    } else {
      if (!input.eventId) throw new BadRequestException("slotId or eventId is required");
      const legacySlot = input.slot as Slot;
      if (!SLOTS.includes(legacySlot)) throw new BadRequestException(`Slot must be one of: ${SLOTS.join(", ")}`);

      const found = await prisma.event.findUnique({ where: { id: input.eventId } });
      if (!found) throw new NotFoundException("Event not found");

      event = found;
      slotLabel = legacySlot;
      const [y, m, d] = [found.date.getUTCFullYear(), found.date.getUTCMonth(), found.date.getUTCDate()];
      const { start, end } = SLOT_HOURS[legacySlot];
      startAt = new Date(Date.UTC(y, m, d, start));
      endAt = end > start ? new Date(Date.UTC(y, m, d, end)) : new Date(Date.UTC(y, m + 1, d, end));
    }

    const existing = await prisma.artistBooking.findFirst({
      where: { eventId: event.id, artistId: profile.id, status: { not: "cancelled" } },
    });
    if (existing) throw new ConflictException("You already applied for this event");

    const booking = await prisma.artistBooking.create({
      data: {
        eventId: event.id,
        artistId: profile.id,
        slot: slotLabel,
        slotId,
        startAt,
        endAt,
        performanceFee: fee,
        appliedAt: new Date(),
        status: "pending",
      },
      include: { artist: { include: { user: { select: { email: true, name: true } } } } },
    });

    // Step 3 — notify the promoter
    await this.notifications.deliver([event.promoterId], {
      kind: "application",
      title: `DJ application: ${booking.artist.stageName}`,
      body: `${booking.artist.stageName} applied for ${slotLabel} at ${event.title}. Confirm in your dashboard.`,
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

  /**
   * Promoter's second confirmation: the gig was actually played.
   *
   * This is the invoice gate — a booking only becomes `completed` here, and only
   * `completed` bookings can be billed to the venue. It also has to be after the
   * set, so nobody confirms a night that has not happened.
   */
  async confirmCompleted(user: JwtUser, bookingId: string) {
    const booking = await prisma.artistBooking.findUnique({
      where: { id: bookingId },
      include: {
        event: { include: { venue: { select: { name: true, managerId: true } } } },
        artist: { select: { userId: true } },
      },
    });
    if (!booking) throw new NotFoundException("Booking not found");

    const isOwner = booking.event.promoterId === user.sub;
    const isVenueManager = user.role === "venue_manager" && booking.event.venue.managerId === user.sub;
    if (user.role !== "admin" && !isOwner && !isVenueManager) throw new ForbiddenException("Not your event");

    if (booking.status === "completed") return booking;
    if (booking.status !== "confirmed") throw new BadRequestException("Only a confirmed gig can be marked complete");
    if (booking.endAt.getTime() > Date.now()) {
      throw new BadRequestException("That gig has not finished yet — confirm it after the set");
    }

    const completed = await prisma.artistBooking.update({
      where: { id: bookingId },
      data: { status: "completed", completedAt: new Date() },
    });

    await this.notifications.deliver([booking.artist.userId], {
      kind: "generic",
      title: `Gig confirmed: ${booking.event.title}`,
      body: `${booking.event.venue.name} confirmed your ${booking.slot ?? "set"}. You can invoice the venue for ${booking.performanceFee} now.`,
      link: `${this.appUrl()}/gig-calendar`,
      channels: ["inapp", "email"],
    });
    return completed;
  }

  /** Promoter: applications for their events, with their own note on each DJ. */
  async applications(user: JwtUser, eventId?: string) {
    const bookings = await prisma.artistBooking.findMany({
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

    // The note the promoter left on a previous application should be in view
    // while deciding this one. Only their own notes are attached.
    const artistIds = [...new Set(bookings.map((b) => b.artistId))];
    const notes = artistIds.length
      ? await prisma.artistNote.findMany({ where: { promoterId: user.sub, artistId: { in: artistIds } } })
      : [];
    const byArtist = new Map(notes.map((n) => [n.artistId, n]));
    return bookings.map((b) => ({ ...b, note: byArtist.get(b.artistId) ?? null }));
  }
}
