import { ForbiddenException, NotFoundException } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { prisma } from "@essentials/db";
import { EventsService } from "./events.service";
import type { LoyaltyService } from "../loyalty/loyalty.service";
import type { VenuesService } from "../venues/venues.service";
import type { JwtUser } from "../common/roles.guard";

jest.mock("@essentials/db", () => ({
  prisma: {
    event: { findUnique: jest.fn() },
    guestList: { findMany: jest.fn(), findFirst: jest.fn(), update: jest.fn() },
    doorLog: { create: jest.fn() },
  },
  GuestListStatus: { attending: "attending", waitlisted: "waitlisted", checked_in: "checked_in" },
  EventStatus: { approved: "approved", live: "live" },
}));

const db = prisma as unknown as {
  event: { findUnique: jest.Mock };
  guestList: { findMany: jest.Mock; findFirst: jest.Mock; update: jest.Mock };
  doorLog: { create: jest.Mock };
};

const promoter: JwtUser = { sub: "promoter-1", email: "p@example.com", role: "promoter" };
const other: JwtUser = { sub: "promoter-2", email: "o@example.com", role: "promoter" };
const recordVisit = jest.fn();

const service = () =>
  new EventsService(
    { get: () => undefined } as unknown as ConfigService,
    { recordVisit } as unknown as LoyaltyService,
    {} as VenuesService,
  );

function guest(over: Record<string, unknown> = {}) {
  return {
    id: "guest-1",
    userId: "user-1",
    headcount: 2,
    status: "attending",
    checkedInAt: null,
    qrCode: "EL:event-1:user-1:sig",
    user: { name: "Nomsa", email: "nomsa@example.com", avatar: null },
    event: {
      promoterId: "promoter-1",
      venueId: "venue-1",
      venue: { managerId: "venue-1" },
    },
    ...over,
  };
}

beforeEach(() => {
  db.event.findUnique.mockReset().mockResolvedValue({
    id: "event-1",
    promoterId: "promoter-1",
    venue: { managerId: "venue-1" },
  });
  db.guestList.findMany.mockReset().mockResolvedValue([guest()]);
  db.guestList.findFirst.mockReset().mockResolvedValue(guest());
  db.guestList.update.mockReset().mockResolvedValue({});
  db.doorLog.create.mockReset().mockResolvedValue({});
  recordVisit.mockReset();
});

describe("EventsService.guestList", () => {
  it("searches the list by name or email, case-insensitively", async () => {
    const rows = await service().guestList(promoter, "event-1", "nom");

    expect(rows[0]).toMatchObject({ name: "Nomsa", email: "nomsa@example.com", headcount: 2 });
    const where = db.guestList.findMany.mock.calls[0][0].where;
    expect(where.eventId).toBe("event-1");
    expect(where.user.OR[0].name).toEqual({ contains: "nom", mode: "insensitive" });
  });

  it("keeps other promoters out of the door list", async () => {
    await expect(service().guestList(other, "event-1")).rejects.toBeInstanceOf(ForbiddenException);
    expect(db.guestList.findMany).not.toHaveBeenCalled();
  });
});

describe("EventsService.checkInGuest", () => {
  it("checks a guest in by name and writes the door log", async () => {
    const result = await service().checkInGuest(promoter, "event-1", "guest-1");

    expect(result).toMatchObject({ result: "ok", guest: "Nomsa", headcount: 2 });
    expect(db.guestList.update).toHaveBeenCalledWith({
      where: { id: "guest-1" },
      data: { status: "checked_in", checkedInAt: expect.any(Date) },
    });
    expect(db.doorLog.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ eventId: "event-1", venueId: "venue-1", result: "ok", scannedBy: "promoter-1" }),
    });
    expect(recordVisit).toHaveBeenCalledWith("user-1", "event-1");
  });

  it("says so when the guest is already inside instead of checking them in twice", async () => {
    db.guestList.findFirst.mockResolvedValue(guest({ status: "checked_in" }));

    const result = await service().checkInGuest(promoter, "event-1", "guest-1");

    expect(result).toMatchObject({ result: "duplicate", guest: "Nomsa" });
    expect(db.guestList.update).not.toHaveBeenCalled();
    expect(db.doorLog.create).not.toHaveBeenCalled();
  });

  it("404s for a guest on a different night", async () => {
    db.guestList.findFirst.mockResolvedValue(null);

    await expect(service().checkInGuest(promoter, "event-1", "guest-9")).rejects.toBeInstanceOf(NotFoundException);
  });

  it("lets the venue's manager work the door", async () => {
    await service().checkInGuest(
      { sub: "venue-1", email: "v@example.com", role: "venue_manager" },
      "event-1",
      "guest-1",
    );

    expect(db.guestList.update).toHaveBeenCalled();
  });
});
