import { BadRequestException } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { prisma } from "@essentials/db";
import { ArtistsService } from "./artists.service";
import type { JwtUser } from "../common/roles.guard";
import { geocodeAddress } from "../common/geo";

jest.mock("@essentials/db", () => ({
  ArtistBookingStatus: {},
  prisma: {
    artistProfile: { findUnique: jest.fn(), update: jest.fn(), create: jest.fn() },
  },
}));

jest.mock("../common/geo", () => ({
  ...jest.requireActual("../common/geo"),
  geocodeAddress: jest.fn(),
}));

const profiles = (prisma as unknown as {
  artistProfile: { findUnique: jest.Mock; update: jest.Mock; create: jest.Mock };
}).artistProfile;
const geocode = geocodeAddress as jest.Mock;
const artist: JwtUser = { sub: "artist-user", email: "dj@example.com", role: "artist" };
const service = () => new ArtistsService({ get: () => undefined } as unknown as ConfigService);

beforeEach(() => {
  profiles.findUnique.mockReset().mockResolvedValue({ imageUrl: null, homeAddress: null });
  profiles.update.mockReset().mockImplementation(({ data }) => Promise.resolve(data));
  profiles.create.mockReset();
  geocode.mockReset();
});

describe("ArtistsService.upsertProfile home base", () => {
  it("geocodes a new address and stores the coordinates", async () => {
    geocode.mockResolvedValue({ lat: -33.9249, lng: 18.4241 });

    await service().upsertProfile(
      artist,
      { stageName: "Nandi", homeAddress: " 1 Long Street, Cape Town " },
      "https://api.example.com",
    );

    expect(geocode).toHaveBeenCalledWith("1 Long Street, Cape Town");
    expect(profiles.update).toHaveBeenCalledWith({
      where: { userId: "artist-user" },
      data: expect.objectContaining({
        homeAddress: "1 Long Street, Cape Town",
        homeLat: -33.9249,
        homeLng: 18.4241,
      }),
    });
  });

  it("keeps coordinates supplied by USE MY LOCATION without another lookup", async () => {
    await service().upsertProfile(
      artist,
      { stageName: "Nandi", homeAddress: "1 Long Street, Cape Town", homeLat: -33.9, homeLng: 18.4 },
      "https://api.example.com",
    );

    expect(geocode).not.toHaveBeenCalled();
    expect(profiles.update).toHaveBeenCalledWith({
      where: { userId: "artist-user" },
      data: expect.objectContaining({ homeLat: -33.9, homeLng: 18.4 }),
    });
  });

  it("clears the address and coordinates together", async () => {
    await service().upsertProfile(artist, { stageName: "Nandi", homeAddress: "" }, "https://api.example.com");

    expect(profiles.update).toHaveBeenCalledWith({
      where: { userId: "artist-user" },
      data: expect.objectContaining({ homeAddress: null, homeLat: null, homeLng: null }),
    });
  });

  it("refuses an address it cannot find", async () => {
    geocode.mockResolvedValue(null);

    await expect(
      service().upsertProfile(artist, { stageName: "Nandi", homeAddress: "not a real place" }, "https://api.example.com"),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(profiles.update).not.toHaveBeenCalled();
  });
});
