import { prisma } from "@essentials/db";
import { ROLES_KEY } from "../common/roles.decorator";
import { ArtistsController } from "./artists.controller";
import { ArtistsService } from "./artists.service";
import { ConfigService } from "@nestjs/config";

jest.mock("@essentials/db", () => ({
  prisma: { artistProfile: { updateMany: jest.fn() } },
}));

const profiles = (prisma as unknown as { artistProfile: { updateMany: jest.Mock } }).artistProfile;

describe("standard travel rate", () => {
  it("is admin-only", () => {
    const roles = Reflect.getMetadata(ROLES_KEY, ArtistsController.prototype.setTravelRate);
    expect(roles).toEqual(["admin"]);
  });

  it("updates every DJ's profile and reports how many were touched", async () => {
    profiles.updateMany.mockResolvedValue({ count: 7 });
    const service = new ArtistsService({ get: () => undefined } as unknown as ConfigService);

    await expect(service.setStandardTravelRate(4.95)).resolves.toEqual({ travelRatePerKm: 4.95, artists: 7 });
    expect(profiles.updateMany).toHaveBeenCalledWith({ data: { travelRatePerKm: 4.95 } });
  });
});
