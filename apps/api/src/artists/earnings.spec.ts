import { BadRequestException } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { prisma } from "@essentials/db";
import { ROLES_KEY } from "../common/roles.decorator";
import { ArtistsController } from "./artists.controller";
import { ArtistsService } from "./artists.service";
import type { JwtUser } from "../common/roles.guard";

jest.mock("@essentials/db", () => ({
  prisma: {
    artistProfile: { findUnique: jest.fn() },
    artistBooking: { findMany: jest.fn() },
  },
}));

const db = prisma as unknown as {
  artistProfile: { findUnique: jest.Mock };
  artistBooking: { findMany: jest.Mock };
};

const dj: JwtUser = { sub: "user-1", email: "dj@example.com", role: "artist" };
const service = () => new ArtistsService({ get: () => undefined } as unknown as ConfigService);

function gig(fee: number, invoice: { status: string; total: number } | null) {
  return {
    id: `gig-${fee}-${invoice?.status ?? "none"}`,
    startAt: new Date("2026-11-01T20:00:00Z"),
    completedAt: new Date("2026-11-02T00:30:00Z"),
    performanceFee: fee,
    event: { title: "Night Shift", venue: { name: "The Vault" } },
    invoice: invoice ? { id: "inv-1", number: "ESS-2026-ABC123", ...invoice } : null,
  };
}

beforeEach(() => {
  db.artistProfile.findUnique.mockReset().mockResolvedValue({ id: "artist-1" });
  db.artistBooking.findMany.mockReset().mockResolvedValue([]);
});

describe("ArtistsService.earnings", () => {
  it("is the DJ's own money view, for artists and admins only", () => {
    expect(Reflect.getMetadata(ROLES_KEY, ArtistsController.prototype.earnings)).toEqual(["artist", "admin"]);
  });

  it("splits completed fees into billed-but-unpaid and not-yet-billed", async () => {
    db.artistBooking.findMany.mockResolvedValue([
      gig(495, { status: "sent", total: 495 }),
      gig(300, null),
    ]);

    const view = await service().earnings(dj);

    expect(view.totals).toEqual({
      earned: 795,
      invoiced: 495,
      paid: 0,
      readyToInvoice: 300,
      readyToInvoiceCount: 1,
      awaitingPayment: 495,
      awaitingPaymentCount: 1,
      outstanding: 795,
      gigs: 2,
    });
    expect(view.gigs[0]).toMatchObject({ eventTitle: "Night Shift", venue: "The Vault", fee: 495 });
    expect(db.artistBooking.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { artistId: "artist-1", status: "completed" } }),
    );
  });

  it("counts paid invoices as collected, not outstanding", async () => {
    db.artistBooking.findMany.mockResolvedValue([
      gig(495, { status: "paid", total: 495 }),
      gig(495, null),
    ]);

    const { totals } = await service().earnings(dj);

    expect(totals).toMatchObject({ earned: 990, invoiced: 495, paid: 495, outstanding: 495 });
    expect(totals.awaitingPayment).toBe(0);
  });

  it("does not count travel as earnings — the venue pays the stipulated fee only", async () => {
    db.artistBooking.findMany.mockResolvedValue([
      { ...gig(495, { status: "paid", total: 495 }), travelFee: 320 },
    ]);

    const { totals } = await service().earnings(dj);

    expect(totals.earned).toBe(495);
    expect(totals.invoiced).toBe(495);
  });

  it("is zero, not an error, for a DJ who has not played yet", async () => {
    const view = await service().earnings(dj);

    expect(view.gigs).toEqual([]);
    expect(view.totals).toMatchObject({ earned: 0, invoiced: 0, paid: 0, outstanding: 0, gigs: 0 });
  });

  it("asks for a profile before showing money", async () => {
    db.artistProfile.findUnique.mockResolvedValue(null);

    await expect(service().earnings(dj)).rejects.toBeInstanceOf(BadRequestException);
  });
});
