import { BadRequestException, ConflictException } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { prisma } from "@essentials/db";
import { DoorGigsService } from "./door-gigs.service";
import type { NotificationsService } from "../notifications/notifications.service";
import type { ArtistsService } from "../artists/artists.service";
import type { JwtUser } from "../common/roles.guard";

jest.mock("@essentials/db", () => ({
  prisma: {
    event: { findUnique: jest.fn(), findMany: jest.fn() },
    user: { findMany: jest.fn() },
    doorProfile: { findUnique: jest.fn(), create: jest.fn(), update: jest.fn() },
    doorBooking: {
      findUnique: jest.fn(),
      findFirst: jest.fn(),
      findMany: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
      aggregate: jest.fn(),
      groupBy: jest.fn(),
    },
    artistBooking: { aggregate: jest.fn(), groupBy: jest.fn() },
    doorInvoice: { findUnique: jest.fn(), findMany: jest.fn(), create: jest.fn() },
    $transaction: jest.fn(),
  },
}));

const db = prisma as unknown as {
  event: { findUnique: jest.Mock; findMany: jest.Mock };
  user: { findMany: jest.Mock };
  doorProfile: { findUnique: jest.Mock; create: jest.Mock; update: jest.Mock };
  doorBooking: {
    findUnique: jest.Mock;
    findFirst: jest.Mock;
    findMany: jest.Mock;
    create: jest.Mock;
    update: jest.Mock;
    aggregate: jest.Mock;
    groupBy: jest.Mock;
  };
  artistBooking: { aggregate: jest.Mock; groupBy: jest.Mock };
  doorInvoice: { findUnique: jest.Mock; findMany: jest.Mock; create: jest.Mock };
  $transaction: jest.Mock;
};

const deliver = jest.fn();
const doorUser: JwtUser = { sub: "door-1", email: "door@example.com", role: "door" };
const promoter: JwtUser = { sub: "promoter-1", email: "promoter@example.com", role: "promoter" };

const service = () =>
  new DoorGigsService(
    { deliver } as unknown as NotificationsService,
    { currentTravelRate: jest.fn().mockResolvedValue(4.95) } as unknown as ArtistsService,
    { get: () => undefined } as unknown as ConfigService,
  );

function profile(over: Record<string, unknown> = {}) {
  return {
    id: "profile-1",
    userId: "door-1",
    homeAddress: "1 Long Street, Cape Town",
    homeLat: -33.9249,
    homeLng: 18.4241,
    travelRatePerKm: 4.95,
    bankAccountHolder: "Nomsa Dlamini",
    bankName: "Capitec",
    bankAccountNumber: "123456789",
    bankBranchCode: "470010",
    bankAccountType: "savings",
    ...over,
  };
}

function event(over: Record<string, unknown> = {}) {
  return {
    id: "event-1",
    title: "Deep End",
    date: new Date("2099-03-13T20:00:00.000Z"),
    promoterId: "promoter-1",
    doorEnabled: true,
    doorFee: 750,
    status: "approved",
    venueId: "venue-1",
    ...over,
  };
}

function application(over: Record<string, unknown> = {}) {
  return {
    id: "door-booking-1",
    eventId: "event-1",
    profileId: "profile-1",
    fee: 750,
    travelFee: 0,
    status: "pending",
    appliedAt: new Date(),
    completedAt: null,
    declineReason: null,
    event: {
      id: "event-1",
      title: "Deep End",
      date: new Date("2099-03-13T20:00:00.000Z"),
      budget: 2000,
      promoterId: "promoter-1",
      venue: { name: "The Vault", managerId: "venue-1" },
    },
    profile: { userId: "door-1", user: { id: "door-1", email: "door@example.com" } },
    ...over,
  };
}

