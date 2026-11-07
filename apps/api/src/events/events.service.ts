import { Injectable, ForbiddenException, NotFoundException, BadRequestException, ConflictException } from "@nestjs/common";
import { createHmac } from "crypto";
import { prisma, GuestListStatus, EventStatus } from "@essentials/db";
import type { JwtUser } from "../common/roles.guard";
import { ConfigService } from "@nestjs/config";
import { LoyaltyService } from "../loyalty/loyalty.service";
import { VenuesService } from "../venues/venues.service";
import { buildSlots, normalizePlan } from "./slots";

/** Every query is role-scoped: guests see own data, promoters their events, venue managers their venues, admin all. */
@Injectable()
export class EventsService {
  constructor(
    private config: ConfigService,
    private loyalty: LoyaltyService,
    private venues: VenuesService,
  ) {}

  /** Door-pass HMAC key — independent of the (removed) session JWT secret. */
  private qrSecret() {
    const secret = this.config.get<string>("QR_SECRET") ?? this.config.get<string>("JWT_SECRET");
    if (secret) return secret;
    if (process.env.NODE_ENV === "production") throw new Error("QR_SECRET is required in production");
    return "dev-secret";
  }

  private signQr(eventId: string, userId: string) {
    return `EL:${eventId}:${userId}:${createHmac("sha256", this.qrSecret()).update(`${eventId}:${userId}`).digest("hex").slice(0, 24)}`;
  }

  private verifyQr(token: string) {
    const parts = token.split(":");
    if (parts.length !== 4 || parts[0] !== "EL") return null;
    const [, eventId, userId, sig] = parts;
    if (this.signQr(eventId, userId).split(":")[3] !== sig) return null;
    return { eventId, userId };
  }

  /** Upcoming approved/live events for the guest feed. */
  async feed() {
    const events = await prisma.event.findMany({
      where: { status: { in: [EventStatus.approved, EventStatus.live] }, date: { gte: new Date() } },
      include: {
        venue: { select: { name: true, lat: true, lng: true, amenities: true } },
        _count: { select: { guestLists: { where: { status: { not: "waitlisted" } } } } },
      },
      orderBy: { date: "asc" },
    });
    return events.map((e) => ({
      id: e.id,
      title: e.title,
      description: e.description,
      date: e.date,
      lineup: e.lineup,
      dressCode: e.dressCode,
      status: e.status,
      venue: e.venue,
      going: e._count.guestLists,
      capacity: e.capacity,
    }));
  }

  async detail(eventId: string, user: JwtUser) {
    const event = await prisma.event.findUnique({
      where: { id: eventId },
      include: {
        venue: true,
        promoter: { select: { id: true, name: true } },
        guestLists: { include: { user: { select: { id: true, name: true, avatar: true } } } },
        _count: { select: { guestLists: { where: { status: { not: "waitlisted" } } } } },
      },
    });
    if (!event) throw new NotFoundException("Event not found");
    this.assertCanManage(event.promoterId, event.venue.managerId, user);

    const going = event._count.guestLists;
    const myRsvp =
      user.role === "guest"
        ? event.guestLists.find((g) => g.userId === user.sub) ?? null
        : null;
    return {
      ...event,
      going,
      headcount: `${going}/${event.capacity} going`,
      spotsLeft: Math.max(0, event.capacity - going),
      myRsvp,
      guestLists: user.role === "guest" ? undefined : event.guestLists,
    };
  }

  /** RSVP with capacity enforcement -> waitlist when full. Records campaign attribution. */
  async rsvp(eventId: string, user: JwtUser, headcount = 1, sourceCampaignId?: string) {
    if (user.role !== "guest" && user.role !== "admin") throw new ForbiddenException("Guests only");
    const event = await prisma.event.findUnique({ where: { id: eventId } });
    if (!event) throw new NotFoundException("Event not found");
    if (event.status !== EventStatus.approved && event.status !== EventStatus.live) {
      throw new BadRequestException("Event is not open for RSVPs");
    }

    const existing = await prisma.guestList.findUnique({
      where: { eventId_userId: { eventId, userId: user.sub } },
    });
    if (existing && existing.status !== "waitlisted") throw new ConflictException("Already on the list");

    const going = await prisma.guestList.count({ where: { eventId, status: { not: "waitlisted" } } });
    const status: GuestListStatus = going + headcount <= event.capacity ? "attending" : "waitlisted";

    const entry = await prisma.guestList.upsert({
      where: { eventId_userId: { eventId, userId: user.sub } },
      update: { status, headcount, sourceCampaignId: sourceCampaignId ?? existing?.sourceCampaignId },
      create: {
        eventId,
        userId: user.sub,
        status,
        headcount,
        sourceCampaignId,
        qrCode: status === "attending" ? this.signQr(eventId, user.sub) : null,
      },
    });
    return { status: entry.status, going: going + headcount, capacity: event.capacity };
  }

