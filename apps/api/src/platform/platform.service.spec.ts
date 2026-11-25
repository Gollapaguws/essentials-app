import { BadRequestException, ForbiddenException, NotFoundException } from "@nestjs/common";
import { prisma } from "@essentials/db";
import { PlatformService } from "./platform.service";

jest.mock("@essentials/db", () => ({
  prisma: {
    membership: {
      findMany: jest.fn(),
      upsert: jest.fn(),
      deleteMany: jest.fn(),
    },
    organisation: {
      findUnique: jest.fn(),
      findMany: jest.fn(),
      create: jest.fn(),
    },
    user: { findUnique: jest.fn() },
    venue: { count: jest.fn() },
    event: { count: jest.fn() },
    artistBooking: { count: jest.fn() },
  },
  ArtistBookingStatus: { confirmed: "confirmed", completed: "completed" },
  EventStatus: { cancelled: "cancelled" },
}));

const db = prisma as unknown as {
  membership: {
    findMany: jest.Mock;
    upsert: jest.Mock;
    deleteMany: jest.Mock;
  };
  organisation: {
    findUnique: jest.Mock;
    findMany: jest.Mock;
    create: jest.Mock;
  };
  user: { findUnique: jest.Mock };
  venue: { count: jest.Mock };
  event: { count: jest.Mock };
  artistBooking: { count: jest.Mock };
};

const org = (id: string, name = id, slug = id, kind = "promoter") => ({ id, name, slug, kind });
const membership = (organisation: ReturnType<typeof org>, role = "promoter") => ({
  organisation,
  role,
});

/** A unique-constraint error as Prisma reports it. */
const uniqueViolation = () => Object.assign(new Error("unique"), { code: "P2002" });

function service() {
  return new PlatformService();
}

beforeEach(() => {
  jest.clearAllMocks();
  db.membership.findMany.mockResolvedValue([]);
  db.membership.upsert.mockImplementation(({ create }: { create: unknown }) => create);
  db.membership.deleteMany.mockResolvedValue({ count: 1 });
  db.organisation.findUnique.mockResolvedValue(null);
  db.organisation.findMany.mockResolvedValue([]);
  db.organisation.create.mockImplementation(({ data }: { data: Record<string, unknown> }) => ({
    id: "org-new",
    ...data,
  }));
  db.user.findUnique.mockResolvedValue(null);
  db.venue.count.mockResolvedValue(0);
  db.event.count.mockResolvedValue(0);
  db.artistBooking.count.mockResolvedValue(0);
});

describe("PlatformService.organisationsFor", () => {
  it("maps memberships and memoises the lookup", async () => {
    db.membership.findMany.mockResolvedValue([membership(org("org-1"), "promoter")]);
    const platform = service();

    await expect(platform.organisationsFor("user-1")).resolves.toEqual([
      { id: "org-1", name: "org-1", slug: "org-1", kind: "promoter", role: "promoter" },
    ]);
    await platform.organisationsFor("user-1");

    expect(db.membership.findMany).toHaveBeenCalledTimes(1);
  });

  it("re-reads after invalidation so a new membership applies at once", async () => {
    const platform = service();
    db.membership.findMany.mockResolvedValue([membership(org("org-1"))]);

    await platform.organisationsFor("user-1");
    platform.invalidate("user-1");
    await platform.organisationsFor("user-1");

    expect(db.membership.findMany).toHaveBeenCalledTimes(2);
  });
});

