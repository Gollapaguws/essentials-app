import {
  Injectable,
  NotFoundException,
  ForbiddenException,
  BadRequestException,
  ConflictException,
} from "@nestjs/common";
import { randomBytes } from "crypto";
import type { Response } from "express";
import { ConfigService } from "@nestjs/config";
import { prisma } from "@essentials/db";
import { NotificationsService } from "../notifications/notifications.service";
import { ArtistsService, statementMonth } from "../artists/artists.service";
import { geocodeAddress, homeTravel } from "../common/geo";
import { escapeHtml } from "../common/html";
import type { JwtUser } from "../common/roles.guard";
import { parsePaging, type Paging } from "../common/paging";

/** The fields a venue needs to pay the door host directly. */
const REQUIRED_BANK_FIELDS = [
  { label: "account holder", key: "bankAccountHolder" },
  { label: "bank name", key: "bankName" },
  { label: "account number", key: "bankAccountNumber" },
  { label: "branch code", key: "bankBranchCode" },
] as const;

type BankProfile = {
  bankAccountHolder: string | null;
  bankName: string | null;
  bankAccountNumber: string | null;
  bankBranchCode: string | null;
  bankAccountType: string | null;
};

/** The payout block on the printable door invoice. */
function bankDetailsHtml(profile: BankProfile) {
  const rows = [
    ["Account holder", profile.bankAccountHolder],
    ["Bank", profile.bankName],
    ["Account number", profile.bankAccountNumber],
    ["Branch code", profile.bankBranchCode],
    ["Account type", profile.bankAccountType],
  ].filter(([, value]) => value?.trim());
  if (!rows.length) return "";

  return `<div class="bank"><h2>Payment details</h2>${rows
    .map(([label, value]) => `<p><strong>${label}:</strong> ${escapeHtml(value ?? "")}</p>`)
    .join("")}<p class="muted">Please quote the invoice number as your payment reference.</p></div>`;
}

/**
 * Door staff booking flow — the same shape as DJ booking:
 * 1. the promoter creates an event with a door fee (part of its budget)
 * 2. approval puts the night in every door host's list
 * 3. a host applies, the promoter confirms
 * 4. after the night the promoter marks the shift worked
 * 5. the host invoices the venue: shift fee plus travel from home and back
 */
@Injectable()
export class DoorGigsService {
  constructor(
    private notifications: NotificationsService,
    private artists: ArtistsService,
    private config: ConfigService,
  ) {}

  private appUrl() {
    return (this.config.get<string>("APP_URL") ?? "https://sonus.essentialsedm.com").replace(/\/$/, "");
  }

  /** Step 1 — an approved night with a door fee goes out to every door host. */
  async announceToDoorStaff(eventId: string) {
    const event = await prisma.event.findUnique({
      where: { id: eventId },
      include: { venue: { select: { name: true } } },
    });
    if (!event) throw new NotFoundException("Event not found");
    if (!event.doorEnabled) return { notified: 0 };

    const doorStaff = await prisma.user.findMany({ where: { role: "door" }, select: { id: true } });
    await this.notifications.deliver(
      doorStaff.map((user) => user.id),
      {
        kind: "door_call",
        title: `DOOR SHIFT: ${event.title}`,
        body: `${event.venue.name} · ${event.date.toDateString()} — R${event.doorFee.toLocaleString()} for the door. Apply now.`,
        link: `${this.appUrl()}/door`,
        channels: ["inapp", "telegram"],
      },
    );
    return { notified: doorStaff.length };
  }

  /** The signed-in host's private profile, or null before they fill it in. */
  profile(user: JwtUser) {
    return prisma.doorProfile.findUnique({ where: { userId: user.sub } });
  }

