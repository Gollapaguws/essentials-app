import { NotFoundException } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { prisma } from "@essentials/db";
import { ArtistsService } from "./artists.service";
import type { JwtUser } from "../common/roles.guard";

jest.mock("@essentials/db", () => ({
  prisma: {
    artistProfile: { findUnique: jest.fn() },
    artistBlackout: { findMany: jest.fn(), upsert: jest.fn(), deleteMany: jest.fn() },
  },
}));

const db = prisma as unknown as {
  artistProfile: { findUnique: jest.Mock };
  artistBlackout: { findMany: jest.Mock; upsert: jest.Mock; deleteMany: jest.Mock };
};

const artist: JwtUser = { sub: "artist-user-1", email: "dj@example.com", role: "artist" };
const service = () => new ArtistsService({ get: () => undefined } as unknown as ConfigService);

beforeEach(() => {
  db.artistProfile.findUnique.mockReset().mockResolvedValue({ id: "artist-1", stageName: "Nova" });
  db.artistBlackout.findMany.mockReset().mockResolvedValue([]);
  db.artistBlackout.upsert.mockReset().mockResolvedValue({ id: "blackout-1", date: new Date(), reason: null });
  db.artistBlackout.deleteMany.mockReset().mockResolvedValue({ count: 1 });
});

describe("ArtistsService blackout dates", () => {
  it("blocks a day with a trimmed reason, keyed to the day", async () => {
    await service().addBlackout(artist, "2027-03-13", "  Wedding  ");

    const args = db.artistBlackout.upsert.mock.calls[0][0];
    expect(args.where.artistId_date.artistId).toBe("artist-1");
    expect(args.create.artistId).toBe("artist-1");
    expect(args.create.reason).toBe("Wedding");
    expect(args.create.date).toBeInstanceOf(Date);
  });

  it("clears an empty reason rather than storing whitespace", async () => {
    await service().addBlackout(artist, "2027-03-13", "   ");

    expect(db.artistBlackout.upsert.mock.calls[0][0].create.reason).toBeNull();
  });

  it("lists only today onwards", async () => {
    await service().blackouts(artist);

    const where = db.artistBlackout.findMany.mock.calls[0][0].where;
    expect(where.artistId).toBe("artist-1");
    expect(where.date.gte).toBeInstanceOf(Date);
  });

  it("will only remove the caller's own blackout", async () => {
    db.artistBlackout.deleteMany.mockResolvedValue({ count: 0 });

    await expect(service().removeBlackout(artist, "blackout-9")).rejects.toBeInstanceOf(NotFoundException);
    expect(db.artistBlackout.deleteMany).toHaveBeenCalledWith({
      where: { id: "blackout-9", artistId: "artist-1" },
    });
  });
});