beforeEach(() => {
  db.event.findUnique.mockReset().mockResolvedValue(event());
  db.event.findMany.mockReset().mockResolvedValue([]);
  db.user.findMany.mockReset().mockResolvedValue([]);
  db.doorProfile.findUnique.mockReset().mockResolvedValue(profile());
  db.doorProfile.create.mockReset();
  db.doorProfile.update.mockReset();
  db.doorBooking.findUnique.mockReset().mockResolvedValue(null);
  db.doorBooking.findFirst.mockReset().mockResolvedValue(null);
  db.doorBooking.findMany.mockReset().mockResolvedValue([]);
  db.doorBooking.create.mockReset().mockImplementation(({ data }: { data: object }) => ({
    id: "door-booking-1",
    ...data,
  }));
  db.doorBooking.update.mockReset().mockResolvedValue({ id: "door-booking-1", status: "confirmed" });
  db.doorBooking.aggregate.mockReset().mockResolvedValue({ _sum: { fee: 0 } });
  db.doorBooking.groupBy.mockReset().mockResolvedValue([]);
  db.artistBooking.aggregate.mockReset().mockResolvedValue({ _sum: { performanceFee: 0 } });
  db.artistBooking.groupBy.mockReset().mockResolvedValue([]);
  db.doorInvoice.findUnique.mockReset();
  db.doorInvoice.findMany.mockReset().mockResolvedValue([]);
  db.doorInvoice.create.mockReset().mockImplementation(({ data }: { data: object }) => ({
    id: "door-invoice-1",
    ...data,
    items: [{ label: "Door shift", amount: 750 }],
  }));
  db.$transaction.mockReset().mockImplementation((ops: Promise<unknown>[]) => Promise.all(ops));
  deliver.mockReset();
});

describe("DoorGigsService.apply", () => {
  it("creates a pending application for an approved night with a door fee", async () => {
    const booking = await service().apply(doorUser, "event-1");

    expect(booking).toMatchObject({ status: "pending", fee: 750 });
    expect(db.doorBooking.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        eventId: "event-1",
        profileId: "profile-1",
        fee: 750,
        status: "pending",
      }),
    });
    expect(deliver).toHaveBeenCalledWith(
      ["promoter-1"],
      expect.objectContaining({ title: expect.stringContaining("Door application") }),
    );
  });

  it("needs a door profile before applying", async () => {
    db.doorProfile.findUnique.mockResolvedValue(null);

    await expect(service().apply(doorUser, "event-1")).rejects.toBeInstanceOf(BadRequestException);
    expect(db.doorBooking.create).not.toHaveBeenCalled();
  });

  it("refuses a night without a door fee, or one already under way", async () => {
    db.event.findUnique.mockResolvedValue(event({ doorEnabled: false }));
    await expect(service().apply(doorUser, "event-1")).rejects.toThrow(/does not need door staff/);

    db.event.findUnique.mockResolvedValue(event({ date: new Date("2020-01-01T20:00:00.000Z") }));
    await expect(service().apply(doorUser, "event-1")).rejects.toThrow(/already started/);
  });
});

describe("DoorGigsService.decide — the same budget ceiling as DJs", () => {
  it("confirms a host that fits the night's budget", async () => {
    db.doorBooking.findUnique.mockResolvedValue(application());

    await service().decide(promoter, "door-booking-1", true);

    expect(db.doorBooking.update).toHaveBeenCalledWith({
      where: { id: "door-booking-1" },
      data: { status: "confirmed" },
    });
    expect(deliver).toHaveBeenCalledWith(
      ["door-1"],
      expect.objectContaining({ title: expect.stringContaining("DOOR CONFIRMED") }),
    );
  });

  it("counts confirmed DJs and door hosts together against the ceiling", async () => {
    db.doorBooking.findUnique.mockResolvedValue(application({ fee: 600 }));
    db.artistBooking.aggregate.mockResolvedValue({ _sum: { performanceFee: 900 } });
    db.doorBooking.aggregate.mockResolvedValue({ _sum: { fee: 700 } });

    await expect(service().decide(promoter, "door-booking-1", true)).rejects.toBeInstanceOf(
      ConflictException,
    );
    await expect(service().decide(promoter, "door-booking-1", true)).rejects.toThrow(
      /R600.*R1,600.*R2,000/,
    );
    expect(db.doorBooking.update).not.toHaveBeenCalled();
  });

  it("never blocks a decline", async () => {
    db.doorBooking.findUnique.mockResolvedValue(application());

    await service().decide(promoter, "door-booking-1", false, "  Covered it ourselves  ");

    expect(db.doorBooking.update).toHaveBeenCalledWith({
      where: { id: "door-booking-1" },
      data: { status: "cancelled", declineReason: "Covered it ourselves" },
    });
    expect(db.artistBooking.aggregate).not.toHaveBeenCalled();
  });
});