  /**
   * Save the host's home base and payout account. The address is geocoded once
   * (or uses the coordinates from "use my location"), and new profiles inherit
   * the platform travel rate.
   */
  async saveProfile(
    user: JwtUser,
    data: {
      homeAddress?: string;
      homeLat?: number;
      homeLng?: number;
      bankAccountHolder?: string;
      bankName?: string;
      bankAccountNumber?: string;
      bankBranchCode?: string;
      bankAccountType?: string;
    },
  ) {
    const clean = (value: string) => value.trim() || null;
    const patch: Record<string, unknown> = {
      ...(data.bankAccountHolder !== undefined
        ? { bankAccountHolder: clean(data.bankAccountHolder) }
        : {}),
      ...(data.bankName !== undefined ? { bankName: clean(data.bankName) } : {}),
      ...(data.bankAccountNumber !== undefined
        ? { bankAccountNumber: clean(data.bankAccountNumber) }
        : {}),
      ...(data.bankBranchCode !== undefined
        ? { bankBranchCode: clean(data.bankBranchCode) }
        : {}),
      ...(data.bankAccountType !== undefined
        ? { bankAccountType: clean(data.bankAccountType) }
        : {}),
    };
    const existing = await prisma.doorProfile.findUnique({ where: { userId: user.sub } });

    if (data.homeAddress !== undefined) {
      const homeAddress = data.homeAddress.trim();
      const provided =
        data.homeLat != null && data.homeLng != null
          ? { lat: data.homeLat, lng: data.homeLng }
          : null;
      if (!homeAddress) {
        Object.assign(patch, { homeAddress: null, homeLat: null, homeLng: null });
      } else if (provided) {
        Object.assign(patch, { homeAddress, homeLat: provided.lat, homeLng: provided.lng });
      } else if (
        existing?.homeAddress === homeAddress &&
        existing.homeLat != null &&
        existing.homeLng != null
      ) {
        Object.assign(patch, { homeAddress });
      } else {
        const found = await geocodeAddress(homeAddress);
        if (!found) {
          throw new BadRequestException(
            "We could not find that address. Check it, or use USE MY LOCATION.",
          );
        }
        Object.assign(patch, { homeAddress, homeLat: found.lat, homeLng: found.lng });
      }
    }

    if (existing) {
      return prisma.doorProfile.update({ where: { userId: user.sub }, data: patch });
    }
    return prisma.doorProfile.create({
      data: {
        userId: user.sub,
        travelRatePerKm: await this.artists.currentTravelRate(),
        ...patch,
      },
    });
  }

  /** Nights with a door fee that this host has not applied for yet. */
  async openGigs(user: JwtUser) {
    const profile = await prisma.doorProfile.findUnique({ where: { userId: user.sub } });
    const applied = profile
      ? (
          await prisma.doorBooking.findMany({
            where: { profileId: profile.id, status: { not: "cancelled" } },
            select: { eventId: true },
          })
        ).map((booking) => booking.eventId)
      : [];

    return prisma.event.findMany({
      where: {
        status: { in: ["approved", "live"] },
        date: { gte: new Date() },
        doorEnabled: true,
        id: { notIn: applied },
      },
      select: {
        id: true,
        title: true,
        date: true,
        capacity: true,
        status: true,
        doorFee: true,
        venue: { select: { name: true, address: true } },
        _count: { select: { doorBookings: { where: { status: { not: "cancelled" } } } } },
      },
      orderBy: { date: "asc" },
      take: 50,
    });
  }

  /** Step 3 — a host applies for one night's door shift. */
  async apply(user: JwtUser, eventId: string) {
    const profile = await prisma.doorProfile.findUnique({ where: { userId: user.sub } });
    if (!profile) {
      throw new BadRequestException(
        "Add your door profile first — home address and bank details are needed to invoice.",
      );
    }

    const event = await prisma.event.findUnique({ where: { id: eventId } });
    if (!event) throw new NotFoundException("Event not found");
    if (!event.doorEnabled) throw new BadRequestException("This event does not need door staff");
    if (event.status !== "approved" && event.status !== "live") {
      throw new BadRequestException("This event is not taking door applications");
    }
    if (event.date.getTime() <= Date.now()) {
      throw new BadRequestException("That night has already started");
    }

    const existing = await prisma.doorBooking.findUnique({
      where: { eventId_profileId: { eventId, profileId: profile.id } },
    });
    if (existing && existing.status !== "cancelled") {
      throw new ConflictException("You have already applied for this night");
    }

    const booking = existing
      ? await prisma.doorBooking.update({
          where: { id: existing.id },
          data: {
            fee: event.doorFee,
            status: "pending",
            appliedAt: new Date(),
            declineReason: null,
          },
        })
      : await prisma.doorBooking.create({
          data: {
            eventId,
            profileId: profile.id,
            fee: event.doorFee,
            appliedAt: new Date(),
            status: "pending",
          },
        });

    await this.notifications.deliver([event.promoterId], {
      kind: "application",
      title: `Door application: ${event.title}`,
      body: `${profile.homeAddress ?? "A door host"} applied to work the door at ${event.title} for R${event.doorFee.toLocaleString()}. Confirm in your dashboard.`,
      link: `${this.appUrl()}/applications`,
      channels: ["inapp", "telegram"],
    });
    return booking;
  }

