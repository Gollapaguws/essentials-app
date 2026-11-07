import { ConflictException } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { prisma } from "@essentials/db";
import { EventsService } from "./events.service";
import type { LoyaltyService } from "../loyalty/loyalty.service";
import type { VenuesService } from "../venues/venues.service";
import type { JwtUser } from "../common/roles.guard";

jest.mock("@essentials/db", () => ({
  prisma: {
    event: { findUnique: jest.fn(), update: jest.fn() },
    artistBooking: { count: jest.fn(), aggregate: jest.fn() },
    eventSlot: { deleteMany: jest.fn(), createMany: jest.fn() },
    $transaction: jest.fn(),
  },
  EventStatus: {
    draft: "draft",
    pending_venue_approval: "pending_venue_approval",
    approved: "approved",
    live: "live",
    completed: "completed",
    cancelled: "cancelled",
  },
  GuestListStatus: { attending: "attending", waitlisted: "waitlisted", checked_in: "checked_in" },
}));

const db = prisma as unknown as {
  event: { findUnique: jest.Mock; update: jest.Mock };
  artistBooking: { count: jest.Mock; aggregate: jest.Mock };
  eventSlot: { deleteMany: jest.Mock; createMany: jest.Mock };
  $transaction: jest.Mock;
};

const promoter: JwtUser = { sub: "promoter-1", email: "p@example.com", role: "promoter" };

const service = () =>
  new EventsService(
    { get: () => undefined } as unknown as ConfigService,
    {} as LoyaltyService,
    {} as VenuesService,
  );

/** An event already planned at R495/h, 3 × 60 min, budget R900. */
function event(over: Record<string, unknown> = {}) {
  return {
    id: "event-1",
    promoterId: "promoter-1",
    date: new Date("2027-03-13T00:00:00.000Z"),
    djFeePerHour: 495,
    budget: 900,
    slotCount: 3,
    slotMinutes: 60,
    slotStartMinute: 1200,
    venue: { managerId: null },
    ...over,
  };
}

const plan = {
  djFeePerHour: 495,
  budget: 1500,
  slotCount: 3,
  slotMinutes: 60,
  slotStart: "20:00",
};

beforeEach(() => {
  db.event.findUnique.mockReset().mockResolvedValue(event());
  db.event.update.mockReset().mockResolvedValue(event());
  db.artistBooking.count.mockReset().mockResolvedValue(0);
  db.artistBooking.aggregate.mockReset().mockResolvedValue({ _sum: { performanceFee: 0 } });
  db.eventSlot.deleteMany.mockReset();
  db.eventSlot.createMany.mockReset();
  db.$transaction.mockReset().mockImplementation((ops: Promise<unknown>[]) => Promise.all(ops));
});

describe("EventsService.setSlots — budget with DJs already applied", () => {
  it("lets the promoter raise the ceiling without touching the slots DJs hold", async () => {
    db.artistBooking.count.mockResolvedValue(2);

    await service().setSlots(promoter, "event-1", plan);

    expect(db.event.update).toHaveBeenCalledWith({
      where: { id: "event-1" },
      data: { budget: 1500 },
    });
    expect(db.eventSlot.deleteMany).not.toHaveBeenCalled();
    expect(db.eventSlot.createMany).not.toHaveBeenCalled();
    expect(db.$transaction).not.toHaveBeenCalled();
  });

  it("refuses a ceiling under the money already promised", async () => {
    db.artistBooking.aggregate.mockResolvedValue({ _sum: { performanceFee: 900 } });

    await expect(
      service().setSlots(promoter, "event-1", { ...plan, budget: 500 }),
    ).rejects.toBeInstanceOf(ConflictException);
    await expect(
      service().setSlots(promoter, "event-1", { ...plan, budget: 500 }),
    ).rejects.toThrow(/below the R900/);
    expect(db.event.update).not.toHaveBeenCalled();
  });

  it("allows a ceiling equal to what is committed", async () => {
    db.artistBooking.aggregate.mockResolvedValue({ _sum: { performanceFee: 900 } });

    await service().setSlots(promoter, "event-1", { ...plan, budget: 900 });

    expect(db.event.update).toHaveBeenCalled();
  });

  it("still refuses a fee or slot change once DJs have applied", async () => {
    db.artistBooking.count.mockResolvedValue(2);

    await expect(
      service().setSlots(promoter, "event-1", { ...plan, djFeePerHour: 600 }),
    ).rejects.toBeInstanceOf(ConflictException);
    await expect(
      service().setSlots(promoter, "event-1", { ...plan, slotCount: 4 }),
    ).rejects.toBeInstanceOf(ConflictException);
    expect(db.event.update).not.toHaveBeenCalled();
  });

  it("replaces the whole plan while nobody has applied", async () => {
    await service().setSlots(promoter, "event-1", plan);

    expect(db.eventSlot.deleteMany).toHaveBeenCalledWith({ where: { eventId: "event-1" } });
    expect(db.eventSlot.createMany).toHaveBeenCalledWith({
      data: expect.arrayContaining([expect.objectContaining({ eventId: "event-1", fee: 495 })]),
    });
    expect(db.event.update).toHaveBeenCalledWith({
      where: { id: "event-1" },
      data: expect.objectContaining({ budget: 1500, slotCount: 3 }),
    });
  });
});
