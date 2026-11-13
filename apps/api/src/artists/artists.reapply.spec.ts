import { ConfigService } from "@nestjs/config";
import { prisma } from "@essentials/db";
import { ArtistsService } from "./artists.service";
import type { JwtUser } from "../common/roles.guard";

jest.mock("@essentials/db", () => ({
  ArtistBookingStatus: {
    confirmed: "confirmed",
    pending: "pending",
    cancelled: "cancelled",
    completed: "completed",
  },
  prisma: {
    artistProfile: { findUnique: jest.fn() },
    artistBooking: { findMany: jest.fn() },
    event: { findMany: jest.fn() },
  },
}));

const db = prisma as unknown as {
  artistProfile: { findUnique: jest.Mock };
  artistBooking: { findMany: jest.Mock };
  event: { findMany: jest.Mock };
};

const artist: JwtUser = { sub: "artist-user-1", email: "dj@example.com", role: "artist" };
const service = () => new ArtistsService({ get: () => undefined } as unknown as ConfigService);

beforeEach(() => {
  db.artistProfile.findUnique.mockReset().mockResolvedValue({ id: "artist-1" });
  db.artistBooking.findMany.mockReset().mockResolvedValue([]);
  db.event.findMany.mockReset().mockResolvedValue([]);
});

describe("ArtistsService reapply after a decline", () => {
  it("only treats non-cancelled bookings as a claim on an event", async () => {
    db.artistBooking.findMany.mockResolvedValue([{ eventId: "event-still-active" }]);

    await service().openGigs(artist);

    expect(db.artistBooking.findMany).toHaveBeenCalledWith({
      where: { artistId: "artist-1", status: { not: "cancelled" } },
      select: { eventId: true },
    });
    expect(db.event.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ id: { notIn: ["event-still-active"] } }),
      }),
    );
  });

  it("drops a cancelled or declined application from the DJ's application list", async () => {
    await service().myGigs(artist);

    expect(db.artistBooking.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { artistId: "artist-1", status: { not: "cancelled" } },
      }),
    );
  });
});