  /** A host can pull a pending application before it is decided. */
  async withdraw(user: JwtUser, bookingId: string) {
    const profile = await prisma.doorProfile.findUnique({ where: { userId: user.sub } });
    if (!profile) throw new BadRequestException("Add your door profile first");
    const booking = await prisma.doorBooking.findUnique({ where: { id: bookingId } });
    if (!booking) throw new NotFoundException("Application not found");
    if (booking.profileId !== profile.id) throw new ForbiddenException("Not your application");
    if (booking.status !== "pending") {
      throw new BadRequestException("Only a pending application can be withdrawn");
    }
    return prisma.doorBooking.update({
      where: { id: bookingId },
      data: { status: "cancelled" },
    });
  }

  /** The host's own door shifts and where each one stands on money. */
  async myGigs(user: JwtUser) {
    const profile = await prisma.doorProfile.findUnique({ where: { userId: user.sub } });
    if (!profile) return [];

    const bookings = await prisma.doorBooking.findMany({
      where: { profileId: profile.id, status: { not: "cancelled" } },
      include: {
        event: {
          include: { venue: { select: { name: true, address: true, lat: true, lng: true } } },
        },
        invoice: { select: { id: true, number: true, status: true, total: true } },
      },
      orderBy: { event: { date: "asc" } },
    });

    return bookings.map((booking) => {
      const travel = booking.invoice
        ? booking.travelFee
        : (homeTravel(profile, booking.event.venue)?.fee ?? 0);
      return {
        id: booking.id,
        status: booking.status,
        appliedAt: booking.appliedAt,
        completedAt: booking.completedAt,
        declineReason: booking.declineReason,
        fee: booking.fee,
        travelFee: travel,
        amount: booking.invoice?.total ?? booking.fee + travel,
        event: {
          id: booking.event.id,
          title: booking.event.title,
          date: booking.event.date,
          venue: booking.event.venue,
        },
        invoice: booking.invoice,
      };
    });
  }

  /**
   * Promoter queue. `committed` is every confirmed DJ and door fee on the night,
   * so the UI can warn before a confirmation breaks the ceiling.
   */
  async applications(user: JwtUser, eventId?: string) {
    if (user.role !== "promoter" && user.role !== "admin") {
      throw new ForbiddenException("Promoters only");
    }
    const bookings = await prisma.doorBooking.findMany({
      where: {
        ...(eventId ? { eventId } : {}),
        event: user.role === "admin" ? {} : { promoterId: user.sub },
      },
      include: {
        profile: { include: { user: { select: { name: true, email: true } } } },
        event: { select: { id: true, title: true, date: true, budget: true, doorFee: true } },
      },
      orderBy: { appliedAt: "desc" },
      take: 100,
    });

    const eventIds = [...new Set(bookings.map((booking) => booking.eventId))];
    const [artistCommitted, doorCommitted] = eventIds.length
      ? await Promise.all([
          prisma.artistBooking.groupBy({
            by: ["eventId"],
            where: {
              eventId: { in: eventIds },
              status: { in: ["confirmed", "completed"] },
            },
            _sum: { performanceFee: true },
          }),
          prisma.doorBooking.groupBy({
            by: ["eventId"],
            where: { eventId: { in: eventIds }, status: { in: ["confirmed", "completed"] } },
            _sum: { fee: true },
          }),
        ])
      : [[], []];
    const committed = new Map<string, number>();
    for (const row of artistCommitted) {
      committed.set(row.eventId, (committed.get(row.eventId) ?? 0) + (row._sum.performanceFee ?? 0));
    }
    for (const row of doorCommitted) {
      committed.set(row.eventId, (committed.get(row.eventId) ?? 0) + (row._sum.fee ?? 0));
    }

    return bookings.map(({ profile, ...booking }) => ({
      ...booking,
      host: {
        name: profile.user.name,
        email: profile.user.email,
        travelRatePerKm: profile.travelRatePerKm,
      },
      event: { ...booking.event, committed: committed.get(booking.eventId) ?? 0 },
    }));
  }

