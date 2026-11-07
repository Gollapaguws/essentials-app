import { ConflictException } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { prisma } from "@essentials/db";
import { DjBookingService } from "./dj-booking.service";
import type { NotificationsService } from "../notifications/notifications.service";
import type { JwtUser } from "../common/roles.guard";

jest.mock("@essentials/db", () => ({
  prisma: {
    artistBooking: {
      findUnique: jest.fn(),
      findMany: jest.fn(),
      findFirst: jest.fn(),
      update: jest.fn(),
      aggregate: jest.fn(),
      groupBy: jest.fn(),
    },
    artistNote: { findMany: jest.fn() },
  },
}));

const db = prisma as unknown as {
  artistBooking: {
    findUnique: jest.Mock;
    findMany: jest.Mock;
    findFirst: jest.Mock;
    update: jest.Mock;
    aggregate: jest.Mock;
    groupBy: jest.Mock;
  };
  artistNote: { findMany: jest.Mock };
};

const deliver = jest.fn();
const promoter: JwtUser = { sub: "promoter-1", email: "promoter@example.com", role: "promoter" };

const service = () =>
  new DjBookingService(
    { deliver } as unknown as NotificationsService,
    { get: () => undefined } as unknown as ConfigService,
  );

function application(fee = 495, budget = 1200) {
  return {
    id: "booking-1",
    eventId: "event-1",
    slotId: "slot-1",
    status: "pending",
    slot: "20:00–21:00",
    performanceFee: fee,
    startAt: new Date("2027-03-13T20:00:00.000Z"),
    endAt: new Date("2027-03-13T21:00:00.000Z"),
    event: {
      id: "event-1",
      title: "Deep End",
      promoterId: "promoter-1",
      budget,
      date: new Date("2027-03-13T20:00:00.000Z"),
    },
    artist: { userId: "artist-user-1", user: { id: "artist-user-1", email: "dj@example.com" } },
  };
}

beforeEach(() => {
  db.artistBooking.findUnique.mockReset();
  db.artistBooking.findMany.mockReset().mockResolvedValue([]);
  db.artistBooking.findFirst.mockReset().mockResolvedValue(null);
  db.artistBooking.update.mockReset().mockResolvedValue({ id: "booking-1", status: "confirmed" });
  db.artistBooking.aggregate.mockReset().mockResolvedValue({ _sum: { performanceFee: 0 } });
  db.artistBooking.groupBy.mockReset().mockResolvedValue([]);
  db.artistNote.findMany.mockReset().mockResolvedValue([]);
  deliver.mockReset();
});

