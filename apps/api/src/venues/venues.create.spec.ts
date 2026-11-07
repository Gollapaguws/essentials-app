import { BadRequestException } from "@nestjs/common";
import { prisma } from "@essentials/db";
import type { JwtUser } from "../common/roles.guard";
import { VenuesService } from "./venues.service";

jest.mock("@essentials/db", () => ({
  prisma: { venue: { create: jest.fn() } },
  EventStatus: {},
}));

const promoter = { sub: "promoter-user", role: "promoter", email: "promoter@example.com" } as JwtUser;

/** Notifications, DJ booking and route rebuild play no part in creation. */
function service() {
  return new VenuesService({} as never, {} as never, {} as never);
}

const venues = (prisma as unknown as { venue: { create: jest.Mock } }).venue;

beforeEach(() => {
  venues.create.mockReset();
  venues.create.mockImplementation(({ data }: { data: Record<string, unknown> }) => data);
});

describe("VenuesService.create", () => {
  it("makes the creating promoter the venue's manager", async () => {
    const created = await service().create(promoter, { name: "The Vault", capacity: 240 });

    expect(venues.create).toHaveBeenCalledTimes(1);
    expect(venues.create.mock.calls[0][0].data).toMatchObject({
      name: "The Vault",
      capacity: 240,
      managerId: promoter.sub,
    });
    expect(created).toMatchObject({ managerId: promoter.sub });
  });

  it("defaults a venue created before its coordinates are known to the 0/0 sentinel", async () => {
    const created = await service().create(promoter, { name: "No map yet", capacity: 90 });

    expect(created).toMatchObject({ lat: 0, lng: 0 });
  });

  it("keeps coordinates when both are supplied", async () => {
    const created = await service().create(promoter, {
      name: "Fox Street",
      capacity: 300,
      lat: -26.2041,
      lng: 28.0473,
    });

    expect(created).toMatchObject({ lat: -26.2041, lng: 28.0473 });
  });

  it("trims the name and stores a blank address as null", async () => {
    const created = await service().create(promoter, { name: "  Basement  ", capacity: 120, address: "   " });

    expect(created).toMatchObject({ name: "Basement", address: null });
  });

  it("rejects a blank name", async () => {
    await expect(service().create(promoter, { name: "   ", capacity: 100 })).rejects.toBeInstanceOf(
      BadRequestException,
    );
    expect(venues.create).not.toHaveBeenCalled();
  });

  it.each([0, -5, 12.5])("rejects an unusable capacity (%s)", async (capacity) => {
    await expect(service().create(promoter, { name: "Zero House", capacity })).rejects.toThrow(
      "Capacity must be a whole number of at least 1.",
    );
    expect(venues.create).not.toHaveBeenCalled();
  });

  it("rejects half a location so DJ routing stays correct", async () => {
    await expect(
      service().create(promoter, { name: "Half mapped", capacity: 100, lat: -26.2 }),
    ).rejects.toThrow("Send latitude and longitude together");
    await expect(
      service().create(promoter, { name: "Half mapped", capacity: 100, lng: 28.04 }),
    ).rejects.toThrow("Send latitude and longitude together");
    expect(venues.create).not.toHaveBeenCalled();
  });
});