  /**
   * Confirming a host promises the door fee, so it counts against the night's
   * budget exactly like a DJ fee.
   */
  private async assertBudgetRoom(
    event: { id: string; budget: number; title: string },
    fee: number,
    excludeBookingId?: string,
  ) {
    if (event.budget <= 0) return;

    const [artist, door] = await Promise.all([
      prisma.artistBooking.aggregate({
        where: { eventId: event.id, status: { in: ["confirmed", "completed"] } },
        _sum: { performanceFee: true },
      }),
      prisma.doorBooking.aggregate({
        where: {
          eventId: event.id,
          ...(excludeBookingId ? { id: { not: excludeBookingId } } : {}),
          status: { in: ["confirmed", "completed"] },
        },
        _sum: { fee: true },
      }),
    ]);
    const committed = (artist._sum.performanceFee ?? 0) + (door._sum.fee ?? 0);
    if (committed + fee > event.budget) {
      throw new ConflictException(
        `Over budget — the door fee is R${fee.toLocaleString()} and ${event.title} is already committed to R${committed.toLocaleString()} of its R${event.budget.toLocaleString()} budget. Raise the budget on the event, or decline this host.`,
      );
    }
  }

  /** Step 4 — promoter confirms or declines the host. */
  async decide(user: JwtUser, bookingId: string, confirm: boolean, reason?: string) {
    const booking = await prisma.doorBooking.findUnique({
      where: { id: bookingId },
      include: {
        event: { select: { id: true, title: true, date: true, budget: true, promoterId: true } },
        profile: { include: { user: { select: { id: true, email: true } } } },
      },
    });
    if (!booking) throw new NotFoundException("Door application not found");
    if (user.role !== "admin" && booking.event.promoterId !== user.sub) {
      throw new ForbiddenException("Not your event");
    }
    if (booking.status !== "pending") {
      throw new BadRequestException("That application has already been decided");
    }

    if (confirm) {
      const holder = await prisma.doorBooking.findFirst({
        where: {
          eventId: booking.eventId,
          id: { not: booking.id },
          status: { in: ["confirmed", "completed"] },
        },
        select: { id: true },
      });
      if (holder) {
        throw new ConflictException(
          "Another door host already holds that shift — decline them before confirming someone else.",
        );
      }
      await this.assertBudgetRoom(booking.event, booking.fee);
    }

    const note = reason?.trim().slice(0, 500) || null;
    const updated = await prisma.doorBooking.update({
      where: { id: booking.id },
      data: {
        status: confirm ? "confirmed" : "cancelled",
        ...(confirm ? {} : { declineReason: note }),
      },
    });

    await this.notifications.deliver([booking.profile.user.id], {
      kind: confirm ? "confirmed" : "declined",
      title: confirm ? `DOOR CONFIRMED — ${booking.event.title}` : "Door application declined",
      body: confirm
        ? `You're working the door at ${booking.event.title} on ${booking.event.date.toDateString()}. Fee: R${booking.fee.toLocaleString()}.`
        : `The promoter declined your door application for ${booking.event.title}.${note ? ` Reason: ${note}` : ""}`,
      link: `${this.appUrl()}/door`,
      channels: confirm ? ["inapp", "telegram"] : ["inapp"],
    });
    return updated;
  }

  /**
   * Step 5 — the promoter confirms the shift was worked. Invoicing is only
   * unlocked from here, and only once the night is over.
   */
  async complete(user: JwtUser, bookingId: string) {
    const booking = await prisma.doorBooking.findUnique({
      where: { id: bookingId },
      include: {
        event: {
          select: {
            title: true,
            date: true,
            promoterId: true,
            venue: { select: { name: true, managerId: true } },
          },
        },
        profile: { select: { userId: true } },
      },
    });
    if (!booking) throw new NotFoundException("Door booking not found");

    const isOwner = booking.event.promoterId === user.sub;
    const isVenueManager =
      user.role === "venue_manager" && booking.event.venue.managerId === user.sub;
    if (user.role !== "admin" && !isOwner && !isVenueManager) {
      throw new ForbiddenException("Not your event");
    }
    if (booking.status === "completed") return booking;
    if (booking.status !== "confirmed") {
      throw new BadRequestException("Only a confirmed door shift can be marked worked");
    }
    if (booking.event.date.getTime() > Date.now()) {
      throw new BadRequestException("That night has not happened yet — confirm it afterwards");
    }

    const updated = await prisma.doorBooking.update({
      where: { id: booking.id },
      data: { status: "completed", completedAt: new Date() },
    });
    await this.notifications.deliver([booking.profile.userId], {
      kind: "generic",
      title: `Shift confirmed: ${booking.event.title}`,
      body: `The door shift at ${booking.event.venue.name} is confirmed as worked. You can invoice the venue for R${booking.fee.toLocaleString()} plus travel now.`,
      link: `${this.appUrl()}/door`,
      channels: ["inapp"],
    });
    return updated;
  }

