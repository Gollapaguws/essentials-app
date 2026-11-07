import { prisma } from "@essentials/db";
import { ROLES_KEY } from "../common/roles.decorator";
import { ArtistsController } from "./artists.controller";
import { ArtistsService } from "./artists.service";
import { ConfigService } from "@nestjs/config";

jest.mock("@essentials/db", () => ({
  prisma: { artistProfile: { updateMany: jest.fn(), findMany: jest.fn() } },
}));

const profiles = (
  prisma as unknown as {
    artistProfile: { updateMany: jest.Mock; findMany: jest.Mock };
  }
).artistProfile;

const service = () => new ArtistsService({ get: () => undefined } as unknown as ConfigService);

beforeEach(() => {
  profiles.updateMany.mockReset();
  profiles.findMany.mockReset();
});

describe("standard travel rate", () => {
  it("is admin-only, for reading and for writing", () => {
    expect(Reflect.getMetadata(ROLES_KEY, ArtistsController.prototype.setTravelRate)).toEqual(["admin"]);
    expect(Reflect.getMetadata(ROLES_KEY, ArtistsController.prototype.travelRate)).toEqual(["admin"]);
  });

  it("updates every DJ's profile and reports how many were touched", async () => {
    profiles.updateMany.mockResolvedValue({ count: 7 });

    await expect(service().setStandardTravelRate(4.95)).resolves.toEqual({
      travelRatePerKm: 4.95,
      artists: 7,
      mixed: false,
    });
    expect(profiles.updateMany).toHaveBeenCalledWith({ data: { travelRatePerKm: 4.95 } });
  });

  it("reads back the rate the profiles are actually on", async () => {
    profiles.findMany.mockResolvedValue([
      { travelRatePerKm: 4.95 },
      { travelRatePerKm: 4.95 },
      { travelRatePerKm: 4.95 },
    ]);

    await expect(service().standardTravelRate()).resolves.toEqual({
      travelRatePerKm: 4.95,
      artists: 3,
      mixed: false,
    });
  });

  it("flags a profile left on an older rate, and shows the majority rate", async () => {
    profiles.findMany.mockResolvedValue([
      { travelRatePerKm: 4.95 },
      { travelRatePerKm: 4.95 },
      { travelRatePerKm: 2.5 },
    ]);

    await expect(service().standardTravelRate()).resolves.toEqual({
      travelRatePerKm: 4.95,
      artists: 3,
      mixed: true,
    });
  });

  it("falls back to the standard rate when there are no DJ profiles yet", async () => {
    profiles.findMany.mockResolvedValue([]);

    await expect(service().standardTravelRate()).resolves.toEqual({
      travelRatePerKm: 4.95,
      artists: 0,
      mixed: false,
    });
  });
});
