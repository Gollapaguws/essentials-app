import { ForbiddenException } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { prisma } from "@essentials/db";
import { EventsService } from "./events.service";
import type { LoyaltyService } from "../loyalty/loyalty.service";
import type { VenuesService } from "../venues/venues.service";
import type { DjBookingService } from "../artists/dj-booking.service";
import type { JwtUser } from "../common/roles.guard";

jest.mock("@essentials/db", () => ({
  prisma: {
    event: { findUnique: jest.fn(), findMany: jest.fn() },
    guestList: { findMany: jest.fn() },
  },
  EventStatus: { approved: "approved", live: "live" },
  GuestListStatus: { attending: "attending", waitlisted: "waitlisted", checked_in: "checked_in" },
}));

const db = prisma as unknown as {
  event: { findUnique: jest.Mock; findMany: jest.Mock };
  guestList: { findMany: jest.Mock };
};

const guest: JwtUser = { sub: "guest-1", email: "guest@example.com", role: "guest" };
const artist: JwtUser = { sub: "artist-1", email: "artist@example.com", role: "artist" };
const promoter: JwtUser = { sub: "promoter-1", email: "p@example.com", role: "promoter" };
const otherManager: JwtUser = { sub: "venue-2", email: "v2@example.com", role: "venue_manager" };

const event = {
  id: "event-1",
  title: "Deep End",
  description: null,
  date: new Date("2026-12-31T22:00:00.000Z"),
  lineup: [],
  dressCode: null,
  status: "approved",
  capacity: 100,
  promoterId: "promoter-1",
  venue: { id: "venue-1", name: "The Vault", managerId: "venue-1", lat: 0, lng: 0, amenities: [] },
  promoter: { id: "promoter-1", name: "SONUS" },
  guestLists: [
    {
      id: "entry-1",
      userId: "guest-1",
      status: "attending",
      user: { id: "guest-1", name: "Nomsa", avatar: null },
    },
  ],
  _count: { guestLists: 1 },
};

const service = () =>
  new EventsService(
    { get: () => undefined } as unknown as ConfigService,
    {} as LoyaltyService,
    {} as VenuesService,
    {} as DjBookingService,
  );

beforeEach(() => {
  db.event.findUnique.mockReset().mockResolvedValue(event);
  db.event.findMany.mockReset().mockResolvedValue([]);
  db.guestList.findMany.mockReset().mockResolvedValue([]);
});

describe("EventsService.detail", () => {
  it("shows a guest their own RSVP but not the guest list", async () => {
    const result = await service().detail("event-1", guest);

    expect(result).toMatchObject({
      canRsvp: true,
      myRsvp: { status: "attending" },
    });
    expect(result.guestLists).toBeUndefined();
  });

  it("lets an artist read the event without exposing the guest list", async () => {
    const result = await service().detail("event-1", artist);

    expect(result).toMatchObject({ canRsvp: false, myRsvp: null });
    expect(result.guestLists).toBeUndefined();
  });

  it("gives the owning promoter the guest list", async () => {
    const result = await service().detail("event-1", promoter);

    expect(result.canRsvp).toBe(false);
    expect(result.guestLists).toHaveLength(1);
  });

  it("lets a venue manager read another venue's event without the guest list", async () => {
    const result = await service().detail("event-1", otherManager);

    expect(result.guestLists).toBeUndefined();
  });

  it("still refuses guest writes against an event", async () => {
    await expect(service().setSlotFee(guest, "event-1", "slot-1", 500)).rejects.toBeInstanceOf(
      ForbiddenException,
    );
  });
});

describe("EventsService.listForPromoter", () => {
  it("carries each slot's place in the night into the budget view", async () => {
    db.event.findMany.mockResolvedValue([
      {
        id: "event-1",
        title: "Deep End",
        date: new Date("2026-12-31T22:00:00.000Z"),
        budget: 5000,
        venue: { name: "The Vault" },
        _count: { guestLists: 0, artistBookings: 1, doorBookings: 0 },
        doorBookings: [],
        slots: [
          {
            id: "slot-1",
            label: "01:00–02:00",
            fee: 500,
            startsAt: new Date("2027-01-01T01:00:00.000Z"),
            role: "The Peak Architect",
            bpmRange: "139–148",
            genres: "Techno · Psy Tech · Peak Tech House",
            bookings: [{ status: "confirmed" }],
          },
        ],
      },
    ]);

    const [row] = await service().listForPromoter(promoter);

    expect(row.slots[0]).toMatchObject({
      label: "01:00–02:00",
      role: "The Peak Architect",
      bpmRange: "139–148",
      genres: "Techno · Psy Tech · Peak Tech House",
      taken: true,
      confirmed: true,
    });
  });
});

describe("EventsService.mine", () => {
  it("returns only attending passes in feed shape", async () => {
    db.guestList.findMany.mockResolvedValue([
      { status: "attending", event: { ...event, _count: { guestLists: 1 } } },
    ]);

    const rows = await service().mine(guest);

    expect(rows[0]).toMatchObject({
      id: "event-1",
      going: 1,
      myRsvp: { status: "attending" },
    });
    expect(db.guestList.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          userId: "guest-1",
          status: { in: ["attending", "checked_in"] },
        }),
      }),
    );
  });
});