  /** A host's door invoices, newest first. */

  async invoices(user: JwtUser) {
    const profile = await prisma.doorProfile.findUnique({ where: { userId: user.sub } });
    if (!profile) return [];
    return prisma.doorInvoice.findMany({
      where: { profileId: profile.id },
      include: { items: true },
      orderBy: { createdAt: "desc" },
    });
  }

  /**
   * Invoice the venue for a shift the promoter confirmed as worked: the door fee
   * plus return travel from the host's home base at the platform rate. One
   * invoice per shift — the unique booking id enforces it.
   */
  async generateInvoice(user: JwtUser, bookingId: string) {
    const profile = await prisma.doorProfile.findUnique({ where: { userId: user.sub } });
    if (!profile) {
      throw new BadRequestException("Add your door profile first — it holds your payout details.");
    }
    const missing = REQUIRED_BANK_FIELDS.filter(({ key }) => !profile[key]?.trim()).map(
      ({ label }) => label,
    );
    if (missing.length) {
      throw new BadRequestException(
        `Add your bank account details on the Door page before invoicing (${missing.join(", ")} missing).`,
      );
    }

    const booking = await prisma.doorBooking.findUnique({
      where: { id: bookingId },
      include: {
        event: {
          include: {
            venue: { select: { name: true, address: true, lat: true, lng: true } },
          },
        },
        invoice: { select: { id: true } },
      },
    });
    if (!booking) throw new NotFoundException("Door booking not found");
    if (booking.profileId !== profile.id) throw new ForbiddenException("Not your shift");
    if (booking.invoice) throw new ConflictException("That shift has already been invoiced");
    if (booking.status !== "completed") {
      throw new BadRequestException(
        "The promoter confirms the shift was worked before it can be invoiced",
      );
    }

    if (!profile.homeAddress || profile.homeLat == null || profile.homeLng == null) {
      throw new BadRequestException(
        "Add your home base address on the Door page so travel to the venue can be calculated.",
      );
    }
    const venue = booking.event.venue;
    const travel = homeTravel(profile, venue);
    if (!travel) {
      throw new BadRequestException(
        "This venue has no map coordinates, so travel cannot be calculated. Ask the venue manager to set its location.",
      );
    }

    const date = booking.event.date.toISOString().slice(0, 10);
    const items = [
      {
        label: `Door shift: ${booking.event.title} @ ${venue.name} (${date})`,
        amount: booking.fee,
      },
    ];
    if (travel.fee > 0) {
      items.push({
        label: `Travel: home base to ${venue.name} and back — ${travel.distanceKm.toFixed(1)} km @ R${profile.travelRatePerKm.toFixed(2)}/km`,
        amount: travel.fee,
      });
    }
    const total = booking.fee + travel.fee;
    if (total <= 0) {
      throw new BadRequestException("This shift pays nothing and has no travel, so there is nothing to invoice");
    }

    const number = `ESS-D-${new Date().getFullYear()}-${randomBytes(3).toString("hex").toUpperCase()}`;
    const [invoice] = await prisma.$transaction([
      prisma.doorInvoice.create({
        data: {
          profileId: profile.id,
          bookingId: booking.id,
          venueId: booking.event.venueId,
          number,
          status: "sent",
          total,
          items: { create: items },
        },
        include: { items: true, venue: { select: { name: true } } },
      }),
      prisma.doorBooking.update({
        where: { id: booking.id },
        data: { travelFee: travel.fee },
      }),
    ]);
    return invoice;
  }

