import { BadRequestException, NotFoundException } from "@nestjs/common";
import { prisma, EventStatus } from "@essentials/db";
import type { LoyaltyService } from "../loyalty/loyalty.service";
import type { VenuesService } from "../venues/venues.service";
import type { DjBookingService } from "../artists/dj-booking.service";
import { EventsService } from "./events.service";

jest.mock("@essentials/db", () => ({
  prisma: { event: { findUnique: jest.fn() } },
  EventStatus: {
    approved: "approved",
    live: "live",
    draft: "draft",
    pending_venue_approval: "pending_venue_approval",
  },
  GuestListStatus: {},
}));

const db = prisma as unknown as { event: { findUnique: jest.Mock } };

function build() {
  const announceToArtists = jest.fn().mockResolvedValue({ notified: 6 });
  const service = new EventsService(
    {} as never,
    {} as unknown as LoyaltyService,
    {} as unknown as VenuesService,
    { announceToArtists } as unknown as DjBookingService,
  );
  return { service, announceToArtists };
}

beforeEach(() => {
  db.event.findUnique.mockReset();
});

describe("EventsService.resendDjCall", () => {
  it.each(["approved", "live"])("re-sends the DJ call for a %s event", async (status) => {
    db.event.findUnique.mockResolvedValue({ id: "event-1", title: "Frequency", status });
    const { service, announceToArtists } = build();

    const result = await service.resendDjCall("event-1");

    expect(announceToArtists).toHaveBeenCalledWith("event-1");
    expect(result).toEqual({ eventId: "event-1", title: "Frequency", notified: 6 });
  });

  it("refuses an event the venue has not approved", async () => {
    db.event.findUnique.mockResolvedValue({
      id: "event-1",
      title: "Frequency",
      status: EventStatus.pending_venue_approval,
    });
    const { service, announceToArtists } = build();

    await expect(service.resendDjCall("event-1")).rejects.toBeInstanceOf(BadRequestException);
    expect(announceToArtists).not.toHaveBeenCalled();
  });

  it("reports a missing event", async () => {
    db.event.findUnique.mockResolvedValue(null);
    const { service, announceToArtists } = build();

    await expect(service.resendDjCall("nope")).rejects.toBeInstanceOf(NotFoundException);
    expect(announceToArtists).not.toHaveBeenCalled();
  });
});
