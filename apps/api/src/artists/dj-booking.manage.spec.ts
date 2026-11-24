import { ConfigService } from "@nestjs/config";
import { prisma } from "@essentials/db";
import { DjBookingService } from "./dj-booking.service";
import type { NotificationsService } from "../notifications/notifications.service";
import type { JwtUser } from "../common/roles.guard";

jest.mock("@essentials/db", () => ({
  prisma: {
    artistProfile: { findUnique: jest.fn() },
    artistBooking: {
      findUnique: jest.fn(),
      findFirst: jest.fn(),
      findMany: jest.fn(),
      update: jest.fn(),
      aggregate: jest.fn(),
    },
    eventSlot: { findUnique: jest.fn() },
    doorBooking: { aggregate: jest.fn() },
  },
}));

const db = prisma as unknown as {
  artistProfile: { findUnique: jest.Mock };
  artistBooking: {
    findUnique: jest.Mock;
    findFirst: jest.Mock;
    findMany: jest.Mock;
    update: jest.Mock;
    aggregate: jest.Mock;
  };
  eventSlot: { findUnique: jest.Mock };
  doorBooking: { aggregate: jest.Mock };
};

const deliver = jest.fn();
const promoter: JwtUser = { sub: "promoter-1", email: "promoter@example.com", role: "promoter" };
const artist: JwtUser = { sub: "artist-user-1", email: "dj@example.com", role: "artist" };
const admin: JwtUser = { sub: "admin-1", email: "admin@example.com", role: "admin" };

const service = () =>
  new DjBookingService(
    { deliver } as unknown as NotificationsService,
    { get: () => undefined } as unknown as ConfigService,
  );

function booking(overrides: Record<string, unknown> = {}) {
  return {
    id: "booking-1",
    eventId: "event-1",
    artistId: "artist-1",
    slotId: "slot-1",
    slot: "20:00–21:00",
    status: "confirmed",
    performanceFee: 750,
    startAt: new Date("2099-03-13T20:00:00.000Z"),
    endAt: new Date("2099-03-13T21:00:00.000Z"),
    event: {
      id: "event-1",
      title: "Frequency",
      promoterId: "promoter-1",
      budget: 5000,
      date: new Date("2099-03-13T18:00:00.000Z"),
      venue: { name: "The Venue" },
    },
    artist: { userId: "artist-user-1", user: { id: "artist-user-1", email: "dj@example.com" } },
    ...overrides,
  };
}

function slot(overrides: Record<string, unknown> = {}) {
  return {
    id: "slot-2",
    eventId: "event-1",
    label: "21:00–22:00",
    startsAt: new Date("2099-03-13T21:00:00.000Z"),
    endsAt: new Date("2099-03-13T22:00:00.000Z"),
    fee: 900,
    ...overrides,
  };
}

beforeEach(() => {
  db.artistProfile.findUnique.mockReset().mockResolvedValue({ id: "artist-1", stageName: "REFRAKT" });
  db.artistBooking.findUnique.mockReset().mockResolvedValue(booking());
  db.artistBooking.findFirst.mockReset().mockResolvedValue(null);
  db.artistBooking.findMany.mockReset().mockResolvedValue([]);
  db.artistBooking.update.mockReset().mockResolvedValue({ id: "booking-1", status: "cancelled" });
  db.artistBooking.aggregate.mockReset().mockResolvedValue({ _sum: { performanceFee: 750 } });
  db.eventSlot.findUnique.mockReset().mockResolvedValue(slot());
  db.doorBooking.aggregate.mockReset().mockResolvedValue({ _sum: { fee: 0 } });
  deliver.mockReset();
});

describe("DjBookingService.withdraw", () => {
  it("cancels the artist's pending application and tells the promoter", async () => {
    db.artistBooking.findUnique.mockResolvedValue(booking({ status: "pending" }));

    const result = await service().withdraw(artist, "booking-1");

    expect(db.artistBooking.update).toHaveBeenCalledWith({
      where: { id: "booking-1" },
      data: { status: "cancelled" },
    });
    expect(result).toEqual({ id: "booking-1", status: "cancelled" });
    expect(deliver).toHaveBeenCalledWith(
      ["promoter-1"],
      expect.objectContaining({
        title: expect.stringContaining("Application cancelled"),
        body: expect.stringContaining("REFRAKT"),
      }),
    );
  });

  it("will not let an artist cancel a confirmed booking", async () => {
    await expect(service().withdraw(artist, "booking-1")).rejects.toThrow(/only a pending application/i);
    expect(db.artistBooking.update).not.toHaveBeenCalled();
  });

  it("will not let an artist cancel someone else's application", async () => {
    db.artistProfile.findUnique.mockResolvedValue({ id: "artist-2", stageName: "Luminyt" });

    await expect(service().withdraw(artist, "booking-1")).rejects.toThrow(/not your application/i);
    expect(db.artistBooking.update).not.toHaveBeenCalled();
  });
});

