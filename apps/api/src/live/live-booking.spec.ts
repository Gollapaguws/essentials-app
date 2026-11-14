import { BadRequestException, NotFoundException } from "@nestjs/common";
import { prisma } from "@essentials/db";
import { LiveBookingService } from "./live-booking.service";
import type { JwtUser } from "../common/roles.guard";

jest.mock("@essentials/db", () => ({
  prisma: {
    artistProfile: { findUnique: jest.fn() },
    liveBooking: {
      findMany: jest.fn(),
      findFirst: jest.fn(),
      create: jest.fn(),
      updateMany: jest.fn(),
    },
  },
}));

const db = prisma as unknown as {
  artistProfile: { findUnique: jest.Mock };
  liveBooking: {
    findMany: jest.Mock;
    findFirst: jest.Mock;
    create: jest.Mock;
    updateMany: jest.Mock;
  };
};

const artist: JwtUser = { sub: "artist-user-1", email: "dj@example.com", role: "artist" };
const admin: JwtUser = { sub: "admin-user-1", email: "admin@example.com", role: "admin" };
const service = () => new LiveBookingService();

const inOneHour = () => new Date(Date.now() + 60 * 60 * 1000);
const inThreeHours = () => new Date(Date.now() + 3 * 60 * 60 * 1000);

beforeEach(() => {
  db.artistProfile.findUnique.mockReset().mockResolvedValue({ id: "artist-1", stageName: "Nova" });
  db.liveBooking.findMany.mockReset().mockResolvedValue([]);
  db.liveBooking.findFirst.mockReset().mockResolvedValue(null);
  db.liveBooking.create.mockReset().mockImplementation(({ data }) => ({ id: "booking-1", ...data }));
  db.liveBooking.updateMany.mockReset().mockResolvedValue({ count: 1 });
});

describe("LiveBookingService", () => {
  it("books a session and trims the title", async () => {
    await service().create(artist, {
      startsAt: inOneHour().toISOString(),
      endsAt: inThreeHours().toISOString(),
      title: "  Friday warm-up  ",
    });

    const data = db.liveBooking.create.mock.calls[0][0].data;
    expect(data.artistId).toBe("artist-1");
    expect(data.title).toBe("Friday warm-up");
  });

  it("refuses a session that overlaps one already booked", async () => {
    db.liveBooking.findFirst.mockResolvedValue({ startsAt: inOneHour(), endsAt: inThreeHours() });

    await expect(
      service().create(artist, {
        startsAt: inOneHour().toISOString(),
        endsAt: inThreeHours().toISOString(),
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(db.liveBooking.create).not.toHaveBeenCalled();
  });

  it("refuses a session that ends before it starts", async () => {
    await expect(
      service().create(artist, {
        startsAt: inThreeHours().toISOString(),
        endsAt: inOneHour().toISOString(),
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it("exempts admins from the booking gate", async () => {
    await expect(service().active(admin)).resolves.toEqual({ required: false, booking: null });
    expect(db.artistProfile.findUnique).not.toHaveBeenCalled();
  });

  it("only lets the owner cancel a session", async () => {
    db.liveBooking.updateMany.mockResolvedValue({ count: 0 });

    await expect(service().cancel(artist, "booking-9")).rejects.toBeInstanceOf(NotFoundException);
    expect(db.liveBooking.updateMany.mock.calls[0][0].where).toMatchObject({
      id: "booking-9",
      artistId: "artist-1",
    });
  });

  it("allows the ingest only inside a session covering now", async () => {
    db.liveBooking.findFirst.mockResolvedValue({ id: "booking-1" });

    await expect(service().hasActiveSession("artist-user-1")).resolves.toBe(true);
    const where = db.liveBooking.findFirst.mock.calls[0][0].where;
    expect(where.artistId).toBe("artist-1");
    expect(where.cancelledAt).toBeNull();
    expect(where.startsAt.lte).toBeInstanceOf(Date);
    expect(where.endsAt.gt).toBeInstanceOf(Date);
  });

  it("blocks the ingest when the account has no DJ profile", async () => {
    db.artistProfile.findUnique.mockResolvedValue(null);

    await expect(service().hasActiveSession("artist-user-1")).resolves.toBe(false);
    expect(db.liveBooking.findFirst).not.toHaveBeenCalled();
  });
});
