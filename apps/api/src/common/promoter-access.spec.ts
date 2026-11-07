import type { Role } from "@prisma/client";
import { ROLES_KEY } from "./roles.decorator";
import { ArtistsController } from "../artists/artists.controller";
import { EventsController } from "../events/events.controller";
import { VenuesController } from "../venues/venues.controller";

jest.mock("@essentials/db", () => ({
  prisma: {},
  ArtistBookingStatus: {},
  EventStatus: {},
}));

/** Roles attached to a handler by `@Auth(...)` (via `@Roles(...)`). */
function rolesOf(controller: { prototype: object }, method: string): Role[] {
  const handler = (controller.prototype as Record<string, unknown>)[method];
  return (Reflect.getMetadata(ROLES_KEY, handler as object) as Role[] | undefined) ?? [];
}

/**
 * A promoter runs the night end to end: create events, add the venues they use,
 * review the DJ roster and approve or decline every application. Pinning the
 * role metadata keeps a later `@Auth` edit from locking promoters out silently.
 */
describe("promoter access", () => {
  it.each([
    ["create an event", EventsController, "create"],
    ["clone, cancel, reopen or delete an event", EventsController, "listForPromoter"],
    ["create a venue", VenuesController, "create"],
    ["see the venues it manages", VenuesController, "mine"],
    ["see events awaiting the venue's approval", VenuesController, "pending"],
    ["approve or reject those events", VenuesController, "decide"],
    ["edit its venues", VenuesController, "update"],
    ["view the artist roster", ArtistsController, "roster"],
    ["list DJ applications", ArtistsController, "applications"],
    ["confirm or decline a DJ application", ArtistsController, "decide"],
  ])("allows a promoter to %s", (_label, controller, method) => {
    expect(rolesOf(controller, method)).toContain("promoter");
  });

  it("keeps guests out of the promoter-only writes", () => {
    expect(rolesOf(VenuesController, "create")).not.toContain("guest");
    expect(rolesOf(ArtistsController, "decide")).not.toContain("guest");
  });
});
