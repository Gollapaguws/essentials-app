import { ExecutionContext, ForbiddenException, UnauthorizedException } from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import type { Role } from "@prisma/client";
import { SupabaseAuthGuard } from "./supabase-auth.guard";
import { ROLES_KEY } from "../common/roles.decorator";
import { SKIP_PASSWORD_RESET_KEY } from "../common/skip-password-reset.decorator";
import type { AuthUserService } from "./auth-user.service";
import type { DashboardSessionService } from "./dashboard-session.service";
import type { SupabaseTokenService, VerifiedSession } from "./supabase-token.service";

type TestRequest = { headers: Record<string, string>; user?: Record<string, unknown> };

const ctx = (req: TestRequest) =>
  ({
    switchToHttp: () => ({ getRequest: () => req }),
    getHandler: () => ({}),
    getClass: () => ({}),
  }) as unknown as ExecutionContext;

const session = (over: Partial<VerifiedSession> = {}): VerifiedSession => ({
  sub: "auth-uid-1",
  email: "dj@example.test",
  role: "artist",
  aal: "aal1",
  ...over,
});

function build() {
  const tokens = { verify: jest.fn() };
  const authUsers = { resolveUser: jest.fn() };
  const sessions = { resolve: jest.fn() };
  const platform = { activeOrgId: jest.fn().mockResolvedValue("org-1") };
  const reflector = { getAllAndOverride: jest.fn() };
  const guard = new SupabaseAuthGuard(
    tokens as unknown as SupabaseTokenService,
    authUsers as unknown as AuthUserService,
    sessions as unknown as DashboardSessionService,
    platform as never,
    reflector as unknown as Reflector,
  );
  return { guard, tokens, authUsers, sessions, platform, reflector };
}

type Guard = ReturnType<typeof build>;

function allow(
  g: Guard,
  identity: {
    id: string;
    role: Role;
    mustResetPassword?: boolean;
    mfaDisabled?: boolean;
  } | null = {
    id: "user-1",
    role: "artist",
  },
) {
  g.tokens.verify.mockResolvedValue(session());
  g.authUsers.resolveUser.mockResolvedValue(
    identity && { mustResetPassword: false, ...identity },
  );
}

