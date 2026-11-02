import { Injectable, NotFoundException, ForbiddenException, BadRequestException, ConflictException } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { prisma } from "@essentials/db";
import type { JwtUser } from "../common/roles.guard";
import { NotificationsService } from "../notifications/notifications.service";
import { MailService } from "../mail/mail.service";
import { wrapTemplate } from "../mail/templates";

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
    private mail: MailService,
    private config: ConfigService,
  ) {}

  private appUrl() {
    return this.config.get("APP_URL") ?? "https://essentialsedm.com";
  }

  /** Step 1 — called when an event gets approved: notify every artist + post to the front-page lineup. */
  async announceToArtists(eventId: string) {
    const event = await prisma.event.findUnique({ where: { id: eventId }, include: { venue: { select: { name: true } } } });
    if (!event) throw new NotFoundException("Event not found");

    const artists = await prisma.user.findMany({ where: { role: "artist" }, select: { id: true, email: true } });
    const link = `${this.appUrl()}/dashboard/artist`;
    await this.notifications.notifyMany(
      artists.map((a) => a.id),
      "dj_call",
      `DJ CALL: ${event.title}`,
      `${event.venue.name} · ${event.date.toDateString()} — slots open (day / evening / late-night). Apply now.`,
      link,
    );
    for (const a of artists) {
      const html = `<h1 style="color:#00FF66;letter-spacing:2px;font-size:22px">DJ CALL — ${event.title}</h1>
        <p>${event.venue.name} · ${event.date.toDateString()}</p>
        <p>Slots open: DAY · EVENING · LATE-NIGHT. Apply from your artist dashboard.</p>
        <p><a href="${link}" style="background:#00FF66;color:#0A0A0A;padding:10px 20px;border-radius:6px;text-decoration:none;font-weight:bold">OPEN GIG CALENDAR</a></p>`;
      try {
        await this.mail.send({ to: a.email, subject: `DJ call — ${event.title}`, html: wrapTemplate(html) });
      } catch {}
    }
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
    await this.notifications.notify(
      event.promoterId,
      "application",
      `DJ application: ${booking.artist.stageName}`,
      `${booking.artist.stageName} applied for ${slot} at ${event.title}. Confirm in your dashboard.`,
      `${this.appUrl()}/dashboard/applications`,
    );
    const promoter = await prisma.user.findUnique({ where: { id: event.promoterId } });
    if (promoter) {
      const html = `<h1 style="color:#00FF66;letter-spacing:2px;font-size:22px">NEW DJ APPLICATION</h1>
        <p><strong>${booking.artist.stageName}</strong> applied for <strong>${slot}</strong> at ${event.title}.</p>
        <p><a href="${this.appUrl()}/dashboard/applications" style="color:#00FF66">Review applications →</a></p>`;
      try {
        await this.mail.send({ to: promoter.email, subject: `DJ application — ${event.title}`, html: wrapTemplate(html) });
      } catch {}
    }
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
      ? `You're playing ${booking.event.title} (${booking.slot} slot). ${booking.event.date.toDateString()} @ — see your gig calendar.`
      : `The promoter declined your application for ${booking.event.title}.`;
    await this.notifications.notify(booking.artist.userId, confirm ? "confirmed" : "declined", title, body, `${this.appUrl()}/dashboard/artist`);

    if (confirm) {
      try {
        await this.mail.send({
          to: booking.artist.user.email,
          subject: `Gig confirmed — ${booking.event.title}`,
          html: wrapTemplate(`<h1 style="color:#00FF66;letter-spacing:2px;font-size:22px">GIG CONFIRMED</h1>
            <p><strong>${booking.event.title}</strong> · ${booking.event.date.toDateString()} · ${booking.slot} slot</p>
            <p>Fee: ${booking.performanceFee}. Travel billed separately via your invoice.</p>`),
        });
      } catch {}
    }
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
