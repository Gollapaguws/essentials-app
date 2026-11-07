import { ForbiddenException } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { prisma } from "@essentials/db";
import { EventsService } from "./events.service";
import type { LoyaltyService } from "../loyalty/loyalty.service";
import type { VenuesService } from "../venues/venues.service";
import type { JwtUser } from "../common/roles.guard";

jest.mock("@essentials/db", () => ({
  prisma: { event: { findMany: jest.fn() } },
  EventStatus: { draft: "draft", pending_venue_approval: "pending_venue_approval", approved: "approved", live: "live", completed: "completed", cancelled: "cancelled" },
  GuestListStatus: { attending: "attending", waitlisted: "waitlisted", checked_in: "checked_in" },
}));

const events = (prisma as unknown as { event: { findMany: jest.Mock } }).event;
const promoter: JwtUser = { sub: "promoter-1", email: "p@example.com", role: "promoter" };

function service() {
  return new EventsService(
    { get: () => undefined } as unknown as ConfigService,
    {} as LoyaltyService,
    {} as VenuesService,
  );
}

function slot(id: string, fee: number, statuses: string[]) {
  return { id, label: id, fee, startsAt: new Date(), bookings: statuses.map((status) => ({ status })) };
}

beforeEach(() => events.findMany.mockReset());

describe("EventsService.listForPromoter", () => {
  it("counts confirmed and completed gigs as committed spend, not pending ones", async () => {
    events.findMany.mockResolvedValue([
      {
        id: "event-1",
        budget: 2000,
        djFeePerHour: 495,
        slots: [
          slot("slot-1", 495, ["confirmed"]),
          slot("slot-2", 495, ["completed"]),
          slot("slot-3", 495, ["pending"]),
          slot("slot-4", 495, []),
        ],
        venue: { name: "The Vault" },
        _count: { guestLists: 0, tableBookings: 0 },
      },
    ]);

    const [row] = await service().listForPromoter(promoter);

    expect(row.committed).toBe(990);
    expect(row.slots.map((s) => s.taken)).toEqual([true, true, true, false]);
    expect(row.slots.map((s) => s.confirmed)).toEqual([true, true, false, false]);
    expect(events.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { promoterId: "promoter-1" } }),
    );
  });

  it("keeps non-promoters out", async () => {
    await expect(
      service().listForPromoter({ sub: "u", email: "g@example.com", role: "guest" }),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(events.findMany).not.toHaveBeenCalled();
  });
});
