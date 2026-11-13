import { ConfigService } from "@nestjs/config";
import { prisma } from "@essentials/db";
import { DjBookingService } from "./dj-booking.service";
import type { NotificationsService } from "../notifications/notifications.service";
import type { JwtUser } from "../common/roles.guard";

jest.mock("@essentials/db", () => ({
  prisma: {
    artistBooking: {
      findUnique: jest.fn(),
      findFirst: jest.fn(),
      create: jest.fn(),
      aggregate: jest.fn(),
    },
    eventSlot: { findUnique: jest.fn() },
  },
}));

const db = prisma as unknown as {
  artistBooking: {
    findUnique: jest.Mock;
    findFirst: jest.Mock;
    create: jest.Mock;
    aggregate: jest.Mock;
  };
  eventSlot: { findUnique: jest.Mock };
};

const deliver = jest.fn();
const promoter: JwtUser = { sub: "promoter-1", email: "promoter@example.com", role: "promoter" };

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
    fee: 750,
    ...overrides,
  };
}

beforeEach(() => {
  db.artistBooking.findUnique.mockReset().mockResolvedValue(booking());
  db.artistBooking.findFirst.mockReset().mockResolvedValue(null);
  db.artistBooking.create.mockReset().mockResolvedValue({ id: "booking-2", status: "confirmed", slotId: "slot-2" });
  db.artistBooking.aggregate.mockReset().mockResolvedValue({ _sum: { performanceFee: 750 } });
  db.eventSlot.findUnique.mockReset().mockResolvedValue(slot());
  deliver.mockReset();
});

describe("DjBookingService.extend", () => {
  it("adds the DJ to another slot as a separate confirmed booking", async () => {
    const result = await service().extend(promoter, "booking-1", "slot-2");

    expect(db.artistBooking.create).toHaveBeenCalledWith({
      data: {
        eventId: "event-1",
        artistId: "artist-1",
        slot: "21:00–22:00",
        slotId: "slot-2",
        startAt: slot().startsAt,
        endAt: slot().endsAt,
        performanceFee: 750,
        appliedAt: expect.any(Date),
        status: "confirmed",
      },
      include: { artist: { include: { user: { select: { id: true, email: true } } } } },
    });
    expect(result).toMatchObject({ id: "booking-2", status: "confirmed", slotId: "slot-2" });
    expect(deliver).toHaveBeenCalledWith(
      ["artist-user-1"],
      expect.objectContaining({ title: expect.stringContaining("EXTENDED") }),
    );
  });

  it("only extends a confirmed booking", async () => {
    db.artistBooking.findUnique.mockResolvedValue(booking({ status: "pending" }));

    await expect(service().extend(promoter, "booking-1", "slot-2")).rejects.toThrow(
      /only a confirmed booking/i,
    );
    expect(db.artistBooking.create).not.toHaveBeenCalled();
  });

  it("refuses a slot from another event", async () => {
    db.eventSlot.findUnique.mockResolvedValue(slot({ eventId: "event-2" }));

    await expect(service().extend(promoter, "booking-1", "slot-2")).rejects.toThrow(
      /belongs to another event/i,
    );
    expect(db.artistBooking.create).not.toHaveBeenCalled();
  });

  it("refuses to duplicate the DJ in the same slot", async () => {
    db.artistBooking.findFirst.mockResolvedValueOnce({ id: "existing-booking" });

    await expect(service().extend(promoter, "booking-1", "slot-2")).rejects.toThrow(
      /already on this slot/i,
    );
    expect(db.artistBooking.create).not.toHaveBeenCalled();
  });

  it("refuses a slot another DJ already holds", async () => {
    db.artistBooking.findFirst
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({ id: "other-booking" });

    await expect(service().extend(promoter, "booking-1", "slot-2")).rejects.toThrow(
      /already holds that slot/i,
    );
    expect(db.artistBooking.create).not.toHaveBeenCalled();
  });

  it("counts the extension against the event budget", async () => {
    db.artistBooking.aggregate.mockResolvedValue({ _sum: { performanceFee: 4500 } });

    await expect(service().extend(promoter, "booking-1", "slot-2")).rejects.toThrow(
      /over budget/i,
    );
    expect(db.artistBooking.aggregate).toHaveBeenCalledWith({
      where: {
        eventId: "event-1",
        status: { in: ["confirmed", "completed"] },
      },
      _sum: { performanceFee: true },
    });
    expect(db.artistBooking.create).not.toHaveBeenCalled();
  });
});
