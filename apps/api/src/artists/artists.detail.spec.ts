import { NotFoundException } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { prisma } from "@essentials/db";
import { ArtistsService } from "./artists.service";
import type { JwtUser } from "../common/roles.guard";

jest.mock("@essentials/db", () => ({
  prisma: {
    artistProfile: { findUnique: jest.fn() },
    artistNote: { findUnique: jest.fn(), upsert: jest.fn(), deleteMany: jest.fn() },
  },
  ArtistBookingStatus: { confirmed: "confirmed", pending: "pending", cancelled: "cancelled" },
}));

type Mock = { findUnique: jest.Mock; upsert: jest.Mock; deleteMany: jest.Mock };
const profiles = (prisma as unknown as { artistProfile: { findUnique: jest.Mock } }).artistProfile;
const notes = (prisma as unknown as { artistNote: Mock }).artistNote;

const promoter: JwtUser = { sub: "promoter-1", email: "promoter@example.com", role: "promoter" };

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

beforeEach(() => {
  profiles.findUnique.mockReset();
  notes.findUnique.mockReset();
  notes.upsert.mockReset();
  notes.deleteMany.mockReset();
});

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
    notes.findUnique.mockResolvedValue(null);

    const artist = await service().artistDetail(promoter, "artist-1");

    expect(artist).toMatchObject({ stageName: "Nandi", travelRatePerKm: 8, confirmedGigs: 1 });
    expect(artist.bookings.map((b) => b.status)).toEqual(["confirmed", "pending", "cancelled"]);
    expect(artist.bookings[0]).toMatchObject({
      performanceFee: 3500,
      travelFee: 250,
      event: { title: "Deep End", venue: { name: "The Vault" } },
    });
    expect("user" in artist).toBe(true);
    expect(artist.note).toBeNull();
  });

  it("threads the promoter's own note into the profile", async () => {
    profiles.findUnique.mockResolvedValue({
      id: "artist-1",
      stageName: "Nandi",
      user: { name: null, email: "nandi@example.com" },
      bookings: [],
    });
    const note = { id: "note-1", artistId: "artist-1", promoterId: "promoter-1", body: "Late twice.", updatedAt: new Date() };
    notes.findUnique.mockResolvedValue(note);

    const artist = await service().artistDetail(promoter, "artist-1");

    expect(artist.note).toEqual(note);
    // Scoped to the caller: another promoter's note can never leak through here.
    expect(notes.findUnique).toHaveBeenCalledWith({
      where: { promoterId_artistId: { promoterId: "promoter-1", artistId: "artist-1" } },
    });
  });

  it("throws when the DJ does not exist", async () => {
    profiles.findUnique.mockResolvedValue(null);

    await expect(service().artistDetail(promoter, "nope")).rejects.toBeInstanceOf(NotFoundException);
  });
});

describe("ArtistsService.saveArtistNote", () => {
  it("trims and upserts this promoter's note, creating one row per pair", async () => {
    profiles.findUnique.mockResolvedValue({ id: "artist-1" });
    notes.upsert.mockImplementation(({ create }) => Promise.resolve({ id: "note-1", ...create }));

    await service().saveArtistNote(promoter, "artist-1", "  Great set, late load-in.  ");

    expect(notes.upsert).toHaveBeenCalledWith({
      where: { promoterId_artistId: { promoterId: "promoter-1", artistId: "artist-1" } },
      create: { promoterId: "promoter-1", artistId: "artist-1", body: "Great set, late load-in." },
      update: { body: "Great set, late load-in." },
    });
  });

  it("clears the note when the body is only whitespace", async () => {
    profiles.findUnique.mockResolvedValue({ id: "artist-1" });
    notes.deleteMany.mockResolvedValue({ count: 1 });

    const result = await service().saveArtistNote(promoter, "artist-1", "   \n ");

    expect(result).toBeNull();
    expect(notes.upsert).not.toHaveBeenCalled();
    expect(notes.deleteMany).toHaveBeenCalledWith({ where: { promoterId: "promoter-1", artistId: "artist-1" } });
  });

  it("refuses to note a DJ that does not exist", async () => {
    profiles.findUnique.mockResolvedValue(null);

    await expect(service().saveArtistNote(promoter, "nope", "x")).rejects.toBeInstanceOf(NotFoundException);
    expect(notes.upsert).not.toHaveBeenCalled();
  });
});
