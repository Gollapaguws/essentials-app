import { ConfigService } from "@nestjs/config";
import { prisma } from "@essentials/db";
import { ArtistsService, icsCalendar } from "./artists.service";
import type { JwtUser } from "../common/roles.guard";

jest.mock("@essentials/db", () => ({
  prisma: {
    event: { findMany: jest.fn() },
    artistProfile: { findUnique: jest.fn() },
    artistBooking: { findMany: jest.fn() },
  },
}));

const db = prisma as unknown as {
  event: { findMany: jest.Mock };
  artistProfile: { findUnique: jest.Mock };
  artistBooking: { findMany: jest.Mock };
};

const promoter: JwtUser = { sub: "promoter-1", email: "p@example.com", role: "promoter" };

const service = () =>
  new ArtistsService({ get: () => undefined } as unknown as ConfigService);

beforeEach(() => {
  db.event.findMany.mockReset();
  db.artistProfile.findUnique.mockReset();
  db.artistBooking.findMany.mockReset();
});

describe("ArtistsService.settlements", () => {
  it("adds up what is agreed, billed, paid and still out", async () => {
    db.event.findMany.mockResolvedValue([
      {
        id: "event-1",
        title: "Deep End",
        date: new Date("2027-03-13T00:00:00.000Z"),
        budget: 900,
        venue: { name: "The Vault" },
        artistBookings: [
          {
            id: "b1",
            slot: "20:00–21:00",
            startAt: new Date("2027-03-13T20:00:00.000Z"),
            status: "confirmed",
            performanceFee: 495,
            completedAt: null,
            artist: { stageName: "Nova" },
            invoice: null,
          },
          {
            id: "b2",
            slot: "21:00–22:00",
            startAt: new Date("2027-03-13T21:00:00.000Z"),
            status: "completed",
            performanceFee: 495,
            completedAt: new Date("2027-03-14T00:00:00.000Z"),
            artist: { stageName: "Kai" },
            invoice: {
              id: "inv-1",
              number: "ESS-2027-ABC123",
              status: "sent",
              total: 495,
              payments: [{ status: "paid", amount: 200 }],
            },
          },
        ],
      },
    ]);

    const result = await service().settlements(promoter);

    expect(result.events[0]).toMatchObject({
      committed: 990,
      invoiced: 495,
      paid: 200,
      outstanding: 790,
      overBudget: true,
    });
    expect(result.totals).toMatchObject({
      committed: 990,
      invoiced: 495,
      paid: 200,
      outstanding: 790,
      nights: 1,
    });
    // Only agreed money is a settlement: pending and cancelled applications are not queried.
    expect(db.event.findMany.mock.calls[0][0].select.artistBookings.where).toEqual({
      status: { in: ["confirmed", "completed"] },
    });
  });

  it("counts a paid invoice at its full total, not just its payment rows", async () => {
    db.event.findMany.mockResolvedValue([
      {
        id: "event-1",
        title: "Deep End",
        date: new Date(),
        budget: 0,
        venue: { name: "The Vault" },
        artistBookings: [
          {
            id: "b1",
            slot: null,
            startAt: new Date(),
            status: "completed",
            performanceFee: 300,
            completedAt: new Date(),
            artist: { stageName: "Nova" },
            invoice: { id: "inv-1", number: "ESS-1", status: "paid", total: 300, payments: [] },
          },
        ],
      },
    ]);

    const result = await service().settlements(promoter);

    expect(result.events[0]).toMatchObject({ paid: 300, outstanding: 0, overBudget: false });
  });
});

describe("icsCalendar", () => {
  it("writes UTC events with escaped text", () => {
    const ics = icsCalendar(
      [
        {
          uid: "booking-1",
          start: new Date("2027-03-13T20:00:00.000Z"),
          end: new Date("2027-03-13T21:00:00.000Z"),
          summary: "Deep End, Vol. 2",
          location: "The Vault; Cape Town",
          description: "20:00–21:00 · fee R495",
        },
      ],
      new Date("2027-03-01T00:00:00.000Z"),
    );

    expect(ics).toContain("BEGIN:VCALENDAR");
    expect(ics).toContain("UID:booking-1@essentialsedm.com");
    expect(ics).toContain("DTSTART:20270313T200000Z");
    expect(ics).toContain("DTEND:20270313T210000Z");
    expect(ics).toContain("SUMMARY:Deep End\\, Vol. 2");
    expect(ics).toContain("LOCATION:The Vault\\; Cape Town");
    expect(ics.trim().endsWith("END:VCALENDAR")).toBe(true);
  });
});
