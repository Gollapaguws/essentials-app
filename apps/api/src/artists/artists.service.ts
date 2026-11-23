import { Injectable, NotFoundException, ForbiddenException, BadRequestException } from "@nestjs/common";
import type { Response } from "express";
import { ConfigService } from "@nestjs/config";
import { prisma, ArtistBookingStatus } from "@essentials/db";
import { rmSync } from "fs";
import { join } from "path";
import { storeImage } from "../common/media-storage";
import { geocodeAddress, haversineKm, homeTravel } from "../common/geo";
import type { JwtUser } from "../common/roles.guard";

export { MAX_PROFILE_IMAGE_BYTES, PROFILE_IMAGE_EXTENSIONS } from "../common/media-storage";

/** Average city speed used for drive-time estimates (km/h) when no Maps key is configured. */
const AVG_SPEED_KMH = 45;

/** Key of the platform travel rate in `PlatformSetting`. */
export const TRAVEL_RATE_KEY = "travelRatePerKm";

/** The rate every DJ travels at until an admin sets another one. */
export const DEFAULT_TRAVEL_RATE_PER_KM = 4.95;

/** A positive rate stored as text, or the default when the setting is missing or damaged. */
export function parseTravelRate(value: string | undefined): number {
  const rate = Number(value);
  return Number.isFinite(rate) && rate > 0 ? rate : DEFAULT_TRAVEL_RATE_PER_KM;
}

export interface RouteLeg {
  fromBookingId: string;
  toBookingId: string | null;
  distanceKm: number;
  durationMinutes: number;
  estimatedFuelCost: number;
  isConflict: boolean;
  conflictReason?: string;
  mapsUrl: string;
}

/** The only booking fields route planning needs. */
interface GigWindow {
  id: string;
  startAt: Date;
  endAt: Date;
  setupBufferMin: number;
  teardownBufferMin: number;
  event: { venue: { lat: number; lng: number } };
}

interface TravelProfile {
  vehicleConsumptionLPer100km: number;
  travelRatePerKm: number;
}

export interface DayPlan {
  legs: RouteLeg[];
  totals: { distanceKm: number; fuelCost: number; travelFee: number };
  conflicts: number;
}

/**
 * iCalendar text for a DJ's confirmed and played gigs. Times go out in UTC, which
 * every calendar app accepts without needing a timezone definition.
 */
export function icsCalendar(
  items: { uid: string; start: Date; end: Date; summary: string; location?: string; description?: string }[],
  now = new Date(),
) {
  const stamp = (d: Date) => d.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");
  const text = (v: string) =>
    v.replace(/\\/g, "\\\\").replace(/;/g, "\\;").replace(/,/g, "\\,").replace(/\r?\n/g, "\\n");
  return [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//SONUS//Gig Calendar//EN",
    "CALSCALE:GREGORIAN",
    "METHOD:PUBLISH",
    ...items.flatMap((i) => [
      "BEGIN:VEVENT",
      `UID:${i.uid}@essentialsedm.com`,
      `DTSTAMP:${stamp(now)}`,
      `DTSTART:${stamp(i.start)}`,
      `DTEND:${stamp(i.end)}`,
      `SUMMARY:${text(i.summary)}`,
      ...(i.location ? [`LOCATION:${text(i.location)}`] : []),
      ...(i.description ? [`DESCRIPTION:${text(i.description)}`] : []),
      "END:VEVENT",
    ]),
    "END:VCALENDAR",
  ].join("\r\n");
}

/**
 * The month a statement covers, as `YYYY-MM`. Returns null when the value is
 * not a real month, so the caller can refuse it instead of billing the wrong
 * period.
 */
export function statementMonth(value: string | undefined) {
  const match = /^(\d{4})-(\d{2})$/.exec((value ?? "").trim());
  if (!match) return null;
  const year = Number(match[1]);
  const month = Number(match[2]);
  if (month < 1 || month > 12) return null;
  return {
    key: `${match[1]}-${match[2]}`,
    start: new Date(Date.UTC(year, month - 1, 1)),
    end: new Date(Date.UTC(year, month, 1)),
  };
}

/** Midnight at the start of the booking's local day. */
function startOfDay(value: string | Date): Date {
  const day = new Date(value);
  day.setHours(0, 0, 0, 0);
  return day;
}

/**
 * Phase 3 artist portal backend.
 * - gig calendar (day/evening/late-night slots)
 * - multi-gig routing with Schedule Collision Alert (drive time + setup + teardown buffers)
 * - fuel cost: (km / 100 × consumption) × fuel price
 * - billable travel fee: km × travel rate
 */
@Injectable()
export class ArtistsService {
  constructor(private config: ConfigService) {}

  private fuelPrice() {
    return parseFloat(this.config.get("FUEL_PRICE") ?? "23.5"); // currency per litre
  }

  async getProfile(user: JwtUser) {
    return prisma.artistProfile.findUnique({ where: { userId: user.sub } });
  }

