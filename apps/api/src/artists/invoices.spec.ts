import { BadRequestException } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { prisma } from "@essentials/db";
import { InvoicesService } from "./invoices.service";
import type { JwtUser } from "../common/roles.guard";

jest.mock("@essentials/db", () => ({
  prisma: {
    artistProfile: { findUnique: jest.fn() },
    artistBooking: { findMany: jest.fn() },
    invoice: { create: jest.fn() },
  },
  InvoiceStatus: { draft: "draft", sent: "sent", paid: "paid", overdue: "overdue" },
  PaymentStatus: { pending: "pending", paid: "paid", failed: "failed" },
}));

const profiles = (prisma as unknown as { artistProfile: { findUnique: jest.Mock } }).artistProfile;
const bookings = (prisma as unknown as { artistBooking: { findMany: jest.Mock } }).artistBooking;
const invoices = (prisma as unknown as { invoice: { create: jest.Mock } }).invoice;

const artist: JwtUser = { sub: "user-1", email: "dj@example.com", role: "artist" };

function service() {
  return new InvoicesService({ get: () => undefined } as unknown as ConfigService);
}

function completed(over: Record<string, unknown> = {}) {
  return {
    id: "booking-1",
    performanceFee: 750,
    startAt: new Date("2027-03-13T20:00:00.000Z"),
    endAt: new Date("2027-03-13T21:30:00.000Z"),
    event: { venueId: "venue-1", title: "Deep End", venue: { name: "The Vault" } },
    ...over,
  };
}

beforeEach(() => {
  profiles.findUnique.mockReset();
  bookings.findMany.mockReset();
  invoices.create.mockReset();
  profiles.findUnique.mockResolvedValue({ id: "artist-1", stageName: "Nandi", travelRatePerKm: 4.95 });
  invoices.create.mockImplementation(({ data }) => Promise.resolve({ id: "inv-1", ...data }));
});

describe("InvoicesService.generate", () => {
  it("only bills completed, uninvoiced gigs", async () => {
    bookings.findMany.mockResolvedValue([completed()]);

    await service().generate(artist);

    expect(bookings.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ status: "completed", invoice: { is: null } }),
      }),
    );
  });

  it("invoices the venue for the stipulated fee, tied to the completed booking", async () => {
    bookings.findMany.mockResolvedValue([completed()]);

    await service().generate(artist, ["booking-1"]);

    const data = invoices.create.mock.calls[0][0].data;
    expect(data).toMatchObject({
      artistId: "artist-1",
      bookingId: "booking-1",
      venueId: "venue-1",
      total: 750,
      status: "sent",
    });
    // 90 minutes at the hourly rate, billed as the agreed amount — no travel line
    // is added on top of the stipulated fee.
    expect(data.items.create).toEqual([{ label: expect.stringContaining("1.5h performance"), amount: 750 }]);
  });

  it("refuses to bundle gigs: each venue pays for its own night", async () => {
    await expect(service().generate(artist, ["a", "b"])).rejects.toBeInstanceOf(BadRequestException);
    expect(bookings.findMany).not.toHaveBeenCalled();
  });

  it("explains the completion gate when nothing is billable", async () => {
    bookings.findMany.mockResolvedValue([]);

    await expect(service().generate(artist)).rejects.toThrow(/promoter confirms a gig was played/);
  });

  it("refuses a gig with no agreed fee", async () => {
    bookings.findMany.mockResolvedValue([completed({ performanceFee: 0 })]);

    await expect(service().generate(artist)).rejects.toThrow(/no agreed fee/);
    expect(invoices.create).not.toHaveBeenCalled();
  });
});