  async cancelRsvp(eventId: string, user: JwtUser) {
    await prisma.guestList.deleteMany({ where: { eventId, userId: user.sub, status: { not: "checked_in" } } });
    // promote first waitlisted if capacity allows
    const going = await prisma.guestList.count({ where: { eventId, status: { not: "waitlisted" } } });
    const event = await prisma.event.findUnique({ where: { id: eventId } });
    if (event && going < event.capacity) {
      const next = await prisma.guestList.findFirst({
        where: { eventId, status: "waitlisted" },
        orderBy: { createdAt: "asc" },
      });
      if (next) {
        await prisma.guestList.update({
          where: { id: next.id },
          data: { status: "attending", qrCode: this.signQr(eventId, next.userId) },
        });
      }
    }
    return { ok: true };
  }

  /** Door pass: refresh signed QR for an attending guest. */
  async doorPass(eventId: string, user: JwtUser) {
    const entry = await prisma.guestList.findUnique({
      where: { eventId_userId: { eventId, userId: user.sub } },
    });
    if (!entry || entry.status !== "attending") throw new NotFoundException("No door pass — RSVP first");
    const qrCode = this.signQr(eventId, user.sub);
    if (entry.qrCode !== qrCode) {
      await prisma.guestList.update({ where: { id: entry.id }, data: { qrCode } });
    }
    return { eventId, qrToken: qrCode, headcount: entry.headcount };
  }

  /** Promoter/venue door check-in scanner monitor. */
  async checkIn(qrToken: string, user: JwtUser) {
    const decoded = this.verifyQr(qrToken);
    if (!decoded) return { result: "invalid" as const };
    const entry = await prisma.guestList.findUnique({
      where: { eventId_userId: { eventId: decoded.eventId, userId: decoded.userId } },
      include: { event: { include: { venue: true } }, user: { select: { name: true } } },
    });
    if (!entry) return { result: "invalid" as const };
    if (entry.event.promoterId !== user.sub && entry.event.venue.managerId !== user.sub && user.role !== "admin") {
      throw new ForbiddenException("Not your event");
    }
    if (entry.status === "checked_in") return { result: "duplicate" as const, guest: entry.user.name };
    await prisma.guestList.update({
      where: { id: entry.id },
      data: { status: "checked_in", checkedInAt: new Date() },
    });
    await prisma.doorLog.create({
      data: { venueId: entry.event.venueId, eventId: entry.eventId, scannedBy: user.sub, qrToken, result: "ok" },
    });
    void this.loyalty.recordVisit(decoded.userId, decoded.eventId);
    return { result: "ok" as const, guest: entry.user.name, headcount: entry.headcount };
  }

  /** CRUD for promoters. */
  async create(user: JwtUser, data: {
    venueId: string; title: string; description?: string; date: string | Date;
    lineup?: unknown; capacity: number; dressCode?: string; ticketUrl?: string; revenueSplitPromoterPct?: number;
    djFeePerHour?: number; budget?: number; slotCount?: number; slotMinutes?: number; slotStart?: string;
  }) {
    const venue = await prisma.venue.findUnique({ where: { id: data.venueId } });
    if (!venue) throw new NotFoundException("Venue not found");
    if (data.capacity > venue.capacity) throw new BadRequestException(`Capacity exceeds venue max (${venue.capacity})`);

    // Validate the promoter's slot plan before anything is written: a bad plan
    // must not leave a half-created night behind.
    const plan = normalizePlan(data);
    const { djFeePerHour, budget, slotCount, slotMinutes, slotStart, ...eventData } = data;
    const date = new Date(data.date);

    // A promoter who manages the venue *is* the venue: there is nobody left to
    // approve the night, so it goes live on creation — DJ call out, on the front page.
    const selfManaged = venue.managerId === user.sub;
    const created = await prisma.event.create({
      data: {
        ...eventData,
        date,
        promoterId: user.sub,
        lineup: (data.lineup ?? []) as object,
        status: selfManaged ? EventStatus.approved : EventStatus.pending_venue_approval,
        djFeePerHour: plan?.djFeePerHour ?? 0,
        budget: plan?.budget ?? 0,
        slotCount: plan?.slotCount ?? null,
        slotMinutes: plan?.slotMinutes ?? null,
        slotStartMinute: plan?.slotStartMinute ?? null,
        ...(plan ? { slots: { create: buildSlots(date, plan) } } : {}),
      },
      include: { slots: { orderBy: { startsAt: "asc" } } },
    });
    await prisma.eventGroupChat.create({ data: { eventId: created.id } });
    if (selfManaged) this.venues.announceApproval(created);
    return created;
  }