describe("PlatformService.activeOrgId", () => {
  it("accepts a requested workspace only when the account is a member", async () => {
    db.membership.findMany.mockResolvedValue([
      membership(org("org-1")),
      membership(org("org-2")),
    ]);
    const platform = service();

    await expect(platform.activeOrgId("user-1", "promoter", "a@b.c", "org-2")).resolves.toBe(
      "org-2",
    );
    await expect(platform.activeOrgId("user-1", "promoter", "a@b.c", "org-other")).resolves.toBe(
      "org-1",
    );
  });

  it("falls back to the first workspace without a header", async () => {
    db.membership.findMany.mockResolvedValue([membership(org("org-1"))]);

    await expect(service().activeOrgId("user-1", "promoter", "a@b.c")).resolves.toBe("org-1");
  });

  it("creates a personal workspace for a promoter with no membership", async () => {
    db.organisation.findUnique.mockResolvedValue(null);

    await expect(service().activeOrgId("user-42", "promoter", "dj.kay@example.com")).resolves.toBe(
      "org-new",
    );

    expect(db.organisation.create).toHaveBeenCalledWith({
      data: { name: "dj kay Presents", slug: "promoter-user-42", kind: "promoter" },
    });
    expect(db.membership.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { orgId_userId: { orgId: "org-new", userId: "user-42" } },
        create: { orgId: "org-new", userId: "user-42", role: "promoter" },
      }),
    );
  });

  it("reuses an existing personal workspace and repairs its missing membership", async () => {
    db.organisation.findUnique.mockResolvedValue(org("org-existing", "Kay Presents", "promoter-user-42"));

    await expect(service().activeOrgId("user-42", "promoter", "dj.kay@example.com")).resolves.toBe(
      "org-existing",
    );
    expect(db.organisation.create).not.toHaveBeenCalled();
    expect(db.membership.upsert).toHaveBeenCalled();
  });

  it("puts an admin with no membership in the platform workspace", async () => {
    db.organisation.findUnique.mockResolvedValue(org("org-sonus", "SONUS", "sonus", "platform"));

    await expect(service().activeOrgId("admin-1", "admin", "admin@sonus.example")).resolves.toBe(
      "org-sonus",
    );
    expect(db.membership.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { userId: "admin-1" } }),
    );
  });

  it("creates the platform workspace when it is missing", async () => {
    db.organisation.findUnique.mockResolvedValue(null);

    await expect(service().activeOrgId("admin-1", "admin", "admin@sonus.example")).resolves.toBe(
      "org-sonus",
    );
    expect(db.organisation.create).toHaveBeenCalledWith({
      data: { id: "org-sonus", name: "SONUS", slug: "sonus", kind: "platform" },
    });
  });

  it("prefers a promoter workspace over platform staff access", async () => {
    db.membership.findMany.mockResolvedValue([
      membership(org("org-sonus", "SONUS", "sonus", "platform"), "admin"),
      membership(org("org-customer", "Customer", "customer", "promoter"), "promoter"),
    ]);

    await expect(service().activeOrgId("user-1", "promoter", "a@b.c")).resolves.toBe(
      "org-customer",
    );
  });

  it("gives a promoter with only staff access their own workspace", async () => {
    db.membership.findMany.mockResolvedValue([
      membership(org("org-sonus", "SONUS", "sonus", "platform"), "venue_manager"),
    ]);

    await expect(service().activeOrgId("user-42", "promoter", "dj@example.com")).resolves.toBe(
      "org-new",
    );
    expect(db.organisation.create).toHaveBeenCalledWith({
      data: { name: "dj Presents", slug: "promoter-user-42", kind: "promoter" },
    });
  });

  it("leaves guests and DJs without a workspace", async () => {
    await expect(service().activeOrgId("guest-1", "guest", "g@example.com")).resolves.toBeNull();
    await expect(service().activeOrgId("dj-1", "artist", "dj@example.com")).resolves.toBeNull();
    expect(db.organisation.create).not.toHaveBeenCalled();
  });
});

describe("PlatformService.context", () => {
  it("lets an admin see every workspace while members see their own", async () => {
    db.membership.findMany.mockResolvedValue([membership(org("org-1"), "promoter")]);
    db.organisation.findMany.mockResolvedValue([
      org("org-1", "One"),
      org("org-2", "Two"),
    ]);
    db.organisation.findUnique.mockResolvedValue(org("org-sonus", "SONUS", "sonus", "platform"));

    const admin = await service().context("admin-1", "admin", "admin@sonus.example", "org-2");
    expect(admin.active?.id).toBe("org-2");
    expect(admin.organisations.map((o) => o.id)).toEqual(["org-1", "org-2"]);

    db.membership.findMany.mockResolvedValue([membership(org("org-1"), "promoter")]);
    const promoter = await service().context("user-1", "promoter", "a@b.c");
    expect(promoter.active?.id).toBe("org-1");
    expect(promoter.organisations.map((o) => o.id)).toEqual(["org-1"]);
  });
});