  /**
   * The host's own statements: every confirmed or worked shift grouped by the
   * month it happened, with the fee, travel, what was invoiced and what is paid.
   */
  async statements(user: JwtUser) {
    const profile = await prisma.doorProfile.findUnique({
      where: { userId: user.sub },
      include: { user: { select: { name: true, email: true } } },
    });
    if (!profile) throw new BadRequestException("Add your door profile first");

    const bookings = await prisma.doorBooking.findMany({
      where: { profileId: profile.id, status: { in: ["confirmed", "completed"] } },
      include: {
        event: { include: { venue: { select: { name: true, lat: true, lng: true } } } },
        invoice: { select: { number: true, status: true, total: true } },
      },
      orderBy: { event: { date: "desc" } },
    });

    const sum = (values: number[]) => values.reduce((a, b) => a + b, 0);
    const shifts = bookings.map((booking) => {
      const travel = booking.invoice
        ? booking.travelFee
        : (homeTravel(profile, booking.event.venue)?.fee ?? 0);
      const invoiced = booking.invoice?.total ?? 0;
      return {
        id: booking.id,
        date: booking.event.date,
        night: booking.event.title,
        venue: booking.event.venue.name,
        fee: booking.fee,
        travel,
        travelEstimated: !booking.invoice,
        agreed: booking.fee + travel,
        invoiced,
        paid: booking.invoice?.status === "paid" ? invoiced : 0,
        invoice: booking.invoice
          ? { number: booking.invoice.number, status: booking.invoice.status }
          : null,
      };
    });

    const byMonth = new Map<string, typeof shifts>();
    for (const shift of shifts) {
      const key = shift.date.toISOString().slice(0, 7);
      byMonth.set(key, [...(byMonth.get(key) ?? []), shift]);
    }
    const months = [...byMonth.entries()]
      .sort(([a], [b]) => b.localeCompare(a))
      .map(([key, list]) => ({
        key,
        shifts: list,
        shiftCount: list.length,
        fee: sum(list.map((row) => row.fee)),
        travel: sum(list.map((row) => row.travel)),
        agreed: sum(list.map((row) => row.agreed)),
        invoiced: sum(list.map((row) => row.invoiced)),
        paid: sum(list.map((row) => row.paid)),
        outstanding: sum(list.map((row) => row.agreed)) - sum(list.map((row) => row.paid)),
      }));

    return {
      profile: { name: profile.user.name, email: profile.user.email },
      months,
      totals: {
        fee: sum(shifts.map((row) => row.fee)),
        travel: sum(shifts.map((row) => row.travel)),
        agreed: sum(shifts.map((row) => row.agreed)),
        invoiced: sum(shifts.map((row) => row.invoiced)),
        paid: sum(shifts.map((row) => row.paid)),
        outstanding: sum(shifts.map((row) => row.agreed)) - sum(shifts.map((row) => row.paid)),
        shifts: shifts.length,
        months: months.length,
      },
    };
  }

  /**
   * Promoter view: one statement per door host across their nights, grouped by
   * month, paged by host so a big client book still renders one screen.
   */
  async promoterStatements(user: JwtUser, paging: Paging = parsePaging()) {
    if (user.role !== "promoter" && user.role !== "admin") {
      throw new ForbiddenException("Promoters only");
    }
    const bookings = await prisma.doorBooking.findMany({
      where: {
        status: { in: ["confirmed", "completed"] },
        ...(user.role === "admin" ? {} : { event: { promoterId: user.sub } }),
      },
      include: {
        profile: { include: { user: { select: { name: true, email: true } } } },
        event: { include: { venue: { select: { name: true } } } },
        invoice: { select: { number: true, status: true, total: true } },
      },
      orderBy: { event: { date: "desc" } },
    });

    const sum = (values: number[]) => values.reduce((a, b) => a + b, 0);
    type ShiftRow = {
      id: string;
      date: Date;
      night: string;
      venue: string;
      fee: number;
      travel: number;
      agreed: number;
      invoiced: number;
      paid: number;
      invoice: { number: string; status: string } | null;
    };
    const byHost = new Map<
      string,
      { id: string; name: string | null; email: string; shifts: ShiftRow[] }
    >();
    for (const booking of bookings) {
      const invoiced = booking.invoice?.total ?? 0;
      const entry = byHost.get(booking.profileId) ?? {
        id: booking.profileId,
        name: booking.profile.user.name,
        email: booking.profile.user.email,
        shifts: [],
      };
      entry.shifts.push({
        id: booking.id,
        date: booking.event.date,
        night: booking.event.title,
        venue: booking.event.venue.name,
        fee: booking.fee,
        travel: booking.travelFee,
        agreed: booking.fee + booking.travelFee,
        invoiced,
        paid: booking.invoice?.status === "paid" ? invoiced : 0,
        invoice: booking.invoice
          ? { number: booking.invoice.number, status: booking.invoice.status }
          : null,
      });
      byHost.set(booking.profileId, entry);
    }

    const allHosts = [...byHost.values()]
      .map((entry) => {
        const months = new Map<string, ShiftRow[]>();
        for (const shift of entry.shifts) {
          const key = shift.date.toISOString().slice(0, 7);
          months.set(key, [...(months.get(key) ?? []), shift]);
        }
        const monthRows = [...months.entries()]
          .sort(([a], [b]) => b.localeCompare(a))
          .map(([key, list]) => ({
            key,
            shiftCount: list.length,
            agreed: sum(list.map((row) => row.agreed)),
            invoiced: sum(list.map((row) => row.invoiced)),
            paid: sum(list.map((row) => row.paid)),
            outstanding: sum(list.map((row) => row.agreed)) - sum(list.map((row) => row.paid)),
          }));
        return {
          id: entry.id,
          name: entry.name,
          email: entry.email,
          shifts: entry.shifts,
          months: monthRows,
          agreed: sum(entry.shifts.map((row) => row.agreed)),
          invoiced: sum(entry.shifts.map((row) => row.invoiced)),
          paid: sum(entry.shifts.map((row) => row.paid)),
          outstanding:
            sum(entry.shifts.map((row) => row.agreed)) -
            sum(entry.shifts.map((row) => row.paid)),
        };
      })
      .sort((a, b) => (a.name ?? a.email).localeCompare(b.name ?? b.email));

    const hosts = allHosts.slice(paging.offset, paging.offset + paging.limit);
    return {
      hosts,
      totals: {
        hosts: allHosts.length,
        shifts: sum(allHosts.map((host) => host.shifts.length)),
        agreed: sum(allHosts.map((host) => host.agreed)),
        invoiced: sum(allHosts.map((host) => host.invoiced)),
        paid: sum(allHosts.map((host) => host.paid)),
        outstanding: sum(allHosts.map((host) => host.outstanding)),
      },
      page: {
        limit: paging.limit,
        offset: paging.offset,
        shown: hosts.length,
        total: allHosts.length,
        hasMore: paging.offset + hosts.length < allHosts.length,
      },
    };
  }

