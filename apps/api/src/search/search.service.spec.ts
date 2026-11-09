import { prisma } from "@essentials/db";
import { SearchService } from "./search.service";
import type { JwtUser } from "../common/roles.guard";

jest.mock("@essentials/db", () => ({
  prisma: {
    event: { findMany: jest.fn() },
    artistProfile: { findMany: jest.fn() },
    guestList: { findMany: jest.fn() },
  },
}));

const db = prisma as unknown as {
  event: { findMany: jest.Mock };
  artistProfile: { findMany: jest.Mock };
  guestList: { findMany: jest.Mock };
};

const service = new SearchService();

const as = (role: JwtUser["role"], sub = "user-1"): JwtUser => ({ sub, email: `${role}@example.com`, role });

beforeEach(() => {
  db.event.findMany.mockReset().mockResolvedValue([]);
  db.artistProfile.findMany.mockReset().mockResolvedValue([]);
  db.guestList.findMany.mockReset().mockResolvedValue([]);
});

describe("SearchService scoping", () => {
  it("gives an admin every event and every guest", async () => {
    await service.find(as("admin"), "vault");

    expect(db.event.findMany.mock.calls[0][0].where.AND[0]).toEqual({});
    expect(db.guestList.findMany.mock.calls[0][0].where.event).toEqual({});
  });

  it("keeps a promoter inside their own events", async () => {
    await service.find(as("promoter", "promo-1"), "vault");

    expect(db.event.findMany.mock.calls[0][0].where.AND[0]).toEqual({ promoterId: "promo-1" });
  });

  it("gives a venue manager the nights at their rooms as well as their own", async () => {
    await service.find(as("venue_manager", "vm-1"), "vault");

    expect(db.event.findMany.mock.calls[0][0].where.AND[0]).toEqual({
      OR: [{ promoterId: "vm-1" }, { venue: { managerId: "vm-1" } }],
    });
  });

  it("shows a DJ the roster but none of the promoter's guests", async () => {
    const results = await service.find(as("artist"), "nova");

    expect(db.artistProfile.findMany).toHaveBeenCalled();
    expect(db.event.findMany).not.toHaveBeenCalled();
    expect(db.guestList.findMany).not.toHaveBeenCalled();
    expect(results.events).toEqual([]);
    expect(results.guests).toEqual([]);
  });

  it("does not query the database for a one-letter term", async () => {
    const results = await service.find(as("admin"), " v ");

    expect(db.event.findMany).not.toHaveBeenCalled();
    expect(results).toEqual({ events: [], artists: [], guests: [] });
  });
});

describe("SearchService results", () => {
  it("names the artist by stage name and keeps their profile id", async () => {
    db.artistProfile.findMany.mockResolvedValue([{ id: "artist-9", stageName: "NOVA" }]);

    const results = await service.find(as("promoter"), "nova");

    expect(results.artists).toEqual([{ id: "artist-9", name: "NOVA" }]);
  });

  it("returns the guest's night so the palette can open the door list on it", async () => {
    db.guestList.findMany.mockResolvedValue([
      {
        id: "gl-1",
        status: "attending",
        user: { name: null, email: "guest@example.com" },
        event: { id: "ev-1", title: "Night Shift" },
      },
    ]);

    const results = await service.find(as("promoter"), "guest@");

    expect(results.guests).toEqual([
      { id: "gl-1", name: null, email: "guest@example.com", status: "attending", eventId: "ev-1", eventTitle: "Night Shift" },
    ]);
  });
});