describe("PlatformService.onboarding", () => {
  const promoter = {
    sub: "user-1",
    email: "promoter@example.com",
    role: "promoter" as const,
    orgId: "org-1",
  };

  it("reports every step from the workspace's live setup", async () => {
    db.organisation.findUnique.mockResolvedValue({
      id: "org-1",
      name: "Nightshift",
      slug: "nightshift",
    });
    db.venue.count.mockResolvedValue(1);
    db.event.count.mockResolvedValueOnce(2).mockResolvedValueOnce(1);
    db.artistBooking.count.mockResolvedValue(1);

    await expect(service().onboarding(promoter)).resolves.toEqual({
      organisation: { id: "org-1", name: "Nightshift", slug: "nightshift" },
      steps: { venue: true, event: true, slots: true, lineup: true },
      complete: true,
    });
  });

  it("returns an incomplete checklist scoped to the workspace or the owner", async () => {
    db.organisation.findUnique.mockResolvedValue(org("org-1", "New", "new"));

    await expect(service().onboarding(promoter)).resolves.toMatchObject({
      steps: { venue: false, event: false, slots: false, lineup: false },
      complete: false,
    });
    const scope = { OR: [{ orgId: "org-1" }, { promoterId: "user-1" }] };
    expect(db.venue.count).toHaveBeenCalledWith({
      where: { OR: [{ orgId: "org-1" }, { managerId: "user-1" }] },
    });
    expect(db.event.count).toHaveBeenNthCalledWith(1, { where: scope });
    expect(db.artistBooking.count).toHaveBeenCalledWith({
      where: {
        status: { in: ["confirmed", "completed"] },
        event: scope,
      },
    });
  });

  it("counts a night at an existing venue as venue setup", async () => {
    db.venue.count.mockResolvedValue(0);
    db.event.count.mockResolvedValueOnce(1).mockResolvedValueOnce(0);

    await expect(service().onboarding(promoter)).resolves.toMatchObject({
      steps: { venue: true, event: true, slots: false, lineup: false },
    });
  });

  it("refuses accounts that are not promoters", async () => {
    await expect(
      service().onboarding({ ...promoter, role: "admin" }),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(db.event.count).not.toHaveBeenCalled();
  });
});

describe("PlatformService.attachNewUser", () => {
  it("does not create a second workspace for someone who already has one", async () => {
    db.membership.findMany.mockResolvedValue([membership(org("org-1"), "promoter")]);

    const attached = await service().attachNewUser("user-1", "a@b.c", "promoter", "Ignored");

    expect(attached).toMatchObject({ id: "org-1" });
    expect(db.organisation.create).not.toHaveBeenCalled();
    expect(db.membership.upsert).not.toHaveBeenCalled();
  });

  it("uses the supplied name for a new promoter workspace", async () => {
    db.organisation.create.mockImplementation(({ data }: { data: Record<string, unknown> }) => ({
      id: "org-1",
      ...data,
    }));

    await service().attachNewUser("user-1", "a@b.c", "promoter", "  Nightshift  ");

    expect(db.organisation.create).toHaveBeenCalledWith({
      data: { name: "Nightshift", slug: "nightshift", kind: "promoter" },
    });
  });

  it("defaults the name from the email local part", async () => {
    await service().attachNewUser("user-1", "sipho.dlamini@example.com", "promoter");

    expect(db.organisation.create).toHaveBeenCalledWith({
      data: { name: "sipho dlamini Presents", slug: "sipho-dlamini-presents", kind: "promoter" },
    });
  });

  it("retries with a suffix when the workspace slug is taken", async () => {
    db.organisation.create
      .mockRejectedValueOnce(uniqueViolation())
      .mockImplementationOnce(({ data }: { data: Record<string, unknown> }) => ({
        id: "org-2",
        ...data,
      }));

    await service().attachNewUser("user-1", "a@b.c", "promoter", "Nightshift");

    expect(db.organisation.create).toHaveBeenNthCalledWith(2, {
      data: { name: "Nightshift", slug: "nightshift-2", kind: "promoter" },
    });
  });

  it("moves a promoter with staff access into the platform workspace", async () => {
    db.membership.findMany.mockResolvedValue([
      membership(org("org-customer", "Customer", "customer", "promoter"), "promoter"),
    ]);
    db.organisation.findUnique.mockResolvedValue(org("org-sonus", "SONUS", "sonus", "platform"));

    const attached = await service().attachNewUser("user-1", "staff@sonus.example", "admin");

    expect(attached).toMatchObject({ id: "org-sonus" });
    expect(db.membership.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        create: { orgId: "org-sonus", userId: "user-1", role: "admin" },
      }),
    );
  });

  it("puts admins and venue staff in the platform workspace", async () => {
    db.organisation.findUnique.mockResolvedValue(org("org-sonus", "SONUS", "sonus", "platform"));

    await service().attachNewUser("user-1", "staff@sonus.example", "venue_manager");

    expect(db.membership.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        create: { orgId: "org-sonus", userId: "user-1", role: "venue_manager" },
      }),
    );
  });

  it("leaves guests and DJs unattached", async () => {
    await expect(service().attachNewUser("user-1", "a@b.c", "artist")).resolves.toBeNull();
    expect(db.organisation.create).not.toHaveBeenCalled();
  });
});

describe("PlatformService membership administration", () => {
  it("refuses to add someone whose platform role does not match", async () => {
    db.organisation.findUnique.mockResolvedValue(org("org-1"));
    db.user.findUnique.mockResolvedValue({ id: "user-1", email: "a@b.c", role: "guest" });

    await expect(service().addMember("org-1", "a@b.c", "promoter")).rejects.toBeInstanceOf(
      BadRequestException,
    );
    expect(db.membership.upsert).not.toHaveBeenCalled();
  });

  it("adds a matching account and invalidates its cached workspace list", async () => {
    db.organisation.findUnique.mockResolvedValue(org("org-1"));
    db.user.findUnique.mockResolvedValue({ id: "user-1", email: "a@b.c", role: "promoter" });
    db.membership.findMany.mockResolvedValue([membership(org("org-1"))]);
    const platform = service();
    await platform.organisationsFor("user-1");

    await platform.addMember("org-1", "a@b.c", "promoter");

    expect(db.membership.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        create: { orgId: "org-1", userId: "user-1", role: "promoter" },
      }),
    );
    await platform.organisationsFor("user-1");
    expect(db.membership.findMany).toHaveBeenCalledTimes(2);
  });

  it("rejects an unknown workspace", async () => {
    await expect(service().addMember("missing", "a@b.c", "promoter")).rejects.toBeInstanceOf(
      NotFoundException,
    );
    await expect(service().removeMember("missing", "user-1")).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });
});
