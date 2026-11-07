import { BadRequestException, ForbiddenException, NotFoundException } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { prisma } from "@essentials/db";
import { DjBookingService } from "./dj-booking.service";
import type { NotificationsService } from "../notifications/notifications.service";
import type { JwtUser } from "../common/roles.guard";

jest.mock("@essentials/db", () => ({
  prisma: { artistBooking: { findUnique: jest.fn(), update: jest.fn() } },
}));

const bookings = (prisma as unknown as {
  artistBooking: { findUnique: jest.Mock; update: jest.Mock };
}).artistBooking;

const deliver = jest.fn();
const promoter: JwtUser = { sub: "promoter-1", email: "promoter@example.com", role: "promoter" };
const otherPromoter: JwtUser = { sub: "promoter-2", email: "other@example.com", role: "promoter" };

function service() {
  return new DjBookingService(
    { deliver } as unknown as NotificationsService,
    { get: () => undefined } as unknown as ConfigService,
  );
}

function booking(over: Record<string, unknown> = {}) {
  return {
    id: "booking-1",
    status: "confirmed",
    slot: "20:00–21:00",
    performanceFee: 500,
    startAt: new Date("2027-03-13T20:00:00.000Z"),
    endAt: new Date("2027-03-13T21:00:00.000Z"),
    event: {
      title: "Deep End",
      promoterId: "promoter-1",
      venue: { name: "The Vault", managerId: "venue-1" },
    },
    artist: { userId: "artist-user-1" },
    ...over,
  };
}

beforeEach(() => {
  bookings.findUnique.mockReset();
  bookings.update.mockReset();
  deliver.mockReset();
});

describe("DjBookingService.confirmCompleted", () => {
  it("marks a played gig complete and notifies the DJ that invoicing is open", async () => {
    bookings.findUnique.mockResolvedValue(
      booking({ endAt: new Date(Date.now() - 3_600_000) }),
    );
    bookings.update.mockResolvedValue({ id: "booking-1", status: "completed" });

    await service().confirmCompleted(promoter, "booking-1");

    expect(bookings.update).toHaveBeenCalledWith({
      where: { id: "booking-1" },
      data: { status: "completed", completedAt: expect.any(Date) },
    });
    expect(deliver).toHaveBeenCalledWith(
      ["artist-user-1"],
      expect.objectContaining({ title: expect.stringContaining("Gig confirmed") }),
    );
  });

  it("refuses before the set has ended", async () => {
    bookings.findUnique.mockResolvedValue(
      booking({ endAt: new Date(Date.now() + 3_600_000) }),
    );

    await expect(service().confirmCompleted(promoter, "booking-1")).rejects.toBeInstanceOf(BadRequestException);
    expect(bookings.update).not.toHaveBeenCalled();
  });

  it("only completes a confirmed gig", async () => {
    bookings.findUnique.mockResolvedValue(
      booking({ status: "pending", endAt: new Date(Date.now() - 1_000) }),
    );

    await expect(service().confirmCompleted(promoter, "booking-1")).rejects.toBeInstanceOf(BadRequestException);
  });

  it("is idempotent for an already-completed gig", async () => {
    bookings.findUnique.mockResolvedValue(booking({ status: "completed" }));

    await service().confirmCompleted(promoter, "booking-1");

    expect(bookings.update).not.toHaveBeenCalled();
    expect(deliver).not.toHaveBeenCalled();
  });

  it("keeps other promoters and non-managers out", async () => {
    bookings.findUnique.mockResolvedValue(booking({ endAt: new Date(Date.now() - 1_000) }));

    await expect(service().confirmCompleted(otherPromoter, "booking-1")).rejects.toBeInstanceOf(ForbiddenException);
    await expect(
      service().confirmCompleted({ ...otherPromoter, role: "guest" }, "booking-1"),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it("lets the venue's manager confirm the night they hosted", async () => {
    bookings.findUnique.mockResolvedValue(booking({ endAt: new Date(Date.now() - 1_000) }));
    bookings.update.mockResolvedValue({ id: "booking-1", status: "completed" });

    await service().confirmCompleted(
      { sub: "venue-1", email: "venue@example.com", role: "venue_manager" },
      "booking-1",
    );

    expect(bookings.update).toHaveBeenCalled();
  });

  it("404s for an unknown booking", async () => {
    bookings.findUnique.mockResolvedValue(null);
    await expect(service().confirmCompleted(promoter, "nope")).rejects.toBeInstanceOf(NotFoundException);
  });
});
