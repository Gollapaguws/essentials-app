import { prisma } from "@essentials/db";
import { SiteContentService } from "./site-content.service";

jest.mock("@essentials/db", () => ({
  prisma: {
    siteContent: { findUnique: jest.fn() },
    event: { findMany: jest.fn() },
    artistBooking: { findMany: jest.fn() },
  },
  EventStatus: { approved: "approved", live: "live" },
  ArtistBookingStatus: { confirmed: "confirmed" },
}));

const db = prisma as unknown as {
  siteContent: { findUnique: jest.Mock };
  event: { findMany: jest.Mock };
  artistBooking: { findMany: jest.Mock };
};

const row = (value: Record<string, unknown>) => ({ value, updatedAt: new Date() });

beforeEach(() => {
  db.siteContent.findUnique.mockReset().mockResolvedValue(null);
  db.event.findMany.mockReset().mockResolvedValue([]);
  db.artistBooking.findMany.mockReset().mockResolvedValue([]);
});

describe("SiteContentService.get", () => {
  const service = () => new SiteContentService();

  it("drops lineup entries whose event is gone, cancelled or in the past", async () => {
    db.siteContent.findUnique.mockResolvedValue(
      row({
        events: [
          { title: "Deep End", eventId: "live-1" },
          { title: "QA Blocked 123", eventId: "deleted-1" },
          { title: "Hand-written announcement" },
        ],
      }),
    );
    db.event.findMany.mockResolvedValue([{ id: "live-1" }]);

    const content = await service().get();
    const events = (content.events ?? []) as { title: string }[];

    expect(events.map((e) => e.title)).toEqual(["Deep End", "Hand-written announcement"]);
    const where = db.event.findMany.mock.calls[0][0].where;
    expect(where.id.in.sort()).toEqual(["deleted-1", "live-1"]);
    expect(where.status.in).toEqual(["approved", "live"]);
    expect(where.date.gte).toBeInstanceOf(Date);
  });

  it("shows confirmed DJs with the time they play", async () => {
    db.siteContent.findUnique.mockResolvedValue(
      row({ events: [{ title: "Deep End", eventId: "live-1" }, { title: "No link" }] }),
    );
    db.event.findMany.mockResolvedValue([{ id: "live-1" }]);
    db.artistBooking.findMany.mockResolvedValue([
      { eventId: "live-1", slot: "20:00-21:00", slotRef: { label: "20:00–21:00" }, artist: { stageName: "Nova" } },
      { eventId: "live-1", slot: "legacy label", slotRef: null, artist: { stageName: "Kes" } },
    ]);

    const content = await service().get();
    const [first, second] = (content.events ?? []) as unknown as Record<string, unknown>[];

    expect(first.artists).toEqual([
      { name: "Nova", time: "20:00–21:00" },
      { name: "Kes", time: "legacy label" },
    ]);
    expect(second).not.toHaveProperty("artists");
    expect(db.artistBooking.findMany.mock.calls[0][0].where).toEqual({
      eventId: { in: ["live-1"] },
      status: "confirmed",
    });
  });

  it("shows an event id at most once", async () => {
    db.siteContent.findUnique.mockResolvedValue(
      row({ events: [{ title: "Deep End", eventId: "live-1" }, { title: "Deep End", eventId: "live-1" }] }),
    );
    db.event.findMany.mockResolvedValue([{ id: "live-1" }]);

    const content = await service().get();

    expect(content.events).toHaveLength(1);
  });

  it("does not query events when every entry is hand-written", async () => {
    db.siteContent.findUnique.mockResolvedValue(row({ events: [{ title: "DATES TBA" }] }));

    const content = await service().get();

    expect(content.events).toEqual([{ title: "DATES TBA" }]);
    expect(db.event.findMany).not.toHaveBeenCalled();
  });

  it("keeps a scheduled drop hidden without querying events", async () => {
    db.siteContent.findUnique.mockResolvedValue(
      row({
        lineupPublishAt: new Date(Date.now() + 86_400_000).toISOString(),
        events: [{ title: "Deep End", eventId: "live-1" }],
      }),
    );

    const content = await service().get();

    expect(content.events).toEqual([]);
    expect(db.event.findMany).not.toHaveBeenCalled();
  });

  it("returns empty content when nothing has been saved", async () => {
    const content = await service().get();

    expect(content).toEqual({ updatedAt: null });
    expect(db.event.findMany).not.toHaveBeenCalled();
  });
});