  /**
   * Promoter: one DJ in full — profile, travel terms and their whole booking
   * history (pending, confirmed and cancelled), newest first.
   */
  async artistDetail(user: JwtUser, artistId: string) {
    const profile = await prisma.artistProfile.findUnique({
      where: { id: artistId },
      include: {
        user: { select: { name: true, email: true } },
        bookings: {
          orderBy: { startAt: "desc" },
          include: {
            event: {
              select: {
                id: true,
                title: true,
                date: true,
                status: true,
                venue: { select: { name: true } },
              },
            },
          },
        },
      },
    });
    if (!profile) throw new NotFoundException("Artist not found");

    const { bookings } = profile;
    return {
      // Explicit allowlist: bank details are for invoices, not for promoters.
      id: profile.id,
      userId: profile.userId,
      stageName: profile.stageName,
      bio: profile.bio,
      imageUrl: profile.imageUrl,
      vehicleConsumptionLPer100km: profile.vehicleConsumptionLPer100km,
      travelRatePerKm: profile.travelRatePerKm,
      user: profile.user,
      note: await this.noteFor(user.sub, artistId),
      confirmedGigs: bookings.filter((b) => b.status === ArtistBookingStatus.confirmed).length,
      bookings: bookings.map((b) => ({
        id: b.id,
        slot: b.slot,
        status: b.status,
        startAt: b.startAt,
        endAt: b.endAt,
        appliedAt: b.appliedAt,
        performanceFee: b.performanceFee,
        travelFee: b.travelFee,
        event: b.event,
      })),
    };
  }

  /**
   * The signed-in promoter's own note on a DJ, or null. Notes are per promoter:
   * another promoter's judgement is theirs, and the DJ never sees either.
   */
  async artistNote(user: JwtUser, artistId: string) {
    await this.assertArtist(artistId);
    return this.noteFor(user.sub, artistId);
  }

  /** Save (or clear, with an empty body) this promoter's note on a DJ. */
  async saveArtistNote(user: JwtUser, artistId: string, body: string) {
    await this.assertArtist(artistId);

    const text = body.trim();
    if (!text) {
      // Clearing the note deletes the row: an empty "note" would look like a note.
      await prisma.artistNote.deleteMany({ where: { promoterId: user.sub, artistId } });
      return null;
    }
    return prisma.artistNote.upsert({
      where: { promoterId_artistId: { promoterId: user.sub, artistId } },
      create: { promoterId: user.sub, artistId, body: text },
      update: { body: text },
    });
  }

  /** One row per promoter/DJ pair; callers validate the DJ first when they need a 404. */
  private noteFor(promoterId: string, artistId: string) {
    return prisma.artistNote.findUnique({
      where: { promoterId_artistId: { promoterId, artistId } },
    });
  }

  private async assertArtist(artistId: string) {
    const artist = await prisma.artistProfile.findUnique({ where: { id: artistId }, select: { id: true } });
    if (!artist) throw new NotFoundException("Artist not found");
  }

  /**
   * Promoter roster: every DJ with the terms they book on (travel rate) and the
   * gigs they are already confirmed for, so an application can be judged in context.
   */
  async roster() {
    const profiles = await prisma.artistProfile.findMany({
      include: {
        user: { select: { name: true, email: true } },
        bookings: {
          where: { status: ArtistBookingStatus.confirmed },
          orderBy: { startAt: "asc" },
          include: {
            event: { select: { title: true, date: true, venue: { select: { name: true } } } },
          },
        },
      },
      orderBy: { stageName: "asc" },
    });

    const now = Date.now();
    return profiles.map((p) => ({
      id: p.id,
      stageName: p.stageName,
      bio: p.bio,
      imageUrl: p.imageUrl,
      travelRatePerKm: p.travelRatePerKm,
      user: p.user,
      confirmedGigs: p.bookings.length,
      upcomingGigs: p.bookings
        .filter((b) => b.startAt.getTime() >= now)
        .slice(0, 3)
        .map((b) => ({ id: b.id, slot: b.slot, startAt: b.startAt, event: b.event })),
    }));
  }

  /**
   * The platform travel rate. Read from `PlatformSetting` — the single value new
   * profiles inherit and every invoice is priced from.
   */
  async currentTravelRate(): Promise<number> {
    const setting = await prisma.platformSetting.findUnique({ where: { key: TRAVEL_RATE_KEY } });
    return parseTravelRate(setting?.value);
  }

  /**
   * Admin only: the rate every DJ's routing and invoices use. The setting is the
   * number; `mixed` reports a profile that drifted from it (a manual edit, say),
   * which is the only way a second rate can still exist.
   */
  async standardTravelRate() {
    const [travelRatePerKm, profiles] = await Promise.all([
      this.currentTravelRate(),
      prisma.artistProfile.findMany({ select: { travelRatePerKm: true } }),
    ]);
    return {
      travelRatePerKm,
      artists: profiles.length,
      mixed: profiles.some((p) => p.travelRatePerKm !== travelRatePerKm),
    };
  }

  /**
   * Admin only: the standard rate every DJ travels at. The setting and every
   * profile move together in one transaction, so no profile is left behind and
   * a profile created afterwards inherits the same number.
   */
  async setStandardTravelRate(rate: number) {
    const [updated] = await prisma.$transaction([
      prisma.artistProfile.updateMany({ data: { travelRatePerKm: rate } }),
      prisma.platformSetting.upsert({
        where: { key: TRAVEL_RATE_KEY },
        create: { key: TRAVEL_RATE_KEY, value: String(rate) },
        update: { value: String(rate) },
      }),
    ]);
    return { travelRatePerKm: rate, artists: updated.count, mixed: false };
  }