  /**
   * Replace an event's slot plan and budget. Refused once anyone has applied:
   * the slots they are holding must be resolved (declined/cancelled) first.
   */
  async setSlots(user: JwtUser, eventId: string, data: {
    djFeePerHour?: number; budget?: number; slotCount?: number; slotMinutes?: number; slotStart?: string;
  }) {
    const event = await prisma.event.findUnique({ where: { id: eventId }, include: { venue: true } });
    if (!event) throw new NotFoundException("Event not found");
    this.assertCanManage(event.promoterId, event.venue.managerId, user);

    const plan = normalizePlan(data);
    if (!plan) throw new BadRequestException("Slot count, slot length and start time are required");

    const applications = await prisma.artistBooking.count({
      where: { eventId, status: { not: "cancelled" } },
    });
    if (applications > 0) {
      throw new ConflictException(
        "Slots already have DJ applications. Decline or cancel them before re-planning the night.",
      );
    }

    await prisma.$transaction([
      prisma.eventSlot.deleteMany({ where: { eventId } }),
      prisma.eventSlot.createMany({ data: buildSlots(event.date, plan).map((s) => ({ ...s, eventId })) }),
      prisma.event.update({
        where: { id: eventId },
        data: {
          djFeePerHour: plan.djFeePerHour,
          budget: plan.budget,
          slotCount: plan.slotCount,
          slotMinutes: plan.slotMinutes,
          slotStartMinute: plan.slotStartMinute,
        },
      }),
    ]);
    return prisma.event.findUnique({ where: { id: eventId }, include: { slots: { orderBy: { startsAt: "asc" } } } });
  }

  async update(user: JwtUser, eventId: string, data: Record<string, unknown>) {
    const event = await prisma.event.findUnique({ where: { id: eventId }, include: { venue: true } });
    if (!event) throw new NotFoundException("Event not found");
    this.assertCanManage(event.promoterId, event.venue.managerId, user);
    return prisma.event.update({ where: { id: eventId }, data });
  }

  async listForPromoter(user: JwtUser) {
    if (user.role !== "promoter" && user.role !== "admin") throw new ForbiddenException("Promoters only");
    const events = await prisma.event.findMany({
      where: user.role === "admin" ? {} : { promoterId: user.sub },
      include: {
        venue: { select: { name: true } },
        _count: { select: { guestLists: true, tableBookings: true } },
        slots: {
          orderBy: { startsAt: "asc" },
          select: {
            id: true,
            label: true,
            fee: true,
            startsAt: true,
            bookings: { where: { status: { not: "cancelled" } }, select: { status: true } },
          },
        },
      },
      orderBy: { date: "desc" },
    });

    // The budget view: what each slot pays, which are taken, and how much of the
    // budget is already committed to confirmed DJs.
    return events.map((e) => {
      const slots = e.slots.map((s) => ({
        id: s.id,
        label: s.label,
        fee: s.fee,
        startsAt: s.startsAt,
        taken: s.bookings.length > 0,
        // Committed spend is anything the promoter has agreed to pay: confirmed
        // gigs and completed ones (completed is the stricter state).
        confirmed: s.bookings.some((b) => b.status === "confirmed" || b.status === "completed"),
      }));
      return {
        ...e,
        slots,
        committed: slots.filter((s) => s.confirmed).reduce((sum, s) => sum + s.fee, 0),
      };
    });
  }

  private assertCanManage(promoterId: string, venueManagerId: string | null | undefined, user: JwtUser) {
    if (user.role === "admin") return;
    if (user.role === "promoter" && user.sub === promoterId) return;
    if (user.role === "venue_manager" && venueManagerId === user.sub) return;
    if (user.role === "guest") return; // read-only via detail()
    throw new ForbiddenException();
  }
}
