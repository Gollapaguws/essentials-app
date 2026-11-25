import { ExecutionContext, UnauthorizedException } from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import { EntitlementsGuard } from "./entitlements.guard";
import { EntitlementsService } from "./entitlements.service";

function contextWith(user?: unknown): ExecutionContext {
  return {
    getHandler: () => ({}),
    getClass: () => ({}),
    switchToHttp: () => ({ getRequest: () => ({ user }) }),
  } as unknown as ExecutionContext;
}

function reflectorFor(requirement?: { metric: string; amount: number }): Reflector {
  return { getAllAndOverride: jest.fn().mockReturnValue(requirement) } as unknown as Reflector;
}

const user = { sub: "user-1", email: "promoter@example.com", role: "promoter", orgId: "org-1" };

describe("EntitlementsGuard", () => {
  it("allows a route with no requirement", async () => {
    const check = jest.fn();
    const guard = new EntitlementsGuard(reflectorFor(), { check } as unknown as EntitlementsService);

    await expect(guard.canActivate(contextWith(user))).resolves.toBe(true);
    expect(check).not.toHaveBeenCalled();
  });

  it("refuses an unauthenticated request rather than treating it as unmetered", async () => {
    const guard = new EntitlementsGuard(
      reflectorFor({ metric: "social.publishes", amount: 1 }),
      { check: jest.fn() } as unknown as EntitlementsService,
    );

    await expect(guard.canActivate(contextWith(undefined))).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it("skips accounts with no workspace", async () => {
    const check = jest.fn();
    const guard = new EntitlementsGuard(
      reflectorFor({ metric: "social.publishes", amount: 1 }),
      { check } as unknown as EntitlementsService,
    );

    await expect(
      guard.canActivate(contextWith({ ...user, role: "guest", orgId: null })),
    ).resolves.toBe(true);
    expect(check).not.toHaveBeenCalled();
  });

  it("asks the active workspace's allowance", async () => {
    const check = jest.fn().mockResolvedValue({ remaining: 1 });
    const guard = new EntitlementsGuard(
      reflectorFor({ metric: "social.publishes", amount: 2 }),
      { check } as unknown as EntitlementsService,
    );

    await expect(guard.canActivate(contextWith(user))).resolves.toBe(true);
    expect(check).toHaveBeenCalledWith("org-1", "social.publishes", 2);
  });

  it("propagates the 402 from the allowance check", async () => {
    const check = jest.fn().mockRejectedValue(new Error("payment required"));
    const guard = new EntitlementsGuard(
      reflectorFor({ metric: "social.publishes", amount: 1 }),
      { check } as unknown as EntitlementsService,
    );

    await expect(guard.canActivate(contextWith(user))).rejects.toThrow("payment required");
  });
});
