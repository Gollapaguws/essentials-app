import { NotFoundException } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { prisma } from "@essentials/db";
import { ArtistsService } from "./artists.service";

jest.mock("@essentials/db", () => ({
  prisma: { artistProfile: { findUnique: jest.fn() } },
  ArtistBookingStatus: { confirmed: "confirmed", pending: "pending", cancelled: "cancelled" },
}));

const profiles = (prisma as unknown as { artistProfile: { findUnique: jest.Mock } }).artistProfile;

function service() {
  return new ArtistsService({ get: () => undefined } as unknown as ConfigService);
}

function booking(over: Record<string, unknown>) {
  return {
    id: "booking-1",
    slot: "late-night",
    status: "confirmed",
    startAt: new Date("2026-12-31T22:00:00.000Z"),
    endAt: new Date("2027-01-01T02:00:00.000Z"),
    appliedAt: new Date("2026-11-01T09:00:00.000Z"),
    setupBufferMin: 60,
    teardownBufferMin: 45,
    performanceFee: 3500,
    travelFee: 250,
    eventId: "event-1",
    artistId: "artist-1",
    event: {
      id: "event-1",
      title: "Deep End",
      date: new Date("2026-12-31T22:00:00.000Z"),
      status: "approved",
      venue: { name: "The Vault" },
    },
    ...over,
  };
}

beforeEach(() => profiles.findUnique.mockReset());

describe("ArtistsService.artistDetail", () => {
  it("returns the profile and every booking, counting only confirmed gigs", async () => {
    profiles.findUnique.mockResolvedValue({
      id: "artist-1",
      stageName: "Nandi",
      bio: "Deep house, no requests.",
      imageUrl: "https://api.example.com/media/nandi.jpg",
      travelRatePerKm: 8,
      vehicleConsumptionLPer100km: 7.5,
      user: { name: "Nandi M", email: "nandi@example.com" },
      bookings: [
        booking({}),
        booking({ id: "booking-2", status: "pending", slot: "evening" }),
        booking({ id: "booking-3", status: "cancelled", slot: "day" }),
      ],
    });

    const artist = await service().artistDetail("artist-1");

    expect(artist).toMatchObject({ stageName: "Nandi", travelRatePerKm: 8, confirmedGigs: 1 });
    expect(artist.bookings.map((b) => b.status)).toEqual(["confirmed", "pending", "cancelled"]);
    expect(artist.bookings[0]).toMatchObject({
      performanceFee: 3500,
      travelFee: 250,
      event: { title: "Deep End", venue: { name: "The Vault" } },
    });
    expect("user" in artist).toBe(true);
  });

  it("throws when the DJ does not exist", async () => {
    profiles.findUnique.mockResolvedValue(null);

    await expect(service().artistDetail("nope")).rejects.toBeInstanceOf(NotFoundException);
  });
});
