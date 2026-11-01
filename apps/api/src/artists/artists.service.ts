import { Injectable, NotFoundException, ForbiddenException, BadRequestException } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { prisma, ArtistBookingStatus } from "@essentials/db";
import type { JwtUser } from "../common/roles.guard";

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

  async upsertProfile(user: JwtUser, data: { stageName: string; vehicleConsumptionLPer100km?: number; travelRatePerKm?: number }) {
    const existing = await prisma.artistProfile.findUnique({ where: { userId: user.sub } });
    if (existing) {
      return prisma.artistProfile.update({ where: { userId: user.sub }, data });
    }
    return prisma.artistProfile.create({ data: { userId: user.sub, ...data } });
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
    const dayStart = new Date(date);
    dayStart.setHours(0, 0, 0, 0);
    const dayEnd = new Date(dayStart.getTime() + 86_400_000);

    const gigs = await prisma.artistBooking.findMany({
      where: { artistId: profile.id, startAt: { gte: dayStart, lt: dayEnd } },
      include: { event: { include: { venue: true } } },
      orderBy: { startAt: "asc" },
    });
    if (!gigs.length) return { legs: [], totals: { distanceKm: 0, fuelCost: 0, travelFee: 0 }, conflicts: 0 };

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

  /** Persist a planned day's legs (BookingRouteLeg), replacing existing ones for the first booking. */
  async savePlan(user: JwtUser, date: string) {
    const profile = await this.requireProfile(user);
    const plan = await this.planDay(user, date);
    for (const leg of plan.legs) {
      await prisma.bookingRouteLeg.deleteMany({ where: { bookingId: leg.fromBookingId } });
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
    void profile;
    return plan;
  }

  async updateBooking(user: JwtUser, bookingId: string, data: { status?: ArtistBookingStatus }) {
    const profile = await this.requireProfile(user);
    const booking = await prisma.artistBooking.findUnique({ where: { id: bookingId } });
    if (!booking) throw new NotFoundException("Booking not found");
    if (booking.artistId !== profile.id && user.role !== "admin") throw new ForbiddenException();
    return prisma.artistBooking.update({ where: { id: bookingId }, data });
  }

  private async requireProfile(user: JwtUser) {
    const profile = await prisma.artistProfile.findUnique({ where: { userId: user.sub } });
    if (!profile) throw new BadRequestException("Create your artist profile first");
    return profile;
  }
}
