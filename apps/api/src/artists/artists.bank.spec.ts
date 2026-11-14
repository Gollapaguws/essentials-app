import { ConfigService } from "@nestjs/config";
import { prisma } from "@essentials/db";
import { ArtistsService } from "./artists.service";
import type { JwtUser } from "../common/roles.guard";

jest.mock("@essentials/db", () => ({
  ArtistBookingStatus: {},
  prisma: {
    artistProfile: { findUnique: jest.fn(), update: jest.fn(), create: jest.fn() },
  },
}));

const profiles = (prisma as unknown as {
  artistProfile: { findUnique: jest.Mock; update: jest.Mock; create: jest.Mock };
}).artistProfile;
const artist: JwtUser = { sub: "artist-user", email: "dj@example.com", role: "artist" };

function service() {
  return new ArtistsService({ get: () => undefined } as unknown as ConfigService);
}

beforeEach(() => {
  profiles.findUnique.mockReset();
  profiles.update.mockReset();
  profiles.create.mockReset();
});

describe("ArtistsService.upsertProfile bank details", () => {
  it("trims the payout fields and clears an empty one", async () => {
    profiles.findUnique.mockResolvedValue({ imageUrl: null });
    profiles.update.mockImplementation(({ data }) => Promise.resolve(data));

    await service().upsertProfile(
      artist,
      {
        stageName: "Nandi",
        bankAccountHolder: "  Nandi Mokoena ",
        bankName: " Capitec ",
        bankAccountNumber: " 0123456789 ",
        bankBranchCode: " 470010 ",
        bankAccountType: " ",
      },
      "https://api.example.com",
    );

    expect(profiles.update).toHaveBeenCalledWith({
      where: { userId: "artist-user" },
      data: expect.objectContaining({
        bankAccountHolder: "Nandi Mokoena",
        bankName: "Capitec",
        // Kept as text: a leading zero is part of the account number.
        bankAccountNumber: "0123456789",
        bankBranchCode: "470010",
        bankAccountType: null,
      }),
    });
  });
});
