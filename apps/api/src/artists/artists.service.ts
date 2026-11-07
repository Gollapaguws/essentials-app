import { Injectable, NotFoundException, ForbiddenException, BadRequestException } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { prisma, ArtistBookingStatus } from "@essentials/db";
import { rmSync } from "fs";
import { join } from "path";
import { storeImage } from "../common/media-storage";
import type { JwtUser } from "../common/roles.guard";

export { MAX_PROFILE_IMAGE_BYTES, PROFILE_IMAGE_EXTENSIONS } from "../common/media-storage";

/** Haversine distance in km. */
function haversineKm(a: { lat: number; lng: number }, b: { lat: number; lng: number }) {
  const R = 6371, toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat), dLng = toRad(b.lng - a.lng);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return +(2 * R * Math.asin(Math.sqrt(h))).toFixed(1);
}

/** Average city speed used for drive-time estimates (km/h) when no Maps key is configured. */
const AVG_SPEED_KMH = 45;

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

    const { bookings, ...artist } = profile;
    return {
      ...artist,
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

  async upsertProfile(user: JwtUser, data: { stageName: string; bio?: string; imageUrl?: string; vehicleConsumptionLPer100km?: number; travelRatePerKm?: number }, origin: string) {
    // An empty text field is a clear, not a missing one: store null so the UI hides it.
    const patch = {
      ...data,
      ...(data.bio !== undefined ? { bio: data.bio.trim() || null } : {}),
      ...(data.imageUrl !== undefined ? { imageUrl: data.imageUrl.trim() || null } : {}),
    };
    const existing = await prisma.artistProfile.findUnique({ where: { userId: user.sub } });
    if (existing) {
      const updated = await prisma.artistProfile.update({ where: { userId: user.sub }, data: patch });
      // The old photo is unreferenced once the profile points at a replacement (or none).
      if (data.imageUrl !== undefined && existing.imageUrl !== updated.imageUrl) {
        this.deleteStoredImage(existing.imageUrl, origin);
      }
      return updated;
    }
    return prisma.artistProfile.create({ data: { userId: user.sub, ...patch } });
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
    const applied = profile
      ? (await prisma.artistBooking.findMany({ where: { artistId: profile.id }, select: { eventId: true } })).map((b) => b.eventId)
      : [];
    return prisma.event.findMany({
      where: {
        status: { in: ["approved", "live"] },
        date: { gte: new Date() },
        id: { notIn: applied },
      },
      include: { venue: { select: { name: true } } },
      orderBy: { date: "asc" },
      take: 50,
    });
  }

  /** Upcoming confirmed/pending gigs for the signed-in artist. */
  async myGigs(user: JwtUser) {
    const profile = await this.requireProfile(user);
    return prisma.artistBooking.findMany({
      where: { artistId: profile.id },
      include: {
        event: { include: { venue: { select: { name: true, lat: true, lng: true, address: true } } } },
        routeLegs: true,
      },
      orderBy: { startAt: "asc" },
    });
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