  async upsertProfile(
    user: JwtUser,
    data: {
      stageName: string;
      bio?: string;
      imageUrl?: string;
      vehicleConsumptionLPer100km?: number;
      homeAddress?: string;
      homeLat?: number;
      homeLng?: number;
      bankAccountHolder?: string;
      bankName?: string;
      bankAccountNumber?: string;
      bankBranchCode?: string;
      bankAccountType?: string;
    },
    origin: string,
  ) {
    // An empty text field is a clear, not a missing one: store null so the UI hides it.
    const clean = (value: string) => value.trim() || null;
    const patch = {
      ...data,
      ...(data.bio !== undefined ? { bio: clean(data.bio) } : {}),
      ...(data.imageUrl !== undefined ? { imageUrl: clean(data.imageUrl) } : {}),
      ...(data.bankAccountHolder !== undefined ? { bankAccountHolder: clean(data.bankAccountHolder) } : {}),
      ...(data.bankName !== undefined ? { bankName: clean(data.bankName) } : {}),
      ...(data.bankAccountNumber !== undefined ? { bankAccountNumber: clean(data.bankAccountNumber) } : {}),
      ...(data.bankBranchCode !== undefined ? { bankBranchCode: clean(data.bankBranchCode) } : {}),
      ...(data.bankAccountType !== undefined ? { bankAccountType: clean(data.bankAccountType) } : {}),
    };
    const existing = await prisma.artistProfile.findUnique({ where: { userId: user.sub } });

    // The home base is the origin for invoice travel. An address is geocoded
    // once; if the DJ used "use my location" the supplied coordinates win.
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
      } else if (existing?.homeAddress === homeAddress && existing.homeLat != null && existing.homeLng != null) {
        Object.assign(patch, { homeAddress });
      } else {
        const found = await geocodeAddress(homeAddress);
        if (!found) {
          throw new BadRequestException(
            "We could not find that home base address. Check it, or use USE MY LOCATION on the profile.",
          );
        }
        Object.assign(patch, { homeAddress, homeLat: found.lat, homeLng: found.lng });
      }
    }

    if (existing) {
      const updated = await prisma.artistProfile.update({ where: { userId: user.sub }, data: patch });
      // The old photo is unreferenced once the profile points at a replacement (or none).
      if (data.imageUrl !== undefined && existing.imageUrl !== updated.imageUrl) {
        this.deleteStoredImage(existing.imageUrl, origin);
      }
      return updated;
    }
    // A new profile starts on the platform rate, not on the schema default, so a
    // rate change can never be undone by the next DJ who signs up.
    return prisma.artistProfile.create({
      data: { userId: user.sub, travelRatePerKm: await this.currentTravelRate(), ...patch },
    });
  }

  /** Store an uploaded profile photo and return the absolute URL to save on the profile. */
  saveProfileImage(file: Express.Multer.File, origin: string) {
    const mediaDir = this.config.get<string>("MEDIA_DIR") ?? "/var/www/essentialsedm/media";
    const publicBase = this.config.get<string>("PUBLIC_MEDIA_URL") ?? "/media";
    const { url } = storeImage(file, { mediaDir, publicBase, origin });
    return { ok: true, url };
  }

  /**
   * Remove a profile photo this API stored. Anything outside the media base — a
   * hand-pasted external URL, or a filename we did not generate — is left alone,
   * so a profile edit can never delete unrelated files.
   */
  private deleteStoredImage(url: string | null, origin: string) {
    if (!url) return;
    const publicBase = (this.config.get<string>("PUBLIC_MEDIA_URL") ?? "/media").replace(/\/+$/, "");
    const absoluteBase = /^https?:\/\//.test(publicBase);
    let allowedHost: string;
    let basePath: string;
    try {
      const baseUrl = absoluteBase ? new URL(publicBase) : new URL(origin);
      allowedHost = baseUrl.host;
      basePath = absoluteBase ? baseUrl.pathname.replace(/\/+$/, "") : publicBase;
    } catch {
      return;
    }

    let parsed: URL;
    try {
      parsed = new URL(url, origin);
    } catch {
      return;
    }
    if (parsed.host !== allowedHost || !parsed.pathname.startsWith(`${basePath}/`)) return;

    const name = parsed.pathname.slice(basePath.length + 1);
    if (!/^\d+-[a-f0-9]{8}\.(?:jpe?g|png|webp|avif)$/i.test(name)) return;

    const mediaDir = this.config.get<string>("MEDIA_DIR") ?? "/var/www/essentialsedm/media";
    try {
      rmSync(join(mediaDir, name), { force: true });
    } catch {
      // An unwritable media directory must not block saving the profile.
    }
  }

  /** Gig calendar: approved upcoming events that the artist has not applied to. */
  async openGigs(user: JwtUser) {
    const profile = await prisma.artistProfile.findUnique({ where: { userId: user.sub } });
    // A cancelled application is not a claim on the event: the DJ may apply again.
    const applied = profile
      ? (
          await prisma.artistBooking.findMany({
            where: { artistId: profile.id, status: { not: "cancelled" } },
            select: { eventId: true },
          })
        ).map((b) => b.eventId)
      : [];
    const events = await prisma.event.findMany({
      where: {
        status: { in: ["approved", "live"] },
        date: { gte: new Date() },
        id: { notIn: applied },
      },
      include: {
        venue: { select: { name: true } },
        slots: {
          orderBy: { startsAt: "asc" },
          select: {
            id: true,
            label: true,
            startsAt: true,
            endsAt: true,
            fee: true,
            bookings: { where: { status: { not: "cancelled" } }, select: { status: true } },
          },
        },
      },
      orderBy: { date: "asc" },
      take: 50,
    });

    // `taken` is what the DJ needs to know to pick a slot, not who holds it.
    return events.map((e) => ({
      ...e,
      slots: e.slots.map((s) => ({
        id: s.id,
        label: s.label,
        startsAt: s.startsAt,
        endsAt: s.endsAt,
        fee: s.fee,
        // A slot with applicants is still open to more: the promoter picks one.
        taken: s.bookings.some((b) => b.status === "confirmed" || b.status === "completed"),
        applicants: s.bookings.length,
      })),
    }));
  }

  /** Upcoming confirmed/pending gigs for the signed-in artist; cancelled applications drop out. */
  async myGigs(user: JwtUser) {
    const profile = await this.requireProfile(user);
    return prisma.artistBooking.findMany({
      where: { artistId: profile.id, status: { not: "cancelled" } },
      include: {
        event: { include: { venue: { select: { name: true, lat: true, lng: true, address: true } } } },
        routeLegs: true,
        // The DJ needs to know whether a completed gig has already been billed.
        invoice: { select: { id: true, number: true, status: true } },
      },
      orderBy: { startAt: "asc" },
    });
  }

  /**
   * The DJ's money view: every gig the promoter has confirmed as played, what it
   * pays, and how much of that has actually been billed to — and paid by — the
   * venue. Only completed gigs count, because they are the only billable ones.
   */
  async earnings(user: JwtUser) {
    const profile = await this.requireProfile(user);
    const bookings = await prisma.artistBooking.findMany({
      where: { artistId: profile.id, status: "completed" },
      include: {
        event: {
          select: { title: true, venue: { select: { name: true, lat: true, lng: true } } },
        },
        invoice: { select: { id: true, number: true, status: true, total: true } },
      },
      orderBy: { startAt: "desc" },
    });

    const gigs = bookings.map((b) => {
      // Before invoicing, show the travel the invoice will add; afterwards the
      // stored amount is the snapshot that was actually billed.
      const travelFee = b.invoice ? b.travelFee : (homeTravel(profile, b.event.venue)?.fee ?? 0);
      return {
        id: b.id,
        eventTitle: b.event.title,
        venue: b.event.venue.name,
        startAt: b.startAt,
        completedAt: b.completedAt,
        fee: b.performanceFee,
        travelFee,
        amount: b.invoice?.total ?? b.performanceFee + travelFee,
        invoice: b.invoice,
      };
    });

    const sum = (values: number[]) => values.reduce((a, b) => a + b, 0);
    const uninvoiced = gigs.filter((g) => !g.invoice);
    const unpaid = gigs.filter((g) => g.invoice && g.invoice.status !== "paid");
    const readyToInvoice = sum(uninvoiced.map((g) => g.amount));
    const awaitingPayment = sum(unpaid.map((g) => g.invoice!.total));

    return {
      gigs,
      totals: {
        /** Agreed fees on every gig confirmed as played. */
        earned: sum(gigs.map((g) => g.fee)),
        /** Billed to venues so far. */
        invoiced: sum(gigs.map((g) => g.invoice?.total ?? 0)),
        /** Collected. */
        paid: sum(gigs.filter((g) => g.invoice?.status === "paid").map((g) => g.invoice!.total)),
        /** Played, not billed yet — the DJ still has to send these. */
        readyToInvoice,
        readyToInvoiceCount: uninvoiced.length,
        /** Billed, not paid yet — the venue still owes it. */
        awaitingPayment,
        awaitingPaymentCount: unpaid.length,
        /** Everything still to come in, whichever side is holding it up. */
        outstanding: readyToInvoice + awaitingPayment,
        gigs: gigs.length,
      },
    };
  }

  /**
   * Promoter's settlement view: per night, the DJ fees agreed, what has been
   * invoiced, what the venues have actually paid, and what is still out.
   */
  async settlements(user: JwtUser) {
    if (user.role !== "promoter" && user.role !== "admin") throw new ForbiddenException("Promoters only");
    const events = await prisma.event.findMany({
      where: user.role === "admin" ? {} : { promoterId: user.sub },
      select: {
        id: true,
        title: true,
        date: true,
        budget: true,
        venue: { select: { name: true } },
        artistBookings: {
          where: { status: { in: ["confirmed", "completed"] } },
          orderBy: { startAt: "asc" },
          select: {
            id: true,
            slot: true,
            startAt: true,
            status: true,
            performanceFee: true,
            completedAt: true,
            artist: { select: { stageName: true } },
            invoice: {
              select: {
                id: true,
                number: true,
                status: true,
                total: true,
                payments: { select: { status: true, amount: true } },
              },
            },
          },
        },
      },
      orderBy: { date: "desc" },
    });

    const sum = (values: number[]) => values.reduce((a, b) => a + b, 0);

    const rows = events.map((e) => {
      const gigs = e.artistBookings.map((b) => {
        const invoice = b.invoice;
        const paid = invoice
          ? invoice.status === "paid"
            ? invoice.total
            : sum(invoice.payments.filter((p) => p.status === "paid").map((p) => p.amount))
          : 0;
        return {
          id: b.id,
          slot: b.slot,
          startAt: b.startAt,
          status: b.status,
          completedAt: b.completedAt,
          fee: b.performanceFee,
          artist: b.artist.stageName,
          invoice: invoice
            ? { id: invoice.id, number: invoice.number, status: invoice.status, total: invoice.total }
            : null,
          paid,
        };
      });
      const committed = sum(gigs.map((g) => g.fee));
      const invoiced = sum(gigs.map((g) => g.invoice?.total ?? 0));
      const paid = sum(gigs.map((g) => g.paid));
      return {
        id: e.id,
        title: e.title,
        date: e.date,
        venue: e.venue.name,
        budget: e.budget,
        committed,
        invoiced,
        paid,
        /** Agreed fees the venues have not paid yet. */
        outstanding: committed - paid,
        overBudget: e.budget > 0 && committed > e.budget,
        gigs,
      };
    });

    return {
      events: rows,
      totals: {
        committed: sum(rows.map((r) => r.committed)),
        invoiced: sum(rows.map((r) => r.invoiced)),
        paid: sum(rows.map((r) => r.paid)),
        outstanding: sum(rows.map((r) => r.outstanding)),
        nights: rows.length,
      },
    };
  }

  /**
   * A DJ's own statements: every confirmed or played gig grouped by the month it
   * happened, with the money agreed, billed and collected in each month.
   */
  async statements(user: JwtUser) {
    if (user.role !== "artist") throw new ForbiddenException("Statements are for DJs");
    const profile = await this.requireProfile(user);
    const bookings = await prisma.artistBooking.findMany({
      where: { artistId: profile.id, status: { in: ["confirmed", "completed"] } },
      select: {
        id: true,
        startAt: true,
        slot: true,
        performanceFee: true,
        travelFee: true,
        event: { select: { title: true, venue: { select: { name: true } } } },
        invoice: {
          select: {
            number: true,
            status: true,
            total: true,
            payments: { select: { status: true, amount: true } },
          },
        },
      },
      orderBy: { startAt: "desc" },
    });

    const sum = (values: number[]) => values.reduce((a, b) => a + b, 0);
    const gigs = bookings.map((b) => {
      const paid = b.invoice
        ? b.invoice.status === "paid"
          ? b.invoice.total
          : sum(b.invoice.payments.filter((p) => p.status === "paid").map((p) => p.amount))
        : 0;
      return {
        id: b.id,
        startAt: b.startAt,
        night: b.event.title,
        venue: b.event.venue.name,
        slot: b.slot,
        fee: b.performanceFee,
        travel: b.travelFee,
        agreed: b.performanceFee + b.travelFee,
        invoiced: b.invoice?.total ?? 0,
        paid,
        invoice: b.invoice ? { number: b.invoice.number, status: b.invoice.status } : null,
      };
    });

    const byMonth = new Map<string, typeof gigs>();
    for (const gig of gigs) {
      const key = gig.startAt.toISOString().slice(0, 7);
      byMonth.set(key, [...(byMonth.get(key) ?? []), gig]);
    }
    const months = [...byMonth.entries()]
      .sort(([a], [b]) => b.localeCompare(a))
      .map(([key, list]) => ({
        key,
        gigs: list,
        gigCount: list.length,
        fee: sum(list.map((g) => g.fee)),
        travel: sum(list.map((g) => g.travel)),
        agreed: sum(list.map((g) => g.agreed)),
        invoiced: sum(list.map((g) => g.invoiced)),
        paid: sum(list.map((g) => g.paid)),
        outstanding: sum(list.map((g) => g.agreed)) - sum(list.map((g) => g.paid)),
      }));

    return {
      profile: { stageName: profile.stageName },
      months,
      totals: {
        fee: sum(gigs.map((g) => g.fee)),
        travel: sum(gigs.map((g) => g.travel)),
        agreed: sum(gigs.map((g) => g.agreed)),
        invoiced: sum(gigs.map((g) => g.invoiced)),
        paid: sum(gigs.map((g) => g.paid)),
        outstanding: sum(gigs.map((g) => g.agreed)) - sum(gigs.map((g) => g.paid)),
        gigs: gigs.length,
        months: months.length,
      },
    };
  }

  /**
   * Promoter view: one statement per DJ across every night they have played at
   * this promoter's events, grouped by month so a month can be handed over.
   */
  async promoterStatements(user: JwtUser) {
    if (user.role !== "promoter" && user.role !== "admin") {
      throw new ForbiddenException("Promoters only");
    }
    const bookings = await prisma.artistBooking.findMany({
      where: {
        status: { in: ["confirmed", "completed"] },
        ...(user.role === "admin" ? {} : { event: { promoterId: user.sub } }),
      },
      select: {
        id: true,
        startAt: true,
        slot: true,
        performanceFee: true,
        travelFee: true,
        artist: { select: { id: true, stageName: true, imageUrl: true } },
        event: { select: { title: true, venue: { select: { name: true } } } },
        invoice: {
          select: {
            number: true,
            status: true,
            total: true,
            payments: { select: { status: true, amount: true } },
          },
        },
      },
      orderBy: { startAt: "desc" },
    });

    const sum = (values: number[]) => values.reduce((a, b) => a + b, 0);
    const byArtist = new Map<
      string,
      { id: string; stageName: string; imageUrl: string | null; gigs: Array<Record<string, unknown>> }
    >();

    for (const b of bookings) {
      const paid = b.invoice
        ? b.invoice.status === "paid"
          ? b.invoice.total
          : sum(b.invoice.payments.filter((p) => p.status === "paid").map((p) => p.amount))
        : 0;
      const entry = byArtist.get(b.artist.id) ?? {
        id: b.artist.id,
        stageName: b.artist.stageName,
        imageUrl: b.artist.imageUrl,
        gigs: [],
      };
      entry.gigs.push({
        id: b.id,
        startAt: b.startAt,
        night: b.event.title,
        venue: b.event.venue.name,
        slot: b.slot,
        fee: b.performanceFee,
        travel: b.travelFee,
        agreed: b.performanceFee + b.travelFee,
        invoiced: b.invoice?.total ?? 0,
        paid,
        invoice: b.invoice ? { number: b.invoice.number, status: b.invoice.status } : null,
      });
      byArtist.set(b.artist.id, entry);
    }

    const djs = [...byArtist.values()]
      .map((entry) => {
        const gigs = entry.gigs as Array<{ startAt: Date; fee: number; travel: number; agreed: number; invoiced: number; paid: number }>;
        const months = new Map<string, typeof gigs>();
        for (const gig of gigs) {
          const key = gig.startAt.toISOString().slice(0, 7);
          months.set(key, [...(months.get(key) ?? []), gig]);
        }
        const monthRows = [...months.entries()]
          .sort(([a], [b]) => b.localeCompare(a))
          .map(([key, list]) => ({
            key,
            gigCount: list.length,
            agreed: sum(list.map((g) => g.agreed)),
            invoiced: sum(list.map((g) => g.invoiced)),
            paid: sum(list.map((g) => g.paid)),
            outstanding: sum(list.map((g) => g.agreed)) - sum(list.map((g) => g.paid)),
          }));
        return {
          id: entry.id,
          stageName: entry.stageName,
          imageUrl: entry.imageUrl,
          gigs,
          months: monthRows,
          agreed: sum(gigs.map((g) => g.agreed)),
          invoiced: sum(gigs.map((g) => g.invoiced)),
          paid: sum(gigs.map((g) => g.paid)),
          outstanding: sum(gigs.map((g) => g.agreed)) - sum(gigs.map((g) => g.paid)),
        };
      })
      .sort((a, b) => a.stageName.localeCompare(b.stageName));

    return {
      djs,
      totals: {
        djs: djs.length,
        gigs: sum(djs.map((d) => d.gigs.length)),
        agreed: sum(djs.map((d) => d.agreed)),
        invoiced: sum(djs.map((d) => d.invoiced)),
        paid: sum(djs.map((d) => d.paid)),
        outstanding: sum(djs.map((d) => d.outstanding)),
      },
    };
  }

  /**
   * One month of DJ money as a CSV: a DJ's own gigs, or — for a promoter or an
   * admin — every gig at their nights. Statements used to be assembled by hand
   * from the settlements screen every time a venue asked for the month.
   */
  async statementCsv(user: JwtUser, month: string | undefined, res: Response, artistId?: string) {
    const range = month ? statementMonth(month) : statementMonth(new Date().toISOString().slice(0, 7));
    if (!range) throw new BadRequestException("month must be YYYY-MM");

    const esc = (v: unknown) => `"${String(v ?? "").replace(/"/g, '""')}"`;
    type Row = {
      artistId: string; date: Date; night: string; venue: string; dj: string; slot: string;
      fee: number; travel: number; invoiceNumber: string; invoiceStatus: string; invoiced: number; paid: number;
    };
    if (artistId) {
      if (user.role === "artist") {
        throw new ForbiddenException("A DJ can only download their own statement");
      }
      if (user.role === "promoter") {
        const onNights = await prisma.artistBooking.findFirst({
          where: { artistId, event: { promoterId: user.sub } },
          select: { id: true },
        });
        if (!onNights) throw new ForbiddenException("That DJ has no gigs at your nights");
      }
    }

    let rows: Row[];

    if (user.role === "artist") {
      const profile = await prisma.artistProfile.findUnique({ where: { userId: user.sub } });
      if (!profile) throw new BadRequestException("Create your artist profile first");
      const bookings = await prisma.artistBooking.findMany({
        where: {
          artistId: profile.id,
          status: { in: ["confirmed", "completed"] },
          startAt: { gte: range.start, lt: range.end },
        },
        include: {
          event: { select: { title: true, venue: { select: { name: true } } } },
          invoice: { select: { number: true, status: true, total: true } },
        },
        orderBy: { startAt: "asc" },
      });
      rows = bookings.map((b) => ({
        artistId: profile.id,
        date: b.startAt,
        night: b.event.title,
        venue: b.event.venue.name,
        dj: profile.stageName,
        slot: b.slot ?? "",
        fee: b.performanceFee,
        travel: b.travelFee,
        invoiceNumber: b.invoice?.number ?? "",
        invoiceStatus: b.invoice?.status ?? "not invoiced",
        invoiced: b.invoice?.total ?? 0,
        paid: b.invoice?.status === "paid" ? b.invoice.total : 0,
      }));
    } else if (user.role === "promoter" || user.role === "admin") {
      const events = await prisma.event.findMany({
        where: {
          date: { gte: range.start, lt: range.end },
          ...(user.role === "admin" ? {} : { promoterId: user.sub }),
        },
        select: {
          title: true,
          date: true,
          venue: { select: { name: true } },
          artistBookings: {
            where: { status: { in: ["confirmed", "completed"] } },
            select: {
              artistId: true,
              slot: true,
              startAt: true,
              performanceFee: true,
              travelFee: true,
              artist: { select: { stageName: true } },
              invoice: { select: { number: true, status: true, total: true } },
            },
            orderBy: { startAt: "asc" },
          },
        },
        orderBy: { date: "asc" },
      });
      rows = events.flatMap((e) =>
        e.artistBookings.map((b) => ({
          artistId: b.artistId,
          date: b.startAt,
          night: e.title,
          venue: e.venue.name,
          dj: b.artist.stageName,
          slot: b.slot ?? "",
          fee: b.performanceFee,
          travel: b.travelFee,
          invoiceNumber: b.invoice?.number ?? "",
          invoiceStatus: b.invoice?.status ?? "not invoiced",
          invoiced: b.invoice?.total ?? 0,
          paid: b.invoice?.status === "paid" ? b.invoice.total : 0,
        })),
      );
    } else {
      throw new ForbiddenException("Statements are for DJs, promoters and admins");
    }

    if (artistId) rows = rows.filter((row) => row.artistId === artistId);

    const sum = (values: number[]) => values.reduce((a, b) => a + b, 0);
    const lines = [
      "date,night,venue,dj,slot,fee,travel,invoice_number,invoice_status,invoiced,paid",
      ...rows.map((r) =>
        [
          r.date.toISOString().slice(0, 10),
          esc(r.night),
          esc(r.venue),
          esc(r.dj),
          esc(r.slot),
          r.fee,
          r.travel,
          esc(r.invoiceNumber),
          esc(r.invoiceStatus),
          r.invoiced,
          r.paid,
        ].join(","),
      ),
      ["TOTAL", "", "", "", "", sum(rows.map((r) => r.fee)), sum(rows.map((r) => r.travel)), "", "", sum(rows.map((r) => r.invoiced)), sum(rows.map((r) => r.paid))].join(","),
    ];

    const djSlug = artistId
      ? (rows[0]?.dj ?? artistId)
          .toLowerCase()
          .replace(/[^a-z0-9]+/g, "-")
          .replace(/^-|-$/g, "")
      : "";
    res.setHeader("Content-Type", "text/csv; charset=utf-8");
    res.setHeader(
      "Content-Disposition",
      `attachment; filename="statement-${djSlug ? `${djSlug}-` : ""}${range.key}.csv"`,
    );
    res.send(lines.join("\n"));
  }

  /** The DJ's confirmed and played gigs as an .ics file any calendar app can read. */
  async gigsIcs(user: JwtUser) {
    const profile = await this.requireProfile(user);
    const bookings = await prisma.artistBooking.findMany({
      where: { artistId: profile.id, status: { in: ["confirmed", "completed"] } },
      include: { event: { include: { venue: { select: { name: true, address: true } } } } },
      orderBy: { startAt: "asc" },
    });
    return icsCalendar(
      bookings.map((b) => ({
        uid: b.id,
        start: b.startAt,
        end: b.endAt,
        summary: `${b.event.title} — ${profile.stageName}`,
        location: b.event.venue.address ? `${b.event.venue.name}, ${b.event.venue.address}` : b.event.venue.name,
        description: `${b.slot ?? "set"} · fee R${b.performanceFee.toLocaleString()} · ${b.status}`,
      })),
    );
  }

  /** Dates the DJ has blocked out from today onwards. */
  async blackouts(user: JwtUser) {
    const profile = await this.requireProfile(user);
    return prisma.artistBlackout.findMany({
      where: { artistId: profile.id, date: { gte: startOfDay(new Date()) } },
      orderBy: { date: "asc" },
    });
  }

  /** Block a day. Adding the same day again just replaces the reason. */
  async addBlackout(user: JwtUser, date: string, reason?: string) {
    const profile = await this.requireProfile(user);
    const day = startOfDay(date);
    if (Number.isNaN(day.getTime())) throw new BadRequestException("Pick a valid date");
    const clean = reason?.trim().slice(0, 200) || null;
    return prisma.artistBlackout.upsert({
      where: { artistId_date: { artistId: profile.id, date: day } },
      create: { artistId: profile.id, date: day, reason: clean },
      update: { reason: clean },
    });
  }

  async removeBlackout(user: JwtUser, id: string) {
    const profile = await this.requireProfile(user);
    const removed = await prisma.artistBlackout.deleteMany({ where: { id, artistId: profile.id } });
    if (!removed.count) throw new NotFoundException("Blackout not found");
    return { ok: true, id };
  }

  /** Multi-gig routing for one calendar day: legs, buffers, collision alerts, fuel + billable travel. */
  async planDay(user: JwtUser, date: string) {
    const profile = await this.requireProfile(user);
    const gigs = await this.dayGigs(profile.id, startOfDay(date));
    return this.buildPlan(profile, gigs);
  }

  /** Persist a planned day's legs (BookingRouteLeg), replacing the existing ones. */
  async savePlan(user: JwtUser, date: string) {
    const profile = await this.requireProfile(user);
    const gigs = await this.dayGigs(profile.id, startOfDay(date));
    return this.persistPlan(gigs, profile);
  }

  /**
   * A venue's coordinates changed: rebuild every persisted leg that depends on
   * them, so saved plans stop quoting distances to where the venue used to be.
   * A leg never spans midnight, so re-planning each affected (artist, day) is
   * enough — including the artist's other gigs that day.
   */
  async recomputeForVenue(venueId: string) {
    const bookings = await prisma.artistBooking.findMany({
      where: { event: { venueId } },
      select: { artistId: true, startAt: true },
    });

    const days = new Set<string>();
    for (const booking of bookings) {
      days.add(`${booking.artistId}|${startOfDay(booking.startAt).toISOString()}`);
    }

    let legs = 0;
    for (const key of days) {
      const [artistId, iso] = key.split("|");
      const profile = await prisma.artistProfile.findUnique({ where: { id: artistId } });
      if (!profile) continue;
      const gigs = await this.dayGigs(artistId, new Date(iso));
      const plan = await this.persistPlan(gigs, profile);
      legs += plan.legs.length;
    }

    return { days: days.size, legs };
  }

  async updateBooking(user: JwtUser, bookingId: string, data: { status?: ArtistBookingStatus }) {
    const profile = await this.requireProfile(user);
    const booking = await prisma.artistBooking.findUnique({ where: { id: bookingId } });
    if (!booking) throw new NotFoundException("Booking not found");
    if (booking.artistId !== profile.id && user.role !== "admin") throw new ForbiddenException();
    // A DJ can pull out, but cannot confirm or complete their own gig: completion
    // is the promoter's second confirmation, and it is what unlocks invoicing.
    if (user.role !== "admin" && data.status !== "cancelled") {
      throw new ForbiddenException("The promoter confirms gigs and marks them complete");
    }
    return prisma.artistBooking.update({ where: { id: bookingId }, data });
  }

  private async dayGigs(artistId: string, dayStart: Date): Promise<GigWindow[]> {
    const dayEnd = new Date(dayStart.getTime() + 86_400_000);
    return prisma.artistBooking.findMany({
      where: { artistId, startAt: { gte: dayStart, lt: dayEnd } },
      include: { event: { include: { venue: { select: { lat: true, lng: true } } } } },
      orderBy: { startAt: "asc" },
    });
  }

  private buildPlan(profile: TravelProfile, gigs: GigWindow[]): DayPlan {
    if (!gigs.length) {
      return { legs: [], totals: { distanceKm: 0, fuelCost: 0, travelFee: 0 }, conflicts: 0 };
    }

    const legs: RouteLeg[] = [];
    let prev = gigs[0];
    for (let i = 1; i < gigs.length; i++) {
      const next = gigs[i];
      const km = haversineKm(prev.event.venue, next.event.venue);
      const driveMinutes = Math.ceil((km / AVG_SPEED_KMH) * 60);
      const teardown = prev.teardownBufferMin;
      const setup = next.setupBufferMin;
      const bufferNeeded = prev.endAt.getTime() + teardown * 60_000 + driveMinutes * 60_000;
      const isConflict = bufferNeeded > next.startAt.getTime() - setup * 60_000;

      legs.push({
        fromBookingId: prev.id,
        toBookingId: next.id,
        distanceKm: km,
        durationMinutes: driveMinutes,
        estimatedFuelCost: +((km / 100) * profile.vehicleConsumptionLPer100km * this.fuelPrice()).toFixed(2),
        isConflict,
        conflictReason: isConflict
          ? `Only ${Math.round((next.startAt.getTime() - prev.endAt.getTime()) / 60000)} min between gigs; need ${teardown} teardown + ${driveMinutes} drive + ${setup} setup.`
          : undefined,
        mapsUrl: `https://www.google.com/maps/dir/?api=1&origin=${prev.event.venue.lat},${prev.event.venue.lng}&destination=${next.event.venue.lat},${next.event.venue.lng}`,
      });
      prev = next;
    }

    const distanceKm = +legs.reduce((s, l) => s + l.distanceKm, 0).toFixed(1);
    return {
      legs,
      totals: {
        distanceKm,
        fuelCost: +((distanceKm / 100) * profile.vehicleConsumptionLPer100km * this.fuelPrice()).toFixed(2),
        travelFee: Math.round(distanceKm * profile.travelRatePerKm),
      },
      conflicts: legs.filter((l) => l.isConflict).length,
    };
  }

  /** Replace the day's stored legs with a freshly computed plan. */
  private async persistPlan(gigs: GigWindow[], profile: TravelProfile): Promise<DayPlan> {
    const plan = this.buildPlan(profile, gigs);
    const bookingIds = gigs.map((g) => g.id);

    if (bookingIds.length) {
      await prisma.bookingRouteLeg.deleteMany({ where: { bookingId: { in: bookingIds } } });
    }

    for (const leg of plan.legs) {
      if (!leg.toBookingId) continue;
      await prisma.bookingRouteLeg.create({
        data: {
          bookingId: leg.fromBookingId,
          distanceKm: leg.distanceKm,
          durationMinutes: leg.durationMinutes,
          estimatedFuelCost: leg.estimatedFuelCost,
          isConflict: leg.isConflict,
        },
      });
    }

    return plan;
  }

  private async requireProfile(user: JwtUser) {
    const profile = await prisma.artistProfile.findUnique({ where: { userId: user.sub } });
    if (!profile) throw new BadRequestException("Create your artist profile first");
    return profile;
  }
}
