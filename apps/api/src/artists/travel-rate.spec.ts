import { prisma } from "@essentials/db";
import { plainToInstance } from "class-transformer";
import { validate } from "class-validator";
import { ROLES_KEY } from "../common/roles.decorator";
import { ArtistsController, StandardTravelRateDto } from "./artists.controller";
import { ArtistsService, DEFAULT_TRAVEL_RATE_PER_KM, TRAVEL_RATE_KEY } from "./artists.service";
import { ConfigService } from "@nestjs/config";

jest.mock("@essentials/db", () => ({
  prisma: {
    artistProfile: {
      updateMany: jest.fn(),
      findMany: jest.fn(),
      findUnique: jest.fn(),
      create: jest.fn(),
    },
    platformSetting: { findUnique: jest.fn(), upsert: jest.fn() },
    $transaction: jest.fn(async (ops: Promise<unknown>[]) => Promise.all(ops)),
  },
}));

const db = prisma as unknown as {
  artistProfile: {
    updateMany: jest.Mock;
    findMany: jest.Mock;
    findUnique: jest.Mock;
    create: jest.Mock;
  };
  platformSetting: { findUnique: jest.Mock; upsert: jest.Mock };
};
const profiles = db.artistProfile;
const settings = db.platformSetting;

const service = () => new ArtistsService({ get: () => undefined } as unknown as ConfigService);

beforeEach(() => {
  profiles.updateMany.mockReset();
  profiles.findMany.mockReset();
  profiles.findUnique.mockReset();
  profiles.create.mockReset();
  settings.findUnique.mockReset();
  settings.upsert.mockReset();
});

describe("standard travel rate", () => {
  it("is admin-only, for reading and for writing", () => {
    expect(Reflect.getMetadata(ROLES_KEY, ArtistsController.prototype.setTravelRate)).toEqual(["admin"]);
    expect(Reflect.getMetadata(ROLES_KEY, ArtistsController.prototype.travelRate)).toEqual(["admin"]);
  });

  it("refuses a rate that would zero or reverse a DJ's travel pay", async () => {
    const rejected = async (value: number) =>
      (await validate(plainToInstance(StandardTravelRateDto, { travelRatePerKm: value }))).length > 0;

    await expect(rejected(0)).resolves.toBe(true);
    await expect(rejected(-4.95)).resolves.toBe(true);
    await expect(rejected(0.01)).resolves.toBe(false);
    await expect(rejected(4.95)).resolves.toBe(false);
  });

  it("writes the standard and moves every DJ's profile onto it", async () => {
    profiles.updateMany.mockResolvedValue({ count: 7 });
    settings.upsert.mockResolvedValue({ key: TRAVEL_RATE_KEY, value: "4.95" });

    await expect(service().setStandardTravelRate(4.95)).resolves.toEqual({
      travelRatePerKm: 4.95,
      artists: 7,
      mixed: false,
    });
    expect(profiles.updateMany).toHaveBeenCalledWith({ data: { travelRatePerKm: 4.95 } });
    expect(settings.upsert).toHaveBeenCalledWith({
      where: { key: TRAVEL_RATE_KEY },
      create: { key: TRAVEL_RATE_KEY, value: "4.95" },
      update: { value: "4.95" },
    });
  });

  it("reads the rate from the setting rather than the profiles", async () => {
    settings.findUnique.mockResolvedValue({ key: TRAVEL_RATE_KEY, value: "5.5" });
    profiles.findMany.mockResolvedValue([{ travelRatePerKm: 5.5 }, { travelRatePerKm: 5.5 }]);

    await expect(service().standardTravelRate()).resolves.toEqual({
      travelRatePerKm: 5.5,
      artists: 2,
      mixed: false,
    });
  });

  it("flags a profile that drifted from the setting", async () => {
    settings.findUnique.mockResolvedValue({ key: TRAVEL_RATE_KEY, value: "4.95" });
    profiles.findMany.mockResolvedValue([{ travelRatePerKm: 4.95 }, { travelRatePerKm: 2.5 }]);

    await expect(service().standardTravelRate()).resolves.toEqual({
      travelRatePerKm: 4.95,
      artists: 2,
      mixed: true,
    });
  });

  it("falls back to the platform default when no rate has been set", async () => {
    settings.findUnique.mockResolvedValue(null);
    profiles.findMany.mockResolvedValue([]);

    await expect(service().standardTravelRate()).resolves.toEqual({
      travelRatePerKm: DEFAULT_TRAVEL_RATE_PER_KM,
      artists: 0,
      mixed: false,
    });
  });

  it("starts a new DJ profile on the platform rate", async () => {
    settings.findUnique.mockResolvedValue({ key: TRAVEL_RATE_KEY, value: "6.5" });
    profiles.findUnique.mockResolvedValue(null);
    profiles.create.mockImplementation(async ({ data }: { data: unknown }) => data);

    await service().upsertProfile(
      { sub: "user-1", role: "artist" } as never,
      { stageName: "DJ Nova" },
      "https://essentialsedm.com",
    );

    expect(profiles.create).toHaveBeenCalledWith({
      data: { userId: "user-1", travelRatePerKm: 6.5, stageName: "DJ Nova" },
    });
  });
});
