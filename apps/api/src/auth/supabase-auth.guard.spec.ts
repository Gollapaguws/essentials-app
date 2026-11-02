import { UnauthorizedException } from "@nestjs/common";
import { SupabaseAuthGuard } from "./supabase-auth.guard";
import type { VerifiedSession } from "./supabase-token.service";

function ctx(req: any) {
  return {
    switchToHttp: () => ({ getRequest: () => req }),
    getHandler: () => ({}),
    getClass: () => ({}),
    getArgs: () => [],
    getType: () => "http",
  } as any;
}

const session = (over: Partial<VerifiedSession> = {}): VerifiedSession => ({
  sub: "sub-1",
  email: "a@b.co",
  role: "guest",
  aal: "aal1",
  ...over,
});

function build(verified: VerifiedSession, opts: { skipMfa?: boolean; dbRole?: VerifiedSession["role"] | null } = {}) {
  const tokens = { verify: jest.fn().mockResolvedValue(verified) };
  const users = { resolveRole: jest.fn().mockResolvedValue(opts.dbRole ?? null) };
  const reflector = {
    getAllAndOverride: jest.fn().mockReturnValue(opts.skipMfa ? true : undefined),
  };
  const guard = new SupabaseAuthGuard(tokens as any, users as any, reflector as any);
  const req: any = { headers: {}, body: {} };
  return { guard, tokens, users, req };
}

describe("SupabaseAuthGuard", () => {
  it("rejects a request without a bearer token", async () => {
    const { guard, req } = build(session());
    await expect(guard.canActivate(ctx(req))).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it("rejects a non-bearer authorization header", async () => {
    const { guard, req } = build(session());
    req.headers.authorization = "Basic abc";
    await expect(guard.canActivate(ctx(req))).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it("attaches the verified session for a guest token", async () => {
    const { guard, req } = build(session());
    req.headers.authorization = "Bearer t";
    await expect(guard.canActivate(ctx(req))).resolves.toBe(true);
    expect(req.user).toMatchObject({ sub: "sub-1", role: "guest", aal: "aal1" });
  });

  it("allows an aal2 promoter", async () => {
    const { guard, req } = build(session({ role: "promoter", aal: "aal2" }));
    req.headers.authorization = "Bearer t";
    await expect(guard.canActivate(ctx(req))).resolves.toBe(true);
  });

  it("blocks an aal1 promoter with MFA_REQUIRED", async () => {
    const { guard, req } = build(session({ role: "promoter", aal: "aal1" }));
    req.headers.authorization = "Bearer t";
    await guard.canActivate(ctx(req)).catch((e) => {
      expect(e).toBeInstanceOf(UnauthorizedException);
      expect(e.getResponse()).toEqual({ code: "MFA_REQUIRED", role: "promoter" });
    });
    expect(req.user).toBeUndefined();
  });

  it("blocks aal1 admin and venue_manager too", async () => {
    for (const role of ["admin", "venue_manager"] as const) {
      const { guard, req } = build(session({ role, aal: "aal1" }));
      req.headers.authorization = "Bearer t";
      await expect(guard.canActivate(ctx(req))).rejects.toBeInstanceOf(UnauthorizedException);
    }
  });

  it("allows an aal1 promoter on a @SkipMfa handler", async () => {
    const { guard, req } = build(session({ role: "promoter", aal: "aal1" }), { skipMfa: true });
    req.headers.authorization = "Bearer t";
    await expect(guard.canActivate(ctx(req))).resolves.toBe(true);
  });

  it("falls back to the DB role when the claim is absent and enforces MFA on it", async () => {
    const { guard, req } = build(session({ role: null }), { dbRole: "venue_manager" });
    req.headers.authorization = "Bearer t";
    await expect(guard.canActivate(ctx(req))).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it("passes a user with no linked account (role null)", async () => {
    const { guard, req } = build(session({ role: null }));
    req.headers.authorization = "Bearer t";
    await expect(guard.canActivate(ctx(req))).resolves.toBe(true);
    expect(req.user.role).toBeNull();
  });
});
