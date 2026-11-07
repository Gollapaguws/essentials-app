import { NotFoundException } from "@nestjs/common";
import { prisma } from "@essentials/db";
import { PublicEventsService } from "./public-events.service";

jest.mock("@essentials/db", () => ({
  prisma: { event: { findMany: jest.fn(), findFirst: jest.fn() } },
  EventStatus: { approved: "approved", live: "live", draft: "draft" },
}));

const db = prisma as unknown as {
  event: { findMany: jest.Mock; findFirst: jest.Mock };
};

function event(over: Record<string, unknown> = {}) {
  return {
    id: "event-1",
    title: "Deep End",
    description: "Basement techno.",
    date: new Date("2027-03-13T20:00:00.000Z"),
    lineup: [{ artistName: "Nova", slot: "20:00–21:00" }],
    capacity: 300,
    dressCode: "No caps",
    ticketUrl: "https://tickets.example.com/deep-end",
    status: "approved",
    venue: { name: "The Vault", address: "12 Long St, Cape Town" },
    _count: { guestLists: 184 },
    ...over,
  };
}

beforeEach(() => {
  db.event.findMany.mockReset().mockResolvedValue([event()]);
  db.event.findFirst.mockReset().mockResolvedValue(event());
});

describe("PublicEventsService", () => {
  const service = () => new PublicEventsService();

  it("lists only announced nights that have not happened yet", async () => {
    const rows = await service().list();

    const where = db.event.findMany.mock.calls[0][0].where;
    expect(where.status.in).toEqual(["approved", "live"]);
    expect(where.date.gte).toBeInstanceOf(Date);
    expect(rows[0]).toMatchObject({ title: "Deep End", going: 184, status: "approved" });
  });

  it("never exposes promoter or guest data on a public event", async () => {
    const [row] = await service().list();

    expect(row).not.toHaveProperty("promoter");
    expect(row).not.toHaveProperty("guestLists");
    expect(row).not.toHaveProperty("budget");
    expect(Object.keys(row).sort()).toEqual(
      [
        "capacity",
        "date",
        "description",
        "dressCode",
        "going",
        "id",
        "lineup",
        "status",
        "ticketUrl",
        "title",
        "venue",
      ].sort(),
    );
  });

  it("serves a single announced night", async () => {
    const row = await service().detail("event-1");

    expect(db.event.findFirst.mock.calls[0][0].where).toMatchObject({ id: "event-1" });
    expect(row).toMatchObject({ venue: { name: "The Vault" }, ticketUrl: "https://tickets.example.com/deep-end" });
  });

  it("hides drafts, cancelled and unknown ids behind a 404", async () => {
    db.event.findFirst.mockResolvedValue(null);

    await expect(service().detail("draft-event")).rejects.toBeInstanceOf(NotFoundException);
  });
});
