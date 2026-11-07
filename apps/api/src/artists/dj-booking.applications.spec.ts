import { ConfigService } from "@nestjs/config";
import { prisma } from "@essentials/db";
import { DjBookingService } from "./dj-booking.service";
import type { NotificationsService } from "../notifications/notifications.service";
import type { JwtUser } from "../common/roles.guard";

jest.mock("@essentials/db", () => ({
  prisma: { artistBooking: { findMany: jest.fn() }, artistNote: { findMany: jest.fn() } },
}));

const bookings = (prisma as unknown as { artistBooking: { findMany: jest.Mock } }).artistBooking;
const notes = (prisma as unknown as { artistNote: { findMany: jest.Mock } }).artistNote;

const promoter: JwtUser = { sub: "promoter-1", email: "promoter@example.com", role: "promoter" };

function service() {
  return new DjBookingService(
    { deliver: jest.fn() } as unknown as NotificationsService,
    { get: () => undefined } as unknown as ConfigService,
  );
}

function application(id: string, artistId: string) {
  return {
    id,
    artistId,
    status: "pending",
    slot: "evening",
    appliedAt: new Date("2026-11-01T10:00:00.000Z"),
    artist: { id: artistId, stageName: `DJ ${artistId}`, user: { name: null, email: `${artistId}@example.com` } },
    event: { title: "MOYA", date: new Date("2026-11-20T20:00:00.000Z") },
  };
}

beforeEach(() => {
  bookings.findMany.mockReset();
  notes.findMany.mockReset();
});

describe("DjBookingService.applications", () => {
  it("attaches only the caller's note, to the DJ it belongs to", async () => {
    bookings.findMany.mockResolvedValue([application("app-1", "artist-1"), application("app-2", "artist-2")]);
    notes.findMany.mockResolvedValue([
      { id: "note-1", artistId: "artist-2", promoterId: "promoter-1", body: "Left early last time." },
    ]);

    const rows = await service().applications(promoter);

    expect(rows.find((r) => r.id === "app-1")?.note).toBeNull();
    expect(rows.find((r) => r.id === "app-2")?.note).toMatchObject({ body: "Left early last time." });
    expect(notes.findMany).toHaveBeenCalledWith({
      where: { promoterId: "promoter-1", artistId: { in: ["artist-1", "artist-2"] } },
    });
  });

  it("skips the note query entirely when there are no applications", async () => {
    bookings.findMany.mockResolvedValue([]);

    await expect(service().applications(promoter)).resolves.toEqual([]);
    expect(notes.findMany).not.toHaveBeenCalled();
  });
});
