jest.mock("@essentials/db", () => ({
  prisma: {
    user: {
      findUnique: jest.fn(),
      update: jest.fn(),
      create: jest.fn(),
    },
  },
}));

import { prisma } from "@essentials/db";
import { AuthUserService } from "./auth-user.service";
import type { VerifiedSession } from "./supabase-token.service";

const findUnique = prisma.user.findUnique as jest.Mock;
const update = prisma.user.update as jest.Mock;
const create = prisma.user.create as jest.Mock;

const session = (over: Partial<VerifiedSession> = {}): VerifiedSession => ({
  sub: "sub-1",
  email: "guest@essentials.example",
  role: null,
  aal: "aal1",
  ...over,
});

const user = (over: Record<string, unknown> = {}) => ({
  id: "u1",
  email: "guest@essentials.example",
  authUid: null,
  role: "guest",
  ...over,
});

let events: { record: jest.Mock };
let svc: AuthUserService;

beforeEach(() => {
  jest.clearAllMocks();
  findUnique.mockReset();
  update.mockReset();
  create.mockReset();
  events = { record: jest.fn().mockResolvedValue(undefined) };
  svc = new AuthUserService(events as any);
});

describe("ensureUser", () => {
  it("returns the user already linked by authUid without a second query", async () => {
    findUnique.mockResolvedValueOnce(user({ authUid: "sub-1" }));
    await expect(svc.ensureUser(session())).resolves.toMatchObject({ created: false });
    expect(findUnique).toHaveBeenCalledTimes(1);
    expect(events.record).not.toHaveBeenCalled();
  });

  it("binds authUid when the email already exists in Prisma", async () => {
    findUnique
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(user())
    ;
    update.mockResolvedValueOnce(user({ authUid: "sub-1" }));
    const res = await svc.ensureUser(session());
    expect(res?.user.authUid).toBe("sub-1");
    expect(update).toHaveBeenCalledWith({ where: { id: "u1" }, data: { authUid: "sub-1" } });
    expect(events.record).toHaveBeenCalledWith("lazy_link", expect.objectContaining({ userId: "u1" }));
  });

  it("creates a user when the token carries a role claim", async () => {
    findUnique.mockResolvedValueOnce(null).mockResolvedValueOnce(null);
    create.mockResolvedValueOnce(user({ id: "u2", authUid: "sub-1", role: "guest" }));
    const res = await svc.ensureUser(session({ role: "guest" }));
    expect(res?.created).toBe(true);
    expect(create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ email: "guest@essentials.example", role: "guest", authUid: "sub-1" }),
      }),
    );
    expect(events.record).toHaveBeenCalledWith("lazy_link", expect.anything());
  });

  it("returns null (INVITE_REQUIRED) when there is no account and no role claim", async () => {
    findUnique.mockResolvedValueOnce(null).mockResolvedValueOnce(null);
    await expect(svc.ensureUser(session())).resolves.toBeNull();
    expect(create).not.toHaveBeenCalled();
    expect(events.record).not.toHaveBeenCalled();
  });

  it("is idempotent for repeat calls", async () => {
    findUnique.mockResolvedValue(user({ authUid: "sub-1" }));
    await svc.ensureUser(session());
    await svc.ensureUser(session());
    expect(create).not.toHaveBeenCalled();
    expect(events.record).not.toHaveBeenCalled();
  });
});

describe("resolveRole", () => {
  it("caches a resolved role for 60s", async () => {
    findUnique.mockResolvedValueOnce(user({ role: "promoter" }));
    await expect(svc.resolveRole("sub-1", "p@x.co")).resolves.toBe("promoter");
    await expect(svc.resolveRole("sub-1", "p@x.co")).resolves.toBe("promoter");
    expect(findUnique).toHaveBeenCalledTimes(1);
  });

  it("does not cache a null role", async () => {
    findUnique.mockResolvedValue(null);
    await expect(svc.resolveRole("sub-1", "p@x.co")).resolves.toBeNull();
    await expect(svc.resolveRole("sub-1", "p@x.co")).resolves.toBeNull();
    expect(findUnique).toHaveBeenCalledTimes(4); // two lookups per call (authUid, email)
  });

  it("re-reads the DB after invalidate", async () => {
    findUnique.mockResolvedValueOnce(user({ role: "guest" })).mockResolvedValueOnce(user({ role: "promoter" }));
    await svc.resolveRole("sub-1", "p@x.co");
    svc.invalidate("sub-1");
    await expect(svc.resolveRole("sub-1", "p@x.co")).resolves.toBe("promoter");
  });

  it("is seeded by ensureUser so the next guard call costs no query", async () => {
    findUnique.mockResolvedValueOnce(user({ authUid: "sub-1", role: "venue_manager" }));
    await svc.ensureUser(session());
    findUnique.mockClear();
    await expect(svc.resolveRole("sub-1", "guest@essentials.example")).resolves.toBe("venue_manager");
    expect(findUnique).not.toHaveBeenCalled();
  });
});