  /** One month of door money as a CSV — a host's own, or a promoter's hosts. */
  async statementCsv(
    user: JwtUser,
    month: string | undefined,
    res: Response,
    profileId?: string,
  ) {
    const range = month ? statementMonth(month) : statementMonth(new Date().toISOString().slice(0, 7));
    if (!range) throw new BadRequestException("month must be YYYY-MM");

    const esc = (value: unknown) => `"${String(value ?? "").replace(/"/g, '""')}"`;
    const rows: Array<{
      date: Date;
      night: string;
      venue: string;
      host: string;
      fee: number;
      travel: number;
      invoiceNumber: string;
      invoiceStatus: string;
      invoiced: number;
      paid: number;
    }> = [];

    if (user.role === "door") {
      const profile = await prisma.doorProfile.findUnique({
        where: { userId: user.sub },
        include: { user: { select: { name: true, email: true } } },
      });
      if (!profile) throw new BadRequestException("Add your door profile first");
      const bookings = await prisma.doorBooking.findMany({
        where: {
          profileId: profile.id,
          status: { in: ["confirmed", "completed"] },
          event: { date: { gte: range.start, lt: range.end } },
        },
        include: {
          event: { include: { venue: { select: { name: true } } } },
          invoice: { select: { number: true, status: true, total: true } },
        },
        orderBy: { event: { date: "asc" } },
      });
      for (const booking of bookings) {
        rows.push({
          date: booking.event.date,
          night: booking.event.title,
          venue: booking.event.venue.name,
          host: profile.user.name ?? profile.user.email,
          fee: booking.fee,
          travel: booking.travelFee,
          invoiceNumber: booking.invoice?.number ?? "",
          invoiceStatus: booking.invoice?.status ?? "not invoiced",
          invoiced: booking.invoice?.total ?? 0,
          paid: booking.invoice?.status === "paid" ? (booking.invoice?.total ?? 0) : 0,
        });
      }
    } else if (user.role === "promoter" || user.role === "admin") {
      if (profileId && user.role === "promoter") {
        const mine = await prisma.doorBooking.findFirst({
          where: { profileId, event: { promoterId: user.sub } },
          select: { id: true },
        });
        if (!mine) throw new ForbiddenException("That host has no shifts at your nights");
      }
      const bookings = await prisma.doorBooking.findMany({
        where: {
          status: { in: ["confirmed", "completed"] },
          event: {
            date: { gte: range.start, lt: range.end },
            ...(user.role === "admin" ? {} : { promoterId: user.sub }),
          },
          ...(profileId ? { profileId } : {}),
        },
        include: {
          profile: { include: { user: { select: { name: true, email: true } } } },
          event: { include: { venue: { select: { name: true } } } },
          invoice: { select: { number: true, status: true, total: true } },
        },
        orderBy: { event: { date: "asc" } },
      });
      for (const booking of bookings) {
        rows.push({
          date: booking.event.date,
          night: booking.event.title,
          venue: booking.event.venue.name,
          host: booking.profile.user.name ?? booking.profile.user.email,
          fee: booking.fee,
          travel: booking.travelFee,
          invoiceNumber: booking.invoice?.number ?? "",
          invoiceStatus: booking.invoice?.status ?? "not invoiced",
          invoiced: booking.invoice?.total ?? 0,
          paid: booking.invoice?.status === "paid" ? (booking.invoice?.total ?? 0) : 0,
        });
      }
    } else {
      throw new ForbiddenException("Statements are for door hosts, promoters and admins");
    }

    const lines = [
      "date,night,venue,host,fee,travel,invoice_number,invoice_status,invoiced,paid",
      ...rows.map((row) =>
        [
          row.date.toISOString().slice(0, 10),
          esc(row.night),
          esc(row.venue),
          esc(row.host),
          row.fee,
          row.travel,
          esc(row.invoiceNumber),
          esc(row.invoiceStatus),
          row.invoiced,
          row.paid,
        ].join(","),
      ),
      [
        "TOTAL",
        "",
        "",
        "",
        rows.reduce((a, b) => a + b.fee, 0),
        rows.reduce((a, b) => a + b.travel, 0),
        "",
        "",
        rows.reduce((a, b) => a + b.invoiced, 0),
        rows.reduce((a, b) => a + b.paid, 0),
      ].join(","),
    ];
    res.setHeader("Content-Type", "text/csv; charset=utf-8");
    res.setHeader(
      "Content-Disposition",
      `attachment; filename="door-statement-${range.key}.csv"`,
    );
    res.send(lines.join("\n"));
  }

