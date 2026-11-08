import { ExecutionContext, UnauthorizedException } from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import type { Role } from "@prisma/client";
import { SupabaseAuthGuard } from "./supabase-auth.guard";
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
  const reflector = { getAllAndOverride: jest.fn() };
  const guard = new SupabaseAuthGuard(
    tokens as unknown as SupabaseTokenService,
    authUsers as unknown as AuthUserService,
    sessions as unknown as DashboardSessionService,
    reflector as unknown as Reflector,
  );
  return { guard, tokens, authUsers, sessions, reflector };
}

type Guard = ReturnType<typeof build>;

function allow(
  g: Guard,
  identity: { id: string; role: Role; mustResetPassword?: boolean } | null = {
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

  it("honours @SkipMfa for the endpoints that bootstrap MFA", async () => {
    const g = build();
    allow(g, { id: "user-1", role: "promoter" });
    g.tokens.verify.mockResolvedValue(session({ role: "promoter" }));
    g.reflector.getAllAndOverride.mockReturnValue(true);

    await expect(g.guard.canActivate(ctx({ headers: { authorization: "Bearer jwt-1" } }))).resolves.toBe(true);
  });

  it("treats a signed-in guest as unprivileged rather than failing them", async () => {
    const g = build();
    allow(g, { id: "user-1", role: "guest" });
    const req: TestRequest = { headers: { authorization: "Bearer jwt-1" } };

    await expect(g.guard.canActivate(ctx(req))).resolves.toBe(true);

    expect(req.user).toMatchObject({ role: "guest", id: "user-1" });
  });
});
