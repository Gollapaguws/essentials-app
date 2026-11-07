import { EventToolsService } from "./event-tools.service";
import { prisma } from "@essentials/db";
import type { JwtUser } from "../common/roles.guard";

jest.mock("@essentials/db", () => ({
  prisma: {
    event: { findUnique: jest.fn(), create: jest.fn() },
    eventGroupChat: { findUnique: jest.fn(), create: jest.fn() },
  },
}));

const db = prisma as unknown as {
  event: { findUnique: jest.Mock; create: jest.Mock };
  eventGroupChat: { findUnique: jest.Mock; create: jest.Mock };
};

const promoter: JwtUser = { sub: "promoter-1", email: "p@example.com", role: "promoter" };

function event(over: Record<string, unknown> = {}) {
  return {
    id: "event-1",
    venueId: "venue-1",
    promoterId: "promoter-1",
    title: "Deep End",
    description: "Amapiano until late",
    date: new Date("2027-03-13T00:00:00.000Z"),
    lineup: [],
    capacity: 300,
    dressCode: null,
    ticketUrl: null,
    status: "approved",
    revenueSplitPromoterPct: 50,
    genres: [],
    djFeePerHour: 495,
    budget: 1200,
    slotCount: 3,
    slotMinutes: 60,
    slotStartMinute: 1200,
    ...over,
  };
}

beforeEach(() => {
  db.event.findUnique.mockReset().mockResolvedValue(event());
  db.event.create.mockReset().mockImplementation(({ data }) => ({ id: "event-2", ...data }));
  db.eventGroupChat.findUnique.mockReset().mockResolvedValue(null);
  db.eventGroupChat.create.mockReset().mockResolvedValue({ id: "chat-1" });
});

describe("EventToolsService.clone", () => {
  it("carries the slot plan, the hourly fee and the budget to the copy", async () => {
    await new EventToolsService().clone(promoter, "event-1");

    const data = db.event.create.mock.calls[0][0].data;
    expect(data).toMatchObject({ djFeePerHour: 495, budget: 1200, slotCount: 3, slotMinutes: 60 });
    expect(data.slots.create).toHaveLength(3);
    expect(data.slots.create[0].fee).toBe(495);
    // The copy lands a week later, and the slots move with it.
    expect(data.date.toISOString()).toBe("2027-03-20T00:00:00.000Z");
    expect(data.slots.create[0].startsAt.toISOString()).toBe("2027-03-20T20:00:00.000Z");
  });

  it("leaves legacy events, which never had slots, alone", async () => {
    db.event.findUnique.mockResolvedValue(
      event({ slotCount: null, slotMinutes: null, slotStartMinute: null }),
    );

    await new EventToolsService().clone(promoter, "event-1");

    expect(db.event.create.mock.calls[0][0].data.slots).toBeUndefined();
  });
});
