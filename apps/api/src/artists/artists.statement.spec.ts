import {
  BadRequestException,
  ForbiddenException,
  ServiceUnavailableException,
} from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { prisma } from "@essentials/db";
import { ArtistsService, statementMonth } from "./artists.service";
import type { JwtUser } from "../common/roles.guard";

jest.mock("@essentials/db", () => ({
  prisma: {
    artistProfile: { findUnique: jest.fn() },
    artistBooking: { findMany: jest.fn(), findFirst: jest.fn() },
    event: { findMany: jest.fn() },
  },
  ArtistBookingStatus: { pending: "pending", confirmed: "confirmed", completed: "completed", cancelled: "cancelled" },
}));

const db = prisma as unknown as {
  artistProfile: { findUnique: jest.Mock };
  artistBooking: { findMany: jest.Mock; findFirst: jest.Mock };
  event: { findMany: jest.Mock };
};

const accountMail = { send: jest.fn().mockResolvedValue(true) };
const service = () =>
  new ArtistsService(
    { get: () => undefined } as unknown as ConfigService,
    accountMail as unknown as import("../account-mail/account-mail.service").AccountMailService,
  );
const response = () => ({ setHeader: jest.fn(), send: jest.fn() });

const artist: JwtUser = { sub: "artist-user", email: "dj@example.com", role: "artist" };
const promoter: JwtUser = { sub: "promoter-1", email: "p@example.com", role: "promoter" };