  /** Branded print-ready door invoice (open and Ctrl+P → PDF). */
  async renderInvoice(user: JwtUser, invoiceId: string) {
    const invoice = await prisma.doorInvoice.findUnique({
      where: { id: invoiceId },
      include: {
        items: true,
        profile: { include: { user: { select: { name: true, email: true } } } },
        venue: { select: { name: true, address: true } },
      },
    });
    if (!invoice) throw new NotFoundException("Invoice not found");
    if (user.role !== "admin" && invoice.profile.user.email !== user.email) {
      throw new ForbiddenException();
    }

    const rows = invoice.items
      .map(
        (item) =>
          `<tr><td>${escapeHtml(item.label)}</td><td style="text-align:right">${item.amount.toLocaleString()}</td></tr>`,
      )
      .join("");
    const bank = bankDetailsHtml(invoice.profile);
    const payment = bank
      ? "using the bank details above or the payment link sent by SONUS"
      : "via the payment link sent by SONUS";
    return `<html><head><title>${escapeHtml(invoice.number)}</title><style>
      body{font-family:Helvetica,Arial,sans-serif;color:#0A0A0A;padding:48px;max-width:640px;margin:auto}
      h1{letter-spacing:3px;color:#00B24A;margin:0}
      .bar{border-top:4px solid #00FF66;margin:12px 0 24px}
      table{width:100%;border-collapse:collapse;margin-top:16px}
      td,th{padding:8px;border-bottom:1px solid #ddd;text-align:left;font-size:14px}
      .total{font-size:18px;font-weight:bold}
      .bank{margin-top:24px;padding:16px;border:1px solid #ddd;background:#fafafa}
      .bank h2{font-size:14px;letter-spacing:1px;margin:0 0 8px}
      .bank p{margin:4px 0;font-size:14px}
      .bank .muted{font-size:12px;color:#666;margin-top:10px}
    </style></head><body>
      <h1>SONUS</h1><div class="bar"></div>
      <p><strong>Door invoice ${escapeHtml(invoice.number)}</strong><br/>
      Door host: ${escapeHtml(invoice.profile.user.name ?? invoice.profile.user.email)} (${escapeHtml(invoice.profile.user.email)})<br/>
      Venue: ${escapeHtml(invoice.venue?.name ?? "Venue")}${invoice.venue?.address ? `, ${escapeHtml(invoice.venue.address)}` : ""}<br/>
      Date: ${new Date().toISOString().slice(0, 10)} · Status: ${escapeHtml(invoice.status)}</p>
      <table><tr><th>Item</th><th style="text-align:right">Amount</th></tr>${rows}
      <tr><td class="total">Total</td><td class="total" style="text-align:right">${invoice.total.toLocaleString()}</td></tr></table>
      ${bank}
      <p style="font-size:12px;color:#666;margin-top:32px">Payment: ${payment}. Please quote ${escapeHtml(invoice.number)} as the reference.</p>
    </body></html>`;
  }
}