describe("DjBookingService.cancelAsAdmin", () => {
  it("cancels a confirmed booking, tells both sides and reopens the slot", async () => {
    db.artistBooking.findMany.mockResolvedValue([{ artist: { userId: "artist-user-2" } }]);

    const result = await service().cancelAsAdmin(admin, "booking-1");

    expect(db.artistBooking.update).toHaveBeenCalledWith({
      where: { id: "booking-1" },
      data: { status: "cancelled" },
    });
    expect(result).toEqual({ id: "booking-1", status: "cancelled" });
    expect(deliver).toHaveBeenNthCalledWith(
      1,
      ["artist-user-1"],
      expect.objectContaining({
        title: expect.stringContaining("SLOT CANCELLED"),
        body: expect.stringContaining("confirmed"),
        channels: ["inapp", "telegram"],
      }),
    );
    expect(deliver).toHaveBeenNthCalledWith(
      2,
      ["promoter-1"],
      expect.objectContaining({ title: expect.stringContaining("Admin cancelled a slot") }),
    );
    expect(deliver).toHaveBeenNthCalledWith(
      3,
      ["artist-user-2"],
      expect.objectContaining({ title: expect.stringContaining("Slot open again") }),
    );
  });

  it("refuses to cancel a completed gig", async () => {
    db.artistBooking.findUnique.mockResolvedValue(booking({ status: "completed" }));

    await expect(service().cancelAsAdmin(admin, "booking-1")).rejects.toThrow(/already payable/i);
    expect(db.artistBooking.update).not.toHaveBeenCalled();
  });

  it("is admin-only", async () => {
    await expect(service().cancelAsAdmin(promoter, "booking-1")).rejects.toThrow(/only an admin/i);
    expect(db.artistBooking.update).not.toHaveBeenCalled();
  });

  it("does not notify twice when the booking is already cancelled", async () => {
    db.artistBooking.findUnique.mockResolvedValue(booking({ status: "cancelled" }));

    await service().cancelAsAdmin(admin, "booking-1");

    expect(db.artistBooking.update).not.toHaveBeenCalled();
    expect(deliver).not.toHaveBeenCalled();
  });
});

describe("DjBookingService.move", () => {
  it("moves a confirmed booking and prices it at the target slot", async () => {
    db.artistBooking.update.mockResolvedValue({
      id: "booking-1",
      status: "confirmed",
      slotId: "slot-2",
      slot: "21:00–22:00",
      performanceFee: 900,
    });

    const result = await service().move(promoter, "booking-1", "slot-2");

    expect(db.artistBooking.update).toHaveBeenCalledWith({
      where: { id: "booking-1" },
      data: {
        slot: "21:00–22:00",
        slotId: "slot-2",
        startAt: slot().startsAt,
        endAt: slot().endsAt,
        performanceFee: 900,
      },
    });
    expect(db.artistBooking.aggregate).toHaveBeenCalledWith({
      where: {
        eventId: "event-1",
        id: { not: "booking-1" },
        status: { in: ["confirmed", "completed"] },
      },
      _sum: { performanceFee: true },
    });
    expect(result).toMatchObject({ slot: "21:00–22:00", performanceFee: 900 });
    expect(deliver).toHaveBeenCalledWith(
      ["artist-user-1"],
      expect.objectContaining({ title: expect.stringContaining("SLOT CHANGED") }),
    );
  });

  it("moves a pending application without checking the budget", async () => {
    db.artistBooking.findUnique.mockResolvedValue(booking({ status: "pending" }));

    await service().move(promoter, "booking-1", "slot-2");

    expect(db.artistBooking.aggregate).not.toHaveBeenCalled();
    expect(deliver).toHaveBeenCalledWith(
      ["artist-user-1"],
      expect.objectContaining({ channels: ["inapp"] }),
    );
  });

  it("refuses to move a completed gig", async () => {
    db.artistBooking.findUnique.mockResolvedValue(booking({ status: "completed" }));

    await expect(service().move(promoter, "booking-1", "slot-2")).rejects.toThrow(
      /completed gig cannot be moved/i,
    );
    expect(db.artistBooking.update).not.toHaveBeenCalled();
  });

  it("refuses a slot from another event", async () => {
    db.eventSlot.findUnique.mockResolvedValue(slot({ eventId: "event-2" }));

    await expect(service().move(promoter, "booking-1", "slot-2")).rejects.toThrow(
      /belongs to another event/i,
    );
  });

  it("refuses a slot another DJ already holds", async () => {
    db.artistBooking.findFirst.mockResolvedValueOnce(null).mockResolvedValueOnce({ id: "other" });

    await expect(service().move(promoter, "booking-1", "slot-2")).rejects.toThrow(
      /already holds that slot/i,
    );
    expect(db.artistBooking.update).not.toHaveBeenCalled();
  });

  it("refuses to put the same DJ on a slot twice", async () => {
    db.artistBooking.findFirst.mockResolvedValueOnce({ id: "existing" });

    await expect(service().move(promoter, "booking-1", "slot-2")).rejects.toThrow(
      /already on this slot/i,
    );
  });

  it("counts the moved fee without double-counting the booking itself", async () => {
    db.artistBooking.aggregate.mockResolvedValue({ _sum: { performanceFee: 4500 } });

    await expect(service().move(promoter, "booking-1", "slot-2")).rejects.toThrow(/over budget/i);
    expect(db.artistBooking.update).not.toHaveBeenCalled();
  });

  it("tells the old slot's other applicants it is open again", async () => {
    db.artistBooking.findMany.mockResolvedValue([{ artist: { userId: "artist-user-2" } }]);
    db.artistBooking.update.mockResolvedValue({ id: "booking-1", status: "confirmed", slotId: "slot-2" });

    await service().move(promoter, "booking-1", "slot-2");

    expect(deliver).toHaveBeenCalledWith(
      ["artist-user-2"],
      expect.objectContaining({ title: expect.stringContaining("Slot open again") }),
    );
  });
});
