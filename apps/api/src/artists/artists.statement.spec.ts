import { BadRequestException, ForbiddenException } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { prisma } from "@essentials/db";
import { ArtistsService, statementMonth } from "./artists.service";
import type { JwtUser } from "../common/roles.guard";

jest.mock("@essentials/db", () => ({
  prisma: {
    artistProfile: { findUnique: jest.fn() },
    artistBooking: { findMany: jest.fn() },
    event: { findMany: jest.fn() },
  },
  ArtistBookingStatus: { pending: "pending", confirmed: "confirmed", completed: "completed", cancelled: "cancelled" },
}));

const db = prisma as unknown as {
  artistProfile: { findUnique: jest.Mock };
  artistBooking: { findMany: jest.Mock };
  event: { findMany: jest.Mock };
};

const service = () => new ArtistsService({ get: () => undefined } as unknown as ConfigService);
const response = () => ({ setHeader: jest.fn(), send: jest.fn() });

const artist: JwtUser = { sub: "artist-user", email: "dj@example.com", role: "artist" };
const promoter: JwtUser = { sub: "promoter-1", email: "p@example.com", role: "promoter" };

beforeEach(() => {
  db.artistProfile.findUnique.mockReset();
  db.artistBooking.findMany.mockReset();
  db.event.findMany.mockReset();
});

describe("statementMonth", () => {
  it("covers exactly one UTC month", () => {
    const range = statementMonth("2027-03");
    expect(range?.key).toBe("2027-03");
    expect(range?.start.toISOString()).toBe("2027-03-01T00:00:00.000Z");
    expect(range?.end.toISOString()).toBe("2027-04-01T00:00:00.000Z");
  });

  it("turns over the year at December", () => {
    expect(statementMonth("2027-12")?.end.toISOString()).toBe("2028-01-01T00:00:00.000Z");
  });

  it("refuses anything that is not a real month", () => {
    expect(statementMonth("2027-13")).toBeNull();
    expect(statementMonth("2027-3")).toBeNull();
    expect(statementMonth("March")).toBeNull();
    expect(statementMonth(undefined)).toBeNull();
  });
});

describe("ArtistsService.statementCsv", () => {
  it("refuses a month it cannot parse instead of billing the wrong period", async () => {
    await expect(service().statementCsv(promoter, "2027-13", response() as never)).rejects.toBeInstanceOf(
      BadRequestException,
    );
    expect(db.event.findMany).not.toHaveBeenCalled();
  });

  it("gives a DJ their own gigs for the month with fees, travel and invoice state", async () => {
    db.artistProfile.findUnique.mockResolvedValue({ id: "artist-1", stageName: "DJ Nova" });
    db.artistBooking.findMany.mockResolvedValue([
      {
        slot: "20:00–21:00",
        startAt: new Date("2027-03-13T18:00:00.000Z"),
        performanceFee: 495,
        travelFee: 120,
        event: { title: "Amapiano Sunrise", venue: { name: "The Warehouse" } },
        invoice: { number: "INV-7", status: "paid", total: 615 },
      },
      {
        slot: "21:00–22:00",
        startAt: new Date("2027-03-20T18:00:00.000Z"),
        performanceFee: 495,
        travelFee: 0,
        event: { title: "Deep House Night", venue: { name: "Basement" } },
        invoice: null,
      },
    ]);
    const res = response();

    await service().statementCsv(artist, "2027-03", res as never);

    const csv = res.send.mock.calls[0][0] as string;
    const [header, first, second, total] = csv.split("\n");
    expect(header).toBe("date,night,venue,dj,slot,fee,travel,invoice_number,invoice_status,invoiced,paid");
    expect(first).toBe('2027-03-13,"Amapiano Sunrise","The Warehouse","DJ Nova","20:00–21:00",495,120,"INV-7","paid",615,615');
    expect(second).toContain('"not invoiced"');
    expect(total).toBe("TOTAL,,,,,990,120,,,615,615");
    expect(res.setHeader).toHaveBeenCalledWith("Content-Type", "text/csv; charset=utf-8");
    expect(res.setHeader).toHaveBeenCalledWith(
      "Content-Disposition",
      'attachment; filename="statement-2027-03.csv"',
    );
  });

  it("asks the DJ to create a profile rather than sending an empty statement", async () => {
    db.artistProfile.findUnique.mockResolvedValue(null);

    await expect(service().statementCsv(artist, "2027-03", response() as never)).rejects.toThrow(
      /artist profile/i,
    );
  });

  it("gives a promoter every gig at their own nights", async () => {
    db.event.findMany.mockResolvedValue([
      {
        title: "Amapiano Sunrise",
        date: new Date("2027-03-13T00:00:00.000Z"),
        venue: { name: "The Warehouse" },
        artistBookings: [
          {
            slot: "20:00–21:00",
            startAt: new Date("2027-03-13T18:00:00.000Z"),
            performanceFee: 495,
            travelFee: 120,
            artist: { stageName: "DJ Nova" },
            invoice: { number: "INV-7", status: "overdue", total: 615 },
          },
        ],
      },
    ]);
    const res = response();

    await service().statementCsv(promoter, "2027-03", res as never);

    expect(db.event.findMany.mock.calls[0][0].where).toMatchObject({ promoterId: "promoter-1" });
    const [, row] = (res.send.mock.calls[0][0] as string).split("\n");
    expect(row).toContain('"DJ Nova"');
    expect(row).toContain('"overdue"');
  });

  it("scopes an admin's statement to every promoter's nights", async () => {
    db.event.findMany.mockResolvedValue([]);
    const res = response();

    await service().statementCsv({ sub: "a1", email: "a@example.com", role: "admin" }, "2027-03", res as never);

    expect(db.event.findMany.mock.calls[0][0].where).not.toHaveProperty("promoterId");
    expect(res.send.mock.calls[0][0]).toContain("TOTAL,,,,,0,0,,,0,0");
  });

  it("is closed to roles that have no money on the platform", async () => {
    await expect(
      service().statementCsv({ sub: "g1", email: "g@example.com", role: "guest" }, "2027-03", response() as never),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });
});