beforeEach(() => {
  accountMail.send.mockReset().mockResolvedValue(true);
  db.artistProfile.findUnique.mockReset();
  db.artistBooking.findMany.mockReset();
  db.artistBooking.findFirst.mockReset();
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

describe("ArtistsService.statements", () => {
  it("groups a DJ's gigs by month and totals what was agreed, billed and paid", async () => {
    db.artistProfile.findUnique.mockResolvedValue({ id: "artist-1", stageName: "DJ Nova" });
    db.artistBooking.findMany.mockResolvedValue([
      {
        id: "b1",
        startAt: new Date("2027-03-13T18:00:00.000Z"),
        slot: "20:00–21:00",
        performanceFee: 500,
        travelFee: 100,
        event: { title: "A", venue: { name: "V" } },
        invoice: { number: "INV-1", status: "paid", total: 600, payments: [] },
      },
      {
        id: "b2",
        startAt: new Date("2027-03-27T18:00:00.000Z"),
        slot: null,
        performanceFee: 400,
        travelFee: 0,
        event: { title: "B", venue: { name: "W" } },
        invoice: {
          number: "INV-2",
          status: "overdue",
          total: 400,
          payments: [{ status: "paid", amount: 150 }],
        },
      },
      {
        id: "b3",
        startAt: new Date("2027-04-02T18:00:00.000Z"),
        slot: null,
        performanceFee: 300,
        travelFee: 0,
        event: { title: "C", venue: { name: "X" } },
        invoice: null,
      },
    ]);

    const data = await service().statements(artist);

    expect(data.months.map((m) => m.key)).toEqual(["2027-04", "2027-03"]);
    const march = data.months[1];
    expect(march.agreed).toBe(1000);
    expect(march.invoiced).toBe(1000);
    expect(march.paid).toBe(750);
    expect(march.outstanding).toBe(250);
    expect(data.totals.agreed).toBe(1300);
    expect(data.totals.outstanding).toBe(550);
    expect(data.totals.gigs).toBe(3);
  });

  it("estimates travel on uninvoiced gigs from the DJ's home base", async () => {
    db.artistProfile.findUnique.mockResolvedValue({
      id: "artist-1",
      stageName: "DJ Nova",
      homeLat: -26.2041,
      homeLng: 28.0473,
      travelRatePerKm: 4.95,
    });
    db.artistBooking.findMany.mockResolvedValue([
      {
        id: "b1",
        startAt: new Date("2027-03-13T18:00:00.000Z"),
        slot: null,
        performanceFee: 500,
        travelFee: 0,
        event: {
          title: "A",
          venue: { name: "V", lat: -26.2041, lng: 28.2 },
        },
        invoice: null,
      },
    ]);

    const data = await service().statements(artist);

    const gig = data.months[0].gigs[0];
    expect(gig.travel).toBeGreaterThan(0);
    expect(gig.travelEstimated).toBe(true);
    expect(gig.agreed).toBe(500 + gig.travel);
  });

  it("keeps the billed travel once the gig is invoiced", async () => {
    db.artistProfile.findUnique.mockResolvedValue({
      id: "artist-1",
      stageName: "DJ Nova",
      homeLat: -26.2041,
      homeLng: 28.0473,
      travelRatePerKm: 4.95,
    });
    db.artistBooking.findMany.mockResolvedValue([
      {
        id: "b1",
        startAt: new Date("2027-03-13T18:00:00.000Z"),
        slot: null,
        performanceFee: 500,
        travelFee: 120,
        event: { title: "A", venue: { name: "V", lat: -26.2041, lng: 28.2 } },
        invoice: { number: "INV-1", status: "sent", total: 620, payments: [] },
      },
    ]);

    const gig = (await service().statements(artist)).months[0].gigs[0];

    expect(gig.travel).toBe(120);
    expect(gig.travelEstimated).toBe(false);
  });

  it("keeps one statement per DJ for a promoter", async () => {
    db.artistBooking.findMany.mockResolvedValue([
      {
        id: "b1",
        startAt: new Date("2027-03-13T18:00:00.000Z"),
        slot: null,
        performanceFee: 500,
        travelFee: 0,
        artist: { id: "a1", stageName: "DJ Nova", imageUrl: null },
        event: { title: "A", venue: { name: "V" } },
        invoice: null,
      },
      {
        id: "b2",
        startAt: new Date("2027-03-20T18:00:00.000Z"),
        slot: null,
        performanceFee: 400,
        travelFee: 0,
        artist: { id: "a2", stageName: "DJ Echo", imageUrl: null },
        event: { title: "B", venue: { name: "W" } },
        invoice: { number: "INV-2", status: "paid", total: 400, payments: [] },
      },
    ]);

    const data = await service().promoterStatements(promoter);

    expect(db.artistBooking.findMany.mock.calls[0][0].where).toMatchObject({
      event: { promoterId: "promoter-1" },
    });
    expect(data.djs.map((d) => d.stageName)).toEqual(["DJ Echo", "DJ Nova"]);
    expect(data.djs[0].paid).toBe(400);
    expect(data.totals.agreed).toBe(900);
    expect(data.totals.outstanding).toBe(500);
  });

  it("lets an admin see every promoter's DJ statements", async () => {
    db.artistBooking.findMany.mockResolvedValue([]);

    await service().promoterStatements({ sub: "a1", email: "a@example.com", role: "admin" });

    expect(db.artistBooking.findMany.mock.calls[0][0].where).not.toHaveProperty("event");
  });
});

describe("ArtistsService.emailStatement", () => {
  const booking = {
    startAt: new Date("2027-03-13T18:00:00.000Z"),
    slot: "20:00–21:00",
    performanceFee: 500,
    travelFee: 100,
    event: { title: "Amapiano Sunrise", venue: { name: "The Warehouse" } },
    invoice: { number: "INV-1", status: "sent", total: 600 },
  };

  function arrange() {
    db.artistProfile.findUnique.mockResolvedValue({
      id: "a1",
      stageName: "DJ Nova",
      user: { email: "dj@example.com" },
    });
    db.artistBooking.findFirst.mockResolvedValue({ id: "b1" });
    db.artistBooking.findMany.mockResolvedValue([booking]);
  }

  it("emails the DJ the month's gigs and totals", async () => {
    arrange();

    await expect(service().emailStatement(promoter, "a1", "2027-03")).resolves.toEqual({
      to: "dj@example.com",
      month: "2027-03",
      gigs: 1,
    });

    const notice = accountMail.send.mock.calls[0][1] as {
      kind: string;
      totals: Record<string, number>;
    };
    expect(notice.kind).toBe("statement");
    expect(notice.totals).toEqual({ agreed: 600, invoiced: 600, paid: 0, outstanding: 600 });
  });

  it("refuses a month it cannot parse", async () => {
    await expect(service().emailStatement(promoter, "a1", "2027-13")).rejects.toBeInstanceOf(
      BadRequestException,
    );
    expect(accountMail.send).not.toHaveBeenCalled();
  });

  it("refuses a DJ who has never played for that promoter", async () => {
    db.artistProfile.findUnique.mockResolvedValue({
      id: "a1",
      stageName: "DJ Nova",
      user: { email: "dj@example.com" },
    });
    db.artistBooking.findFirst.mockResolvedValue(null);
    await expect(service().emailStatement(promoter, "a1", "2027-03")).rejects.toBeInstanceOf(
      ForbiddenException,
    );
    expect(accountMail.send).not.toHaveBeenCalled();
  });

  it("reports a relay failure instead of claiming it was sent", async () => {
    arrange();
    accountMail.send.mockResolvedValue(false);

    await expect(service().emailStatement(promoter, "a1", "2027-03")).rejects.toBeInstanceOf(
      ServiceUnavailableException,
    );
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

  it("filters a promoter's CSV to the chosen DJ only", async () => {
    db.event.findMany.mockResolvedValue([
      {
        title: "Amapiano Sunrise",
        date: new Date("2027-03-13T00:00:00.000Z"),
        venue: { name: "The Warehouse" },
        artistBookings: [
          {
            artistId: "a1",
            slot: "20:00–21:00",
            startAt: new Date("2027-03-13T18:00:00.000Z"),
            performanceFee: 495,
            travelFee: 120,
            artist: { stageName: "DJ Nova" },
            invoice: { number: "INV-7", status: "paid", total: 615 },
          },
          {
            artistId: "a2",
            slot: "21:00–22:00",
            startAt: new Date("2027-03-13T20:00:00.000Z"),
            performanceFee: 400,
            travelFee: 0,
            artist: { stageName: "DJ Echo" },
            invoice: null,
          },
        ],
      },
    ]);
    db.artistBooking.findFirst.mockResolvedValue({ id: "b2" });
    const res = response();

    await service().statementCsv(promoter, "2027-03", res as never, "a2");

    const csv = res.send.mock.calls[0][0] as string;
    expect(csv).toContain('"DJ Echo"');
    expect(csv).not.toContain('"DJ Nova"');
    expect(res.setHeader).toHaveBeenCalledWith(
      "Content-Disposition",
      'attachment; filename="statement-dj-echo-2027-03.csv"',
    );
  });

  it("refuses a DJ who has never played for that promoter", async () => {
    db.artistBooking.findFirst.mockResolvedValue(null);
    await expect(
      service().statementCsv(promoter, "2027-03", response() as never, "stranger"),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(db.event.findMany).not.toHaveBeenCalled();
  });

  it("is closed to roles that have no money on the platform", async () => {
    await expect(
      service().statementCsv({ sub: "g1", email: "g@example.com", role: "guest" }, "2027-03", response() as never),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });
});
