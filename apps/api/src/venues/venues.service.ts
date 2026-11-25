import { Injectable, NotFoundException, ForbiddenException, BadRequestException, ConflictException } from "@nestjs/common";
import { prisma, EventStatus } from "@essentials/db";
import { NotificationsService } from "../notifications/notifications.service";
import { DjBookingService } from "../artists/dj-booking.service";
import { ArtistsService } from "../artists/artists.service";
import { DoorGigsService } from "../door-gigs/door-gigs.service";
import type { JwtUser } from "../common/roles.guard";

export interface VenueDetailsInput {
  name?: string;
  address?: string;
  lat?: number;
  lng?: number;
}

export interface VenueCreateInput {
  name: string;
  address?: string;
  capacity: number;
  lat?: number;
  lng?: number;
}

/**
 * Phase 2 venue portal backend. A venue is reachable by the manager recorded on
 * it (which includes a promoter who created it) and by members of its workspace;
 * admins reach everything.
 */
@Injectable()
export class VenuesService {
  constructor(
    private notifications: NotificationsService,
    private djBooking: DjBookingService,
    private artists: ArtistsService,
    private doorGigs: DoorGigsService,
  ) {}
  private async assertManager(venueId: string, user: JwtUser) {
    const venue = await prisma.venue.findUnique({ where: { id: venueId } });
    if (!venue) throw new NotFoundException("Venue not found");
    // A room belongs to a workspace, so every member of that workspace can
    // manage it; `managerId` keeps pre-organisation venues reachable.
    const sameOrg = Boolean(venue.orgId && venue.orgId === user.orgId);
    if (user.role !== "admin" && venue.managerId !== user.sub && !sameOrg) {
      throw new ForbiddenException("Not your venue");
    }
    return venue;
  }

  async myVenues(user: JwtUser) {
    return prisma.venue.findMany({
      where:
        user.role === "admin"
          ? {}
          : user.orgId
            ? { OR: [{ orgId: user.orgId }, { managerId: user.sub }] }
            : { managerId: user.sub },
      include: { _count: { select: { events: true } } },
    });
  }

  /**
   * Promoters create the rooms they run nights at. The creator becomes the
   * venue's manager, so the event-approval workflow still has an owner and the
   * venue portal can edit it later.
   */
  async create(user: JwtUser, input: VenueCreateInput) {
    const name = input.name.trim();
    if (!name) throw new BadRequestException("Venue name cannot be empty.");
    if (!Number.isInteger(input.capacity) || input.capacity < 1) {
      throw new BadRequestException("Capacity must be a whole number of at least 1.");
    }
    // One axis alone would put the venue on a meaningless line for routing.
    if ((input.lat === undefined) !== (input.lng === undefined)) {
      throw new BadRequestException(
        "Send latitude and longitude together so DJ route planning stays correct.",
      );
    }
    // Two rooms with one name split the events, staff and door logs between them.
    // Refuse the second: the existing venue is already in the picker.
    const duplicate = await prisma.venue.findFirst({
      where: { name: { equals: name, mode: "insensitive" } },
      select: { name: true },
    });
    if (duplicate) {
      throw new ConflictException(
        `A venue named "${duplicate.name}" already exists — pick it from the venue list instead of creating a new one.`,
      );
    }

    return prisma.venue.create({
      data: {
        name,
        address: input.address?.trim() || null,
        capacity: input.capacity,
        // 0/0 is the existing "coordinates not set yet" sentinel (listForPicker).
        lat: input.lat ?? 0,
        lng: input.lng ?? 0,
        managerId: user.sub,
        orgId: user.orgId ?? null,
      },
    });
  }

  /**
   * Picker for promoters creating an event. Venues without coordinates are
   * returned too (they still exist), flagged so the UI can warn: DJ routing
   * measures between venue locations. The picker deliberately spans every venue:
   * rooms are physical places that several promoters book, and the venue manager
   * — not workspace membership — approves each night.
   */
  async listForPicker(_user: JwtUser) {
    const venues = await prisma.venue.findMany({
      select: { id: true, name: true, address: true, lat: true, lng: true, capacity: true, managerId: true },
      orderBy: { name: "asc" },
    });
    return venues.map((v) => ({ ...v, hasLocation: v.lat !== 0 || v.lng !== 0 }));
  }

