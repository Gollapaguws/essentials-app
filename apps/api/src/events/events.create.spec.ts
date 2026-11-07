import { ConfigService } from "@nestjs/config";
import { prisma, EventStatus } from "@essentials/db";
import type { JwtUser } from "../common/roles.guard";
import type { LoyaltyService } from "../loyalty/loyalty.service";
import type { VenuesService } from "../venues/venues.service";
import { EventsService } from "./events.service";

jest.mock("@essentials/db", () => ({
  prisma: {
    venue: { findUnique: jest.fn() },
    event: { create: jest.fn() },
    eventGroupChat: { create: jest.fn() },
  },
  EventStatus: {
    approved: "approved",
    pending_venue_approval: "pending_venue_approval",
  },
  GuestListStatus: {},
}));

const promoter = { sub: "promoter-user", role: "promoter", email: "promoter@example.com" } as JwtUser;

const db = prisma as unknown as {
  venue: { findUnique: jest.Mock };
  event: { create: jest.Mock };
  eventGroupChat: { create: jest.Mock };
};

function build() {
  const announceApproval = jest.fn();
  const service = new EventsService(
    { get: () => undefined } as unknown as ConfigService,
    {} as unknown as LoyaltyService,
    { announceApproval } as unknown as VenuesService,
  );
  return { service, announceApproval };
}

const input = {
  venueId: "venue-1",
  title: "Deep End",
  date: "2026-12-31T22:00:00.000Z",
  capacity: 150,
};

beforeEach(() => {
  db.venue.findUnique.mockReset();
  db.event.create.mockReset();
  db.eventGroupChat.create.mockReset();
  db.eventGroupChat.create.mockResolvedValue({});
  db.event.create.mockImplementation(({ data }: { data: Record<string, unknown> }) => ({
    id: "event-1",
    ...data,
  }));
});

describe("EventsService.create approval", () => {
  it("approves the event and calls the DJ roster when the promoter manages the venue", async () => {
    db.venue.findUnique.mockResolvedValue({ id: "venue-1", capacity: 200, managerId: promoter.sub });
    const { service, announceApproval } = build();

    const created = await service.create(promoter, input);

    expect(created).toMatchObject({ status: EventStatus.approved });
    expect(announceApproval).toHaveBeenCalledTimes(1);
    expect(announceApproval.mock.calls[0][0]).toMatchObject({ id: "event-1", venueId: "venue-1" });
  });

  it("still waits for the venue's approval when someone else manages it", async () => {
    db.venue.findUnique.mockResolvedValue({ id: "venue-1", capacity: 200, managerId: "other-manager" });
    const { service, announceApproval } = build();

    const created = await service.create(promoter, input);

    expect(created).toMatchObject({ status: EventStatus.pending_venue_approval });
    expect(announceApproval).not.toHaveBeenCalled();
  });

  it("does not call the roster when the capacity cap rejects the event", async () => {
    db.venue.findUnique.mockResolvedValue({ id: "venue-1", capacity: 100, managerId: promoter.sub });
    const { service, announceApproval } = build();

    await expect(service.create(promoter, { ...input, capacity: 150 })).rejects.toThrow(
      "Capacity exceeds venue max (100)",
    );
    expect(db.event.create).not.toHaveBeenCalled();
    expect(announceApproval).not.toHaveBeenCalled();
  });
});
