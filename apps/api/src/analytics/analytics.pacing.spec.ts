import { ForbiddenException } from "@nestjs/common";
import { prisma } from "@essentials/db";
import type { JwtUser } from "../common/roles.guard";
import { AnalyticsService } from "./analytics.service";

/**
 * This one runs against Postgres rather than a mocked client: pacing depends on
 * event ordering, status and per-promoter grouping, and a mock would only assert
 * the query we happened to write.
 *
 * It is skipped unless TEST_DATABASE_URL points at a database whose name ends in
 * `_test`, so a plain `npm test` never touches an application database.
 */
const testUrl = process.env.TEST_DATABASE_URL ?? "";
const databaseName = testUrl.split("?")[0].split("/").pop() ?? "";
const enabled = testUrl.length > 0 && databaseName.endsWith("_test");
const describeDb = enabled ? describe : describe.skip;

const DAY = 24 * 60 * 60 * 1000;
const at = (days: number) => new Date(Date.now() + days * DAY);

const promoter: JwtUser = { sub: "pace-promoter-1", email: "p1@example.test", role: "promoter" };
const otherPromoter: JwtUser = { sub: "pace-promoter-2", email: "p2@example.test", role: "promoter" };
const admin: JwtUser = { sub: "pace-admin", email: "admin@example.test", role: "admin" };
const artist: JwtUser = { sub: "pace-artist", email: "artist@example.test", role: "artist" };

const guests = Array.from({ length: 12 }, (_, i) => `pace-guest-${i + 1}`);

async function createEvent(o: {
  id: string;
  promoterId: string;
  title: string;
  days: number;
  status: "approved" | "live" | "draft" | "completed";
  rsvps: number;
}) {
  await prisma.event.create({
    data: {
      id: o.id,
      venueId: "pace-venue",
      promoterId: o.promoterId,
      title: o.title,
      date: at(o.days),
      capacity: 300,
      status: o.status,
      guestLists: {
        create: guests.slice(0, o.rsvps).map((userId) => ({ userId })),
      },
    },
  });
}

describeDb("AnalyticsService.pacing (database)", () => {
  beforeAll(async () => {
    await prisma.guestList.deleteMany({ where: { event: { id: { startsWith: "pace-" } } } });
    await prisma.event.deleteMany({ where: { id: { startsWith: "pace-" } } });
    await prisma.venue.deleteMany({ where: { id: "pace-venue" } });
    await prisma.user.deleteMany({ where: { id: { startsWith: "pace-" } } });

    await prisma.user.createMany({
      data: [
        { id: promoter.sub, email: promoter.email, role: "promoter" },
        { id: otherPromoter.sub, email: otherPromoter.email, role: "promoter" },
        { id: admin.sub, email: admin.email, role: "admin" },
        { id: artist.sub, email: artist.email, role: "artist" },
        ...guests.map((id, i) => ({ id, email: `guest${i + 1}@example.test`, role: "guest" as const })),
      ],
    });
    await prisma.venue.create({
      data: { id: "pace-venue", name: "Pacing Test Venue", lat: 0, lng: 0, capacity: 300 },
    });

    // promoter 1: 5 RSVPs last time, then 11 (2.2x) and 12 (1.09x).
    await createEvent({ id: "pace-p1-past", promoterId: promoter.sub, title: "Last Month", days: -10, status: "completed", rsvps: 5 });
    await createEvent({ id: "pace-p1-next", promoterId: promoter.sub, title: "Next Week", days: 3, status: "approved", rsvps: 11 });
    await createEvent({ id: "pace-p1-later", promoterId: promoter.sub, title: "Next Month", days: 10, status: "live", rsvps: 12 });
    // These must not appear: one is a draft, one already happened, one is cancelled.
    await createEvent({ id: "pace-p1-draft", promoterId: promoter.sub, title: "Unapproved", days: 20, status: "draft", rsvps: 50 });
    await createEvent({ id: "pace-p1-cancelled", promoterId: promoter.sub, title: "Cancelled", days: 25, status: "completed", rsvps: 99 });

    // promoter 2 is isolated from promoter 1 but visible to an admin.
    await createEvent({ id: "pace-p2-past", promoterId: otherPromoter.sub, title: "Their Last", days: -7, status: "completed", rsvps: 2 });
    await createEvent({ id: "pace-p2-next", promoterId: otherPromoter.sub, title: "Their Next", days: 5, status: "approved", rsvps: 4 });
  }, 30_000);

  afterAll(async () => {
    await prisma.guestList.deleteMany({ where: { event: { id: { startsWith: "pace-" } } } });
    await prisma.event.deleteMany({ where: { id: { startsWith: "pace-" } } });
    await prisma.venue.deleteMany({ where: { id: "pace-venue" } });
    await prisma.user.deleteMany({ where: { id: { startsWith: "pace-" } } });
    await prisma.$disconnect();
  });

  it("flags only upcoming approved/live events that doubled their predecessor", async () => {
    const rows = await new AnalyticsService().pacing(promoter);

    expect(rows.map((r) => r.eventId)).toEqual(["pace-p1-next", "pace-p1-later"]);
    expect(rows[0]).toMatchObject({
      title: "Next Week",
      rsvps: 11,
      previousRsvps: 5,
      ratio: 2.2,
      alert: true,
    });
    expect(rows[1]).toMatchObject({
      title: "Next Month",
      rsvps: 12,
      previousRsvps: 11,
      ratio: 1.09,
      alert: false,
    });
  }, 30_000);

  it("keeps promoters on their own events and lets an admin see every promoter's", async () => {
    const own = await new AnalyticsService().pacing(otherPromoter);
    expect(own.map((r) => r.eventId)).toEqual(["pace-p2-next"]);
    expect(own[0]).toMatchObject({ previousRsvps: 2, ratio: 2, alert: true });

    const all = await new AnalyticsService().pacing(admin);
    expect(all.map((r) => r.eventId)).toEqual(["pace-p1-next", "pace-p2-next", "pace-p1-later"]);
    expect(all.find((r) => r.eventId === "pace-p2-next")).toMatchObject({ previousRsvps: 2, alert: true });
  }, 30_000);

  it("rejects roles that do not own analytics", async () => {
    await expect(new AnalyticsService().pacing(artist)).rejects.toBeInstanceOf(ForbiddenException);
  }, 30_000);
});
