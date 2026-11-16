import { NotFoundException } from "@nestjs/common";
import { prisma } from "@essentials/db";
import { PublicDjsService } from "./public-djs.service";

jest.mock("@essentials/db", () => ({
  prisma: {
    artistProfile: { findMany: jest.fn(), findUnique: jest.fn() },
    artistBooking: { findMany: jest.fn() },
  },
  EventStatus: { approved: "approved", live: "live", draft: "draft" },
  ArtistBookingStatus: { confirmed: "confirmed", pending: "pending" },
}));

const db = prisma as unknown as {
  artistProfile: { findMany: jest.Mock; findUnique: jest.Mock };
  artistBooking: { findMany: jest.Mock };
};

const profile = {
  id: "artist-nova",
  stageName: "Nova",
  bio: "Basement techno.",
  imageUrl: "/media/nova.jpg",
};

beforeEach(() => {
  db.artistProfile.findMany.mockReset().mockResolvedValue([profile]);
  db.artistProfile.findUnique.mockReset().mockResolvedValue(profile);
  db.artistBooking.findMany.mockReset().mockResolvedValue([]);
});

describe("PublicDjsService", () => {
  const service = () => new PublicDjsService();

  it("leads with DJs who have a photo", async () => {
    db.artistProfile.findMany.mockResolvedValue([
      { ...profile, id: "b", stageName: "B", imageUrl: null },
      { ...profile, id: "a", stageName: "A" },
    ]);
    db.artistBooking.findMany.mockResolvedValue([{ artistId: "b" }]);

    const rows = await service().list();

    expect(rows.map((r) => r.id)).toEqual(["a", "b"]);
    expect(rows[1].upcoming).toBe(1);
  });

  it("exposes only what a guest may see on a profile", async () => {
    db.artistBooking.findMany.mockResolvedValue([
      {
        slot: "22:00-23:00",
        startAt: new Date("2027-03-13T20:00:00.000Z"),
        slotRef: { label: "22:00–23:00" },
        event: {
          id: "event-1",
          title: "Deep End",
          date: new Date("2027-03-13T20:00:00.000Z"),
          venue: { name: "The Vault", address: "12 Long St, Cape Town" },
        },
      },
    ]);

    const dj = await service().detail("artist-nova");

    expect(dj).toMatchObject({
      stageName: "Nova",
      sets: [{ eventId: "event-1", title: "Deep End", time: "22:00–23:00" }],
    });
    expect(dj).not.toHaveProperty("bankAccountNumber");
    expect(dj).not.toHaveProperty("homeAddress");
    expect(dj).not.toHaveProperty("travelRatePerKm");

    // Only confirmed nights on announced events can appear.
    const where = db.artistBooking.findMany.mock.calls[0][0].where;
    expect(where).toMatchObject({
      artistId: "artist-nova",
      status: "confirmed",
      event: { status: { in: ["approved", "live"] } },
    });
  });

  it("hides an unknown or removed DJ behind a 404", async () => {
    db.artistProfile.findUnique.mockResolvedValue(null);

    await expect(service().detail("gone")).rejects.toBeInstanceOf(NotFoundException);
  });
});
