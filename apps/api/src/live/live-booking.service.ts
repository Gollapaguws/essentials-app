import { BadRequestException, Injectable, NotFoundException } from "@nestjs/common";
import { prisma } from "@essentials/db";
import type { JwtUser } from "../common/roles.guard";

/** A booked live session may not run longer than this. */
const MAX_SESSION_MS = 12 * 60 * 60 * 1000;

export interface CreateLiveBookingInput {
  startsAt: string;
  endsAt: string;
  title?: string;
}

/**
 * The DJ's live booking calendar.
 *
 * A booking is the permission to broadcast: the ingest WebSocket refuses a DJ
 * unless one of their sessions covers the moment they go live. Promoters and
 * venue managers are not involved — a DJ books their own stream window.
 */
@Injectable()
export class LiveBookingService {
  private async profile(user: JwtUser) {
    const profile = await prisma.artistProfile.findUnique({ where: { userId: user.sub } });
    if (!profile) throw new BadRequestException("Create your artist profile first");
    return profile;
  }

  /** The DJ's own sessions that have not ended yet, soonest first. */
  async list(user: JwtUser) {
    // An admin has no DJ profile and does not need a booking to broadcast.
    if (user.role === "admin") return [];
    const profile = await this.profile(user);
    return prisma.liveBooking.findMany({
      where: { artistId: profile.id, cancelledAt: null, endsAt: { gt: new Date() } },
      orderBy: { startsAt: "asc" },
      take: 100,
    });
  }

  /** What the Go Live page needs: whether a booking is required, and the one covering now. */
  async active(user: JwtUser) {
    if (user.role === "admin") return { required: false as const, booking: null };
    const profile = await this.profile(user);
    const now = new Date();
    const booking = await prisma.liveBooking.findFirst({
      where: { artistId: profile.id, cancelledAt: null, startsAt: { lte: now }, endsAt: { gt: now } },
      orderBy: { startsAt: "asc" },
    });
    return { required: true as const, booking };
  }

  async create(user: JwtUser, input: CreateLiveBookingInput) {
    const profile = await this.profile(user);
    const startsAt = new Date(input.startsAt);
    const endsAt = new Date(input.endsAt);
    if (Number.isNaN(startsAt.getTime()) || Number.isNaN(endsAt.getTime())) {
      throw new BadRequestException("Pick a valid start and end time");
    }
    if (endsAt <= startsAt) throw new BadRequestException("The session has to end after it starts");
    if (endsAt.getTime() <= Date.now()) throw new BadRequestException("That session is already in the past");
    if (endsAt.getTime() - startsAt.getTime() > MAX_SESSION_MS) {
      throw new BadRequestException("A session can be at most 12 hours");
    }

    const overlap = await prisma.liveBooking.findFirst({
      where: {
        artistId: profile.id,
        cancelledAt: null,
        startsAt: { lt: endsAt },
        endsAt: { gt: startsAt },
      },
      select: { startsAt: true, endsAt: true },
    });
    if (overlap) throw new BadRequestException("That overlaps a session you already booked");

    return prisma.liveBooking.create({
      data: {
        artistId: profile.id,
        startsAt,
        endsAt,
        title: input.title?.trim().slice(0, 80) || null,
      },
    });
  }

  async cancel(user: JwtUser, id: string) {
    const profile = await this.profile(user);
    const cancelled = await prisma.liveBooking.updateMany({
      where: { id, artistId: profile.id, cancelledAt: null },
      data: { cancelledAt: new Date() },
    });
    if (!cancelled.count) throw new NotFoundException("Booking not found");
    return { ok: true, id };
  }

  /** Ingest gate: does this account have a session covering `at`? */
  async hasActiveSession(userId: string, at = new Date()): Promise<boolean> {
    const profile = await prisma.artistProfile.findUnique({
      where: { userId },
      select: { id: true },
    });
    if (!profile) return false;
    const hit = await prisma.liveBooking.findFirst({
      where: {
        artistId: profile.id,
        cancelledAt: null,
        startsAt: { lte: at },
        endsAt: { gt: at },
      },
      select: { id: true },
    });
    return Boolean(hit);
  }
}
