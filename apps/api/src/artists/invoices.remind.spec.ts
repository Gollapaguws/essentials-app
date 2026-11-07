import { BadRequestException, ForbiddenException } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { prisma } from "@essentials/db";
import { InvoicesService } from "./invoices.service";
import type { NotificationsService } from "../notifications/notifications.service";
import type { JwtUser } from "../common/roles.guard";

jest.mock("@essentials/db", () => ({ prisma: { invoice: { findUnique: jest.fn() } } }));

const db = prisma as unknown as { invoice: { findUnique: jest.Mock } };
const deliver = jest.fn();
const artist: JwtUser = { sub: "artist-user-1", email: "dj@example.com", role: "artist" };

const service = () =>
  new InvoicesService(
    { get: () => "https://essentialsedm.com" } as unknown as ConfigService,
    { deliver } as unknown as NotificationsService,
  );

function invoice(over: Record<string, unknown> = {}) {
  return {
    id: "inv-1",
    number: "ESS-2027-ABC123",
    status: "sent",
    total: 495,
    artist: { stageName: "Nova", user: { email: "dj@example.com" } },
    venue: { name: "The Vault", managerId: "venue-user-1" },
    ...over,
  };
}

beforeEach(() => {
  db.invoice.findUnique.mockReset().mockResolvedValue(invoice());
  deliver.mockReset().mockResolvedValue({ delivered: 2, channels: { inapp: 1, email: 1, telegram: 0 } });
});

describe("InvoicesService.remind", () => {
  it("reminds the venue manager, not the DJ", async () => {
    const result = await service().remind(artist, "inv-1");

    expect(deliver).toHaveBeenCalledWith(
      ["venue-user-1"],
      expect.objectContaining({
        title: "Invoice ESS-2027-ABC123 is due",
        body: expect.stringContaining("R495"),
        channels: ["inapp", "email"],
      }),
    );
    expect(result.invoice).toMatchObject({ number: "ESS-2027-ABC123", total: 495 });
  });

  it("keeps other DJs out of someone else's invoice", async () => {
    await expect(
      service().remind({ ...artist, email: "other@example.com" }, "inv-1"),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(deliver).not.toHaveBeenCalled();
  });

  it("does not chase an invoice that is already paid", async () => {
    db.invoice.findUnique.mockResolvedValue(invoice({ status: "paid" }));

    await expect(service().remind(artist, "inv-1")).rejects.toBeInstanceOf(BadRequestException);
    expect(deliver).not.toHaveBeenCalled();
  });

  it("says so when the venue has no manager to remind", async () => {
    db.invoice.findUnique.mockResolvedValue(invoice({ venue: { name: "The Vault", managerId: null } }));

    await expect(service().remind(artist, "inv-1")).rejects.toThrow(/no manager/);
  });
});