  /**
   * Venue profile + coordinates. DJ route planning (`ArtistsService.planDay`)
   * measures distance between venue lat/lng, so moving a venue invalidates the
   * legs already saved against it and they are rebuilt here.
   */
  async updateVenue(user: JwtUser, venueId: string, input: VenueDetailsInput) {
    const venue = await this.assertManager(venueId, user);

    const data: { name?: string; address?: string | null; lat?: number; lng?: number } = {};
    if (input.name !== undefined) {
      const name = input.name.trim();
      if (!name) throw new BadRequestException("Venue name cannot be empty.");
      data.name = name;
    }
    if (input.address !== undefined) data.address = input.address.trim() || null;
    if (input.lat !== undefined) data.lat = input.lat;
    if (input.lng !== undefined) data.lng = input.lng;

    // One axis alone would put the venue on a meaningless line for routing.
    if ((input.lat === undefined) !== (input.lng === undefined)) {
      throw new BadRequestException(
        "Send latitude and longitude together so DJ route planning stays correct.",
      );
    }

    if (!Object.keys(data).length) throw new BadRequestException("Nothing to update.");

    const updated = await prisma.venue.update({ where: { id: venueId }, data });

    const moved =
      (input.lat !== undefined && input.lat !== venue.lat) ||
      (input.lng !== undefined && input.lng !== venue.lng);
    if (moved) {
      // Saving a location must not fail because a route rebuild hit a snag.
      await this.artists.recomputeForVenue(venueId).catch(() => null);
    }

    return updated;
  }

  /** Event approval workflow: pending_venue_approval -> approved | draft(rejected). */
  async pendingEvents(user: JwtUser, venueId?: string) {
    return prisma.event.findMany({
      where: {
        status: EventStatus.pending_venue_approval,
        ...(user.role === "admin"
          ? {}
          : user.orgId
            ? {
                venue: {
                  OR: [{ orgId: user.orgId }, { managerId: user.sub }],
                },
              }
            : { venue: { managerId: user.sub } }),
        ...(venueId ? { venueId } : {}),
      },
      include: { venue: { select: { name: true } }, promoter: { select: { name: true } } },
      orderBy: { date: "asc" },
    });
  }

  async decideEvent(user: JwtUser, eventId: string, approve: boolean) {
    const event = await prisma.event.findUnique({ where: { id: eventId }, include: { venue: true } });
    if (!event) throw new NotFoundException("Event not found");
    const managesVenue =
      event.venue.managerId === user.sub ||
      Boolean(event.venue.orgId && event.venue.orgId === user.orgId);
    if (user.role !== "admin" && !managesVenue) throw new ForbiddenException();
    if (event.status !== EventStatus.pending_venue_approval) throw new BadRequestException("Event is not pending approval");
    const updated = await prisma.event.update({
      where: { id: eventId },
      data: { status: approve ? EventStatus.approved : EventStatus.draft },
    });
    if (approve) this.announceApproval(updated);
    return updated;
  }

  /**
   * What "approved" means: every DJ hears the call and the night is posted to the
   * front-page lineup. Shared with a promoter's own venue, where creating the event
   * is the approval (nobody else could grant it).
   */
  announceApproval(event: { id: string; title: string; date: Date; venueId: string }) {
    void this.djBooking.announceToArtists(event.id).catch(() => null);
    // Door hosts get their own call, but only when the promoter asked for one.
    void this.doorGigs.announceToDoorStaff(event.id).catch(() => null);
    void this.postToLineup(event).catch(() => null);
  }