describe("SupabaseAuthGuard", () => {
  it("prefers a bearer token and never touches the session store", async () => {
    const g = build();
    allow(g);
    const req: TestRequest = { headers: { authorization: "Bearer jwt-1" } };

    await expect(g.guard.canActivate(ctx(req))).resolves.toBe(true);

    expect(g.tokens.verify).toHaveBeenCalledWith("jwt-1");
    expect(g.sessions.resolve).not.toHaveBeenCalled();
  });

  it("falls back to the dashboard cookie when there is no bearer header", async () => {
    const g = build();
    g.sessions.resolve.mockResolvedValue({ session: session(), row: {} });
    g.authUsers.resolveUser.mockResolvedValue({ id: "user-1", role: "artist", mustResetPassword: false });
    const req: TestRequest = { headers: { cookie: "ess_dash=opaque" } };

    await expect(g.guard.canActivate(ctx(req))).resolves.toBe(true);

    expect(g.sessions.resolve).toHaveBeenCalledWith(req);
    expect(g.tokens.verify).not.toHaveBeenCalled();
    expect(req.user).toMatchObject({ sub: "user-1", authUid: "auth-uid-1", role: "artist" });
  });

  it("uses the Prisma role, not the token claim", async () => {
    const g = build();
    allow(g, { id: "user-1", role: "artist" });
    g.tokens.verify.mockResolvedValue(session({ role: "admin" }));
    const req: TestRequest = { headers: { authorization: "Bearer jwt-1" } };

    await expect(g.guard.canActivate(ctx(req))).resolves.toBe(true);

    expect(g.authUsers.resolveUser).toHaveBeenCalledWith("auth-uid-1", "dj@example.test");
    expect(req.user).toMatchObject({ role: "artist" });
  });

  it("attaches the workspace and only forwards a requested org id", async () => {
    const g = build();
    allow(g, { id: "user-1", role: "promoter" });
    g.tokens.verify.mockResolvedValue(session({ role: "promoter", aal: "aal2" }));
    const req: TestRequest = {
      headers: { authorization: "Bearer jwt-1", "x-org-id": " org-2 " },
    };

    await expect(g.guard.canActivate(ctx(req))).resolves.toBe(true);

    expect(g.platform.activeOrgId).toHaveBeenCalledWith(
      "user-1",
      "promoter",
      "dj@example.test",
      "org-2",
    );
    expect(req.user).toMatchObject({ orgId: "org-1" });
  });

  it("blocks a promoter who has not passed MFA", async () => {
    const g = build();
    allow(g, { id: "user-1", role: "promoter" });
    g.tokens.verify.mockResolvedValue(session({ role: "promoter" }));

    await expect(
      g.guard.canActivate(ctx({ headers: { authorization: "Bearer jwt-1" } })),
    ).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it("lets that promoter through once the session is aal2", async () => {
    const g = build();
    allow(g, { id: "user-1", role: "promoter" });
    g.tokens.verify.mockResolvedValue(session({ role: "promoter", aal: "aal2" }));

    await expect(g.guard.canActivate(ctx({ headers: { authorization: "Bearer jwt-1" } }))).resolves.toBe(true);
  });

  it("lets an exempt account through at aal1", async () => {
    const g = build();
    allow(g, { id: "user-1", role: "promoter", mfaDisabled: true });
    g.tokens.verify.mockResolvedValue(session({ role: "promoter" }));

    await expect(
      g.guard.canActivate(ctx({ headers: { authorization: "Bearer jwt-1" } })),
    ).resolves.toBe(true);
  });

  it("never exempts an admin endpoint from aal2", async () => {
    const g = build();
    allow(g, { id: "user-1", role: "admin", mfaDisabled: true });
    g.tokens.verify.mockResolvedValue(session({ role: "admin" }));
    g.reflector.getAllAndOverride.mockImplementation((key: string) =>
      key === ROLES_KEY ? ["admin"] : false,
    );

    await expect(
      g.guard.canActivate(ctx({ headers: { authorization: "Bearer jwt-1" } })),
    ).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it("keeps an exempt promoter on a screen that also admits admins", async () => {
    // `@Auth("promoter", "admin")` is a promoter screen, not account
    // administration: the exemption has to hold or an exempt promoter cannot see
    // her own DJ applications, events or analytics.
    const g = build();
    allow(g, { id: "user-1", role: "promoter", mfaDisabled: true });
    g.tokens.verify.mockResolvedValue(session({ role: "promoter" }));
    g.reflector.getAllAndOverride.mockImplementation((key: string) =>
      key === ROLES_KEY ? ["promoter", "admin"] : false,
    );

    await expect(
      g.guard.canActivate(ctx({ headers: { authorization: "Bearer jwt-1" } })),
    ).resolves.toBe(true);
  });

  it("honours @SkipMfa for the endpoints that bootstrap MFA", async () => {
    const g = build();
    allow(g, { id: "user-1", role: "promoter" });
    g.tokens.verify.mockResolvedValue(session({ role: "promoter" }));
    g.reflector.getAllAndOverride.mockReturnValue(true);

    await expect(g.guard.canActivate(ctx({ headers: { authorization: "Bearer jwt-1" } }))).resolves.toBe(true);
  });

  it("fails closed when the Prisma identity cannot be resolved", async () => {
    const g = build();
    g.tokens.verify.mockResolvedValue(session({ role: "admin", aal: "aal2" }));
    g.authUsers.resolveUser.mockResolvedValue(null);

    await expect(
      g.guard.canActivate(ctx({ headers: { authorization: "Bearer jwt-1" } })),
    ).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it("blocks data routes until a provisioned account chooses a password", async () => {
    const g = build();
    allow(g, { id: "user-1", role: "artist", mustResetPassword: true });

    await expect(
      g.guard.canActivate(ctx({ headers: { authorization: "Bearer jwt-1" } })),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it("lets the password screen through the first-login gate", async () => {
    const g = build();
    allow(g, { id: "user-1", role: "artist", mustResetPassword: true });
    g.reflector.getAllAndOverride.mockImplementation((key: string) =>
      key === SKIP_PASSWORD_RESET_KEY ? true : false,
    );

    await expect(
      g.guard.canActivate(ctx({ headers: { authorization: "Bearer jwt-1" } })),
    ).resolves.toBe(true);
  });

  it("treats a signed-in guest as unprivileged rather than failing them", async () => {
    const g = build();
    allow(g, { id: "user-1", role: "guest" });
    const req: TestRequest = { headers: { authorization: "Bearer jwt-1" } };

    await expect(g.guard.canActivate(ctx(req))).resolves.toBe(true);

    expect(req.user).toMatchObject({ role: "guest", id: "user-1" });
  });
});