describe("DoorGigsService.complete", () => {
  it("refuses before the night and then unlocks invoicing", async () => {
    db.doorBooking.findUnique.mockResolvedValue(application({ status: "confirmed" }));
    await expect(service().complete(promoter, "door-booking-1")).rejects.toThrow(
      /has not happened yet/,
    );

    db.doorBooking.findUnique.mockResolvedValue(
      application({
        status: "confirmed",
        event: {
          ...application().event,
          date: new Date("2020-01-01T20:00:00.000Z"),
        },
      }),
    );

    await service().complete(promoter, "door-booking-1");

    expect(db.doorBooking.update).toHaveBeenCalledWith({
      where: { id: "door-booking-1" },
      data: { status: "completed", completedAt: expect.any(Date) },
    });
    expect(deliver).toHaveBeenCalledWith(
      ["door-1"],
      expect.objectContaining({ title: expect.stringContaining("Shift confirmed") }),
    );
  });
});

describe("DoorGigsService.generateInvoice", () => {
  function completedBooking(over: Record<string, unknown> = {}) {
    return {
      id: "door-booking-1",
      eventId: "event-1",
      profileId: "profile-1",
      fee: 750,
      travelFee: 0,
      status: "completed",
      invoice: null,
      event: {
        title: "Deep End",
        date: new Date("2020-01-01T20:00:00.000Z"),
        venueId: "venue-1",
        venue: { name: "The Vault", address: "12 Shortmarket St", lat: -33.922, lng: 18.418 },
      },
      ...over,
    };
  }

  it("bills the fee plus return travel at the platform rate", async () => {
    db.doorBooking.findUnique.mockResolvedValue(completedBooking());

    const invoice = await service().generateInvoice(doorUser, "door-booking-1");

    expect(invoice).toMatchObject({ total: expect.any(Number), status: "sent" });
    expect(db.doorInvoice.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        profileId: "profile-1",
        bookingId: "door-booking-1",
        venueId: "venue-1",
        status: "sent",
        items: {
          create: expect.arrayContaining([
            expect.objectContaining({ amount: 750 }),
            expect.objectContaining({ label: expect.stringContaining("Travel:") }),
          ]),
        },
      }),
      include: expect.anything(),
    });
    expect(db.doorBooking.update).toHaveBeenCalledWith({
      where: { id: "door-booking-1" },
      data: { travelFee: expect.any(Number) },
    });
  });

  it("needs bank details and a completed shift", async () => {
    db.doorProfile.findUnique.mockResolvedValue(profile({ bankName: null }));
    await expect(service().generateInvoice(doorUser, "door-booking-1")).rejects.toThrow(
      /bank account details/i,
    );

    db.doorProfile.findUnique.mockResolvedValue(profile());
    db.doorBooking.findUnique.mockResolvedValue(completedBooking({ status: "confirmed" }));
    await expect(service().generateInvoice(doorUser, "door-booking-1")).rejects.toThrow(
      /before it can be invoiced/,
    );
  });
});

describe("DoorGigsService.statements", () => {
  it("groups the host's shifts by month and estimates uninvoiced travel", async () => {
    db.doorProfile.findUnique.mockResolvedValue(
      profile({ user: { name: "Nomsa", email: "door@example.com" } }),
    );
    db.doorBooking.findMany.mockResolvedValue([
      {
        id: "door-booking-1",
        fee: 750,
        travelFee: 0,
        status: "completed",
        invoice: null,
        event: {
          title: "Deep End",
          date: new Date("2020-01-01T20:00:00.000Z"),
          venue: { name: "The Vault", lat: -33.922, lng: 18.418 },
        },
      },
    ]);

    const statements = await service().statements(doorUser);

    expect(statements.months).toHaveLength(1);
    expect(statements.months[0].key).toBe("2020-01");
    expect(statements.months[0].shifts[0]).toMatchObject({
      fee: 750,
      travelEstimated: true,
      invoice: null,
    });
    expect(statements.totals.shifts).toBe(1);
    expect(statements.totals.agreed).toBeGreaterThan(750);
  });
});