  /** Table inventory management. */
  /** Auto-post an approved event into the front-page lineup (SiteContent.events). */
  private async postToLineup(event: { id: string; title: string; date: Date; venueId: string }) {
    const row = await prisma.siteContent.findUnique({ where: { key: "front_page" } });
    const value = (row?.value ?? {}) as Record<string, unknown>;
    const events = Array.isArray(value["events"]) ? (value["events"] as Record<string, string>[]) : [];
    if (events.some((e) => e.eventId === event.id)) return;
    const venue = await prisma.venue.findUnique({ where: { id: event.venueId } });
    events.unshift({
      eventId: event.id,
      title: event.title,
      displayDate: event.date.toDateString(),
      venue: venue?.name ?? "TBA",
      doors: "22:00",
      price: "TBA",
      status: "ANNOUNCED",
    });
    await prisma.siteContent.update({ where: { key: "front_page" }, data: { value: { ...value, events } as object } }).catch(async () => {
      await prisma.siteContent.create({ data: { key: "front_page", value: { ...value, events } as object } });
    });
  }

  /** Staff/door ops monitor: recent scans for the venue's events. */
  async doorLogs(user: JwtUser, venueId: string) {
    await this.assertManager(venueId, user);
    return prisma.doorLog.findMany({
      where: { venueId },
      orderBy: { createdAt: "desc" },
      take: 100,
    });
  }

  /**
   * What this room owes the DJs who played it: fees agreed per night, what has
   * been invoiced, what is still unpaid, and the promoter/venue split that night
   * was booked on. Money a venue can act on, unlike a raw event count.
   */
  async revenue(user: JwtUser, venueId: string) {
    await this.assertManager(venueId, user);
    const events = await prisma.event.findMany({
      where: { venueId },
      select: {
        id: true,
        title: true,
        date: true,
        status: true,
        revenueSplitPromoterPct: true,
        artistBookings: {
          where: { status: { in: ["confirmed", "completed"] } },
          select: { performanceFee: true, invoice: { select: { status: true, total: true } } },
        },
      },
      orderBy: { date: "desc" },
    });

    const sum = (values: number[]) => values.reduce((a, b) => a + b, 0);
    const rows = events.map((e) => {
      const fees = sum(e.artistBookings.map((b) => b.performanceFee));
      const invoiced = sum(e.artistBookings.map((b) => b.invoice?.total ?? 0));
      // A paid invoice is settled in full; otherwise only its paid payments count.
      const paid = sum(
        e.artistBookings.map((b) => (b.invoice?.status === "paid" ? b.invoice.total : 0)),
      );
      const unbilled = e.artistBookings.filter((b) => !b.invoice);
      return {
        id: e.id,
        title: e.title,
        date: e.date,
        status: e.status,
        promoterPct: e.revenueSplitPromoterPct,
        venuePct: 100 - e.revenueSplitPromoterPct,
        djFees: fees,
        invoiced,
        paid,
        /** Billed and not yet paid — the venue's outstanding DJ debt. */
        owed: invoiced - paid,
        /** Played gigs the DJ has not invoiced yet, so nothing is owed on them yet. */
        unbilledGigs: unbilled.length,
        unbilledFees: sum(unbilled.map((b) => b.performanceFee)),
      };
    });

    return {
      nights: rows,
      totals: {
        nights: rows.length,
        djFees: sum(rows.map((r) => r.djFees)),
        invoiced: sum(rows.map((r) => r.invoiced)),
        paid: sum(rows.map((r) => r.paid)),
        owed: sum(rows.map((r) => r.owed)),
        unbilledGigs: sum(rows.map((r) => r.unbilledGigs)),
      },
    };
  }

  /** Venue analytics: how each night at this room filled and turned up. */
  async analytics(user: JwtUser, venueId: string) {
    await this.assertManager(venueId, user);
    const events = await prisma.event.findMany({
      where: { venueId },
      include: { guestLists: true },
      orderBy: { date: "desc" },
    });

    const perEvent = events.map((e) => ({
      name: e.title,
      date: e.date,
      status: e.status,
      rsvps: e.guestLists.length,
      checkedIn: e.guestLists.filter((g) => g.status === "checked_in").length,
    }));

    return {
      totals: {
        events: events.length,
        rsvps: perEvent.reduce((s, e) => s + e.rsvps, 0),
        checkedIn: perEvent.reduce((s, e) => s + e.checkedIn, 0),
      },
      perEvent,
    };
  }
}