describe("DjBookingService.decide — budget is a hard ceiling", () => {
  it("confirms a slot that still fits the budget", async () => {
    db.artistBooking.findUnique.mockResolvedValue(application(495, 1200));
    db.artistBooking.aggregate.mockResolvedValue({ _sum: { performanceFee: 495 } });

    await service().decide(promoter, "booking-1", true);

    expect(db.artistBooking.update).toHaveBeenCalledWith({
      where: { id: "booking-1" },
      data: { status: "confirmed" },
    });
    // Everything already agreed on the night counts, cancelled and pending do not.
    expect(db.artistBooking.aggregate).toHaveBeenCalledWith({
      where: {
        eventId: "event-1",
        id: { not: "booking-1" },
        status: { in: ["confirmed", "completed"] },
      },
      _sum: { performanceFee: true },
    });
  });

  it("refuses the confirmation that would put the night over budget", async () => {
    db.artistBooking.findUnique.mockResolvedValue(application(495, 1200));
    db.artistBooking.aggregate.mockResolvedValue({ _sum: { performanceFee: 990 } });

    await expect(service().decide(promoter, "booking-1", true)).rejects.toThrow(ConflictException);
    await expect(service().decide(promoter, "booking-1", true)).rejects.toThrow(/over budget/i);
    expect(db.artistBooking.update).not.toHaveBeenCalled();
    expect(deliver).not.toHaveBeenCalled();
  });

  it("names the fee, what is committed and the ceiling in the refusal", async () => {
    db.artistBooking.findUnique.mockResolvedValue(application(495, 1200));
    db.artistBooking.aggregate.mockResolvedValue({ _sum: { performanceFee: 990 } });

    await expect(service().decide(promoter, "booking-1", true)).rejects.toThrow(
      /R495.*R990.*R1,200/,
    );
  });

  it("allows a confirmation that lands exactly on the budget", async () => {
    db.artistBooking.findUnique.mockResolvedValue(application(210, 1200));
    db.artistBooking.aggregate.mockResolvedValue({ _sum: { performanceFee: 990 } });

    await service().decide(promoter, "booking-1", true);

    expect(db.artistBooking.update).toHaveBeenCalled();
  });

  it("keeps confirming when the promoter set no ceiling", async () => {
    db.artistBooking.findUnique.mockResolvedValue(application(495, 0));

    await service().decide(promoter, "booking-1", true);

    expect(db.artistBooking.aggregate).not.toHaveBeenCalled();
    expect(db.artistBooking.update).toHaveBeenCalled();
  });

  it("won't let two DJs hold the same slot", async () => {
    db.artistBooking.findUnique.mockResolvedValue(application(495, 1200));
    db.artistBooking.findFirst.mockResolvedValue({ id: "other-booking" });

    await expect(service().decide(promoter, "booking-1", true)).rejects.toThrow(/already holds that slot/);
    expect(db.artistBooking.update).not.toHaveBeenCalled();
  });

  it("never blocks a decline, even on an over-budget night", async () => {
    db.artistBooking.findUnique.mockResolvedValue(application(495, 100));
    db.artistBooking.aggregate.mockResolvedValue({ _sum: { performanceFee: 990 } });

    await service().decide(promoter, "booking-1", false);

    expect(db.artistBooking.aggregate).not.toHaveBeenCalled();
    expect(db.artistBooking.update).toHaveBeenCalledWith({
      where: { id: "booking-1" },
      data: { status: "cancelled", declineReason: null },
    });
  });

  it("tells the DJ why, and re-opens the slot for the others who applied", async () => {
    db.artistBooking.findUnique.mockResolvedValue(application(495, 1200));
    db.artistBooking.findMany.mockResolvedValue([{ artist: { userId: "artist-user-2" } }]);

    await service().decide(promoter, "booking-1", false, "  Going a different direction  ");

    expect(db.artistBooking.update).toHaveBeenCalledWith({
      where: { id: "booking-1" },
      data: { status: "cancelled", declineReason: "Going a different direction" },
    });
    expect(deliver).toHaveBeenCalledWith(
      ["artist-user-1"],
      expect.objectContaining({ body: expect.stringContaining("Reason: Going a different direction") }),
    );
    expect(deliver).toHaveBeenCalledWith(
      ["artist-user-2"],
      expect.objectContaining({ title: expect.stringContaining("Slot open again") }),
    );
  });
});

describe("DjBookingService.applications — budget context", () => {
  it("says how much of each night is already committed", async () => {
    db.artistBooking.findMany.mockResolvedValue([
      { ...application(495, 1200), artistId: "artist-1" },
      { ...application(300, 1200), id: "booking-2", artistId: "artist-1" },
    ]);
    db.artistBooking.groupBy.mockResolvedValue([
      { eventId: "event-1", _sum: { performanceFee: 990 } },
    ]);

    const rows = await service().applications(promoter);

    expect(rows.map((r) => r.event.committed)).toEqual([990, 990]);
    expect(rows[0].event.budget).toBe(1200);
    expect(db.artistBooking.groupBy).toHaveBeenCalledWith({
      by: ["eventId"],
      where: { eventId: { in: ["event-1"] }, status: { in: ["confirmed", "completed"] } },
      _sum: { performanceFee: true },
    });
  });
});
