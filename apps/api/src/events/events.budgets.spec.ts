import { ForbiddenException } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { prisma } from "@essentials/db";
import { EventsService } from "./events.service";
import type { LoyaltyService } from "../loyalty/loyalty.service";
import type { VenuesService } from "../venues/venues.service";
import type { DjBookingService } from "../artists/dj-booking.service";
import type { JwtUser } from "../common/roles.guard";

jest.mock("@essentials/db", () => ({
  prisma: { event: { findMany: jest.fn() } },
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

const events = (prisma as unknown as { event: { findMany: jest.Mock } }).event;

const promoter: JwtUser = { sub: "promoter-1", email: "p@example.com", role: "promoter" };

const service = () =>
  new EventsService(
    { get: () => undefined } as unknown as ConfigService,
    {} as LoyaltyService,
    {} as VenuesService,
    {} as DjBookingService,
  );

/** One night with `held` slots confirmed at `fee` each. */
function night(over: Record<string, unknown> = {}) {
  return {
    id: "event-1",
    title: "Amapiano Sunrise",
    date: new Date("2027-03-13T00:00:00.000Z"),
    budget: 900,
    venue: { name: "The Warehouse" },
    slots: [
      { id: "s1", fee: 495, bookings: [{ performanceFee: 495 }] },
      { id: "s2", fee: 495, bookings: [] },
      { id: "s3", fee: 495, bookings: [] },
    ],
    ...over,
  };
}

beforeEach(() => {
  events.findMany.mockReset().mockResolvedValue([night()]);
});

describe("EventsService.budgetOverview", () => {
  it("is closed to guests and door staff", async () => {
    await expect(service().budgetOverview({ sub: "g1", email: "g@example.com", role: "guest" })).rejects.toBeInstanceOf(
      ForbiddenException,
    );
    await expect(service().budgetOverview({ sub: "d1", email: "d@example.com", role: "door" })).rejects.toBeInstanceOf(
      ForbiddenException,
    );
    expect(events.findMany).not.toHaveBeenCalled();
  });

  it("counts only money promised to confirmed DJs against the ceiling", async () => {
    const overview = await service().budgetOverview(promoter);

    expect(overview.nights[0]).toMatchObject({
      budget: 900,
      committed: 495,
      remaining: 405,
      overBudget: false,
      slots: 3,
      confirmedSlots: 1,
    });
    expect(overview.totals).toEqual({
      nights: 1,
      budget: 900,
      committed: 495,
      remaining: 405,
      overBudgetNights: 0,
      unbudgetedNights: 0,
    });
  });

  it("flags a night already over its ceiling", async () => {
    events.findMany.mockResolvedValue([
      night({
        budget: 400,
        slots: [{ id: "s1", fee: 495, bookings: [{ performanceFee: 495 }] }],
      }),
    ]);

    const overview = await service().budgetOverview(promoter);

    expect(overview.nights[0]).toMatchObject({ remaining: -95, overBudget: true });
    expect(overview.totals.overBudgetNights).toBe(1);
    expect(overview.totals.remaining).toBe(-95);
  });

  it("leaves an unbudgeted night with no ceiling instead of a zero one", async () => {
    events.findMany.mockResolvedValue([
      night({ budget: 0, slots: [{ id: "s1", fee: 0, bookings: [{ performanceFee: 0 }] }] }),
    ]);

    const overview = await service().budgetOverview(promoter);

    expect(overview.nights[0]).toMatchObject({ remaining: null, overBudget: false });
    expect(overview.totals.unbudgetedNights).toBe(1);
    expect(overview.totals.budget).toBe(0);
  });

  it("scopes the query to the signed-in promoter and to upcoming nights", async () => {
    await service().budgetOverview(promoter);

    const args = events.findMany.mock.calls[0][0];
    expect(args.where).toMatchObject({ promoterId: "promoter-1" });
    expect(args.where.date.gte).toBeInstanceOf(Date);
    expect(args.where.status.in).toEqual(["approved", "live", "pending_venue_approval"]);
  });

  it("shows an admin every promoter's upcoming nights", async () => {
    await service().budgetOverview({ sub: "a1", email: "a@example.com", role: "admin" });

    expect(events.findMany.mock.calls[0][0].where).not.toHaveProperty("promoterId");
  });
});
