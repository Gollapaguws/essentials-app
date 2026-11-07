import { BadRequestException, ConflictException, NotFoundException } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { prisma } from "@essentials/db";
import { EventsService } from "./events.service";
import type { LoyaltyService } from "../loyalty/loyalty.service";
import type { VenuesService } from "../venues/venues.service";
import type { JwtUser } from "../common/roles.guard";

jest.mock("@essentials/db", () => ({
  prisma: {
    event: { findUnique: jest.fn() },
    eventSlot: { findUnique: jest.fn(), update: jest.fn() },
    artistBooking: { findFirst: jest.fn() },
  },
  EventStatus: { draft: "draft", approved: "approved", live: "live" },
}));

const db = prisma as unknown as {
  event: { findUnique: jest.Mock };
  eventSlot: { findUnique: jest.Mock; update: jest.Mock };
  artistBooking: { findFirst: jest.Mock };
};

const promoter: JwtUser = { sub: "promoter-1", email: "p@example.com", role: "promoter" };

const service = () =>
  new EventsService({ get: () => undefined } as unknown as ConfigService, {} as LoyaltyService, {} as VenuesService);

beforeEach(() => {
  db.event.findUnique.mockReset().mockResolvedValue({
    id: "event-1",
    promoterId: "promoter-1",
    venue: { managerId: null },
  });
  db.eventSlot.findUnique.mockReset().mockResolvedValue({ id: "slot-1", eventId: "event-1", fee: 495 });
  db.eventSlot.update.mockReset().mockResolvedValue({ id: "slot-1", fee: 900 });
  db.artistBooking.findFirst.mockReset().mockResolvedValue(null);
});

describe("EventsService.setSlotFee", () => {
  it("prices one slot differently from the plan", async () => {
    await service().setSlotFee(promoter, "event-1", "slot-1", 900);

    expect(db.eventSlot.update).toHaveBeenCalledWith({ where: { id: "slot-1" }, data: { fee: 900 } });
  });

  it("won't move the fee of a slot a DJ has already agreed to", async () => {
    db.artistBooking.findFirst.mockResolvedValue({ id: "booking-1" });

    await expect(service().setSlotFee(promoter, "event-1", "slot-1", 900)).rejects.toBeInstanceOf(
      ConflictException,
    );
    expect(db.eventSlot.update).not.toHaveBeenCalled();
  });

  it("keeps the fee on the slot's own event", async () => {
    db.eventSlot.findUnique.mockResolvedValue({ id: "slot-9", eventId: "other-event", fee: 495 });

    await expect(service().setSlotFee(promoter, "event-1", "slot-9", 900)).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });

  it("refuses a fee that is not a positive whole amount", async () => {
    await expect(service().setSlotFee(promoter, "event-1", "slot-1", 0)).rejects.toBeInstanceOf(
      BadRequestException,
    );
    await expect(service().setSlotFee(promoter, "event-1", "slot-1", 99.5)).rejects.toBeInstanceOf(
      BadRequestException,
    );
  });
});
