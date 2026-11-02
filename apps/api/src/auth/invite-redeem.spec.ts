jest.mock("@essentials/db", () => ({
  prisma: {
    user: { findUnique: jest.fn(), update: jest.fn(), create: jest.fn() },
    invite: { findUnique: jest.fn(), updateMany: jest.fn() },
    consent: { upsert: jest.fn() },
    referral: { create: jest.fn() },
  },
}));

import { BadRequestException } from "@nestjs/common";
import { prisma } from "@essentials/db";
import { AuthService } from "./auth.service";
import type { VerifiedSession } from "./supabase-token.service";

const userFind = prisma.user.findUnique as jest.Mock;
const userUpdate = prisma.user.update as jest.Mock;
const userCreate = prisma.user.create as jest.Mock;
const inviteFind = prisma.invite.findUnique as jest.Mock;
const inviteClaim = prisma.invite.updateMany as jest.Mock;
const consentUpsert = prisma.consent.upsert as jest.Mock;
const referralCreate = prisma.referral.create as jest.Mock;

const session: VerifiedSession = {
  sub: "sub-1",
  email: "New@Example.com",
  role: null,
  aal: "aal1",
};

const invite = (over: Record<string, unknown> = {}) => ({
  id: "inv-1",
  code: "PROMO-1",
  role: "promoter",
  maxUses: 2,
  uses: 1,
  revoked: false,
  expiresAt: null,
  ...over,
});

const created = { id: "u-new", email: "new@example.com", role: "promoter", authUid: "sub-1" };

let svc: AuthService;
let admin: { updateRole: jest.Mock };
let events: { record: jest.Mock };
let users: { invalidate: jest.Mock };
let mail: { send: jest.Mock };

beforeEach(() => {
  jest.clearAllMocks();
  userFind.mockReset().mockResolvedValue(null);
  userUpdate.mockReset();
  userCreate.mockReset().mockResolvedValue(created);
  inviteFind.mockReset().mockResolvedValue(null);
  inviteClaim.mockReset();
  consentUpsert.mockReset().mockResolvedValue({});
  referralCreate.mockReset().mockResolvedValue({});
  admin = { updateRole: jest.fn().mockResolvedValue(undefined) };
  events = { record: jest.fn().mockResolvedValue(undefined) };
  users = { invalidate: jest.fn() };
  mail = { send: jest.fn().mockResolvedValue(undefined) };
  const config = { get: (k: string) => (k === "APP_URL" ? "http://app.test" : undefined) } as any;
  svc = new AuthService(config, mail as any, admin as any, events as any, users as any);
});

describe("redeemInvite", () => {
  it("is idempotent for an already linked identity", async () => {
    userFind.mockResolvedValueOnce({ ...created, authUid: "sub-1" });
    await expect(svc.redeemInvite(session, "WHATEVER")).resolves.toMatchObject({
      user: { id: "u-new", role: "promoter" },
    });
    expect(inviteFind).not.toHaveBeenCalled();
  });

  it("binds an existing Prisma user by email instead of creating a duplicate", async () => {
    userFind
      .mockResolvedValueOnce(null) // by authUid
      .mockResolvedValueOnce({ ...created, authUid: null, role: "venue_manager" }); // by email
    const bound = { ...created, authUid: "sub-1", role: "venue_manager" };
    userUpdate.mockResolvedValueOnce(bound);
    await expect(svc.redeemInvite(session, "IGNORED")).resolves.toMatchObject({
      user: { role: "venue_manager" },
    });
    expect(userUpdate).toHaveBeenCalledWith({ where: { id: "u-new" }, data: { authUid: "sub-1" } });
    expect(userCreate).not.toHaveBeenCalled();
    expect(inviteClaim).not.toHaveBeenCalled();
  });

  it("claims a valid invite atomically and creates the user with the invite role", async () => {
    inviteFind.mockResolvedValueOnce(invite());
    inviteClaim.mockResolvedValueOnce({ count: 1 });
    const res = await svc.redeemInvite(session, "PROMO-1", "1.2.3.4");

    expect(inviteClaim).toHaveBeenCalledWith({
      where: expect.objectContaining({ id: "inv-1", uses: { lt: 2 }, revoked: false }),
      data: { uses: { increment: 1 } },
    });
    expect(userCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ email: "new@example.com", role: "promoter", authUid: "sub-1" }),
      }),
    );
    expect(admin.updateRole).toHaveBeenCalledWith("sub-1", "promoter");
    expect(events.record).toHaveBeenCalledWith("invite_redeemed", expect.anything());
    expect(users.invalidate).toHaveBeenCalledWith("sub-1");
    expect(res.user).toEqual({ id: "u-new", email: "new@example.com", role: "promoter" });
  });

  it("rejects when the atomic claim loses the race (count 0)", async () => {
    inviteFind.mockResolvedValueOnce(invite());
    inviteClaim.mockResolvedValueOnce({ count: 0 });
    await expect(svc.redeemInvite(session, "PROMO-1")).rejects.toBeInstanceOf(BadRequestException);
    expect(userCreate).not.toHaveBeenCalled();
  });

  it("never exceeds maxUses across concurrent redemptions", async () => {
    inviteFind.mockResolvedValue(invite());
    inviteClaim.mockResolvedValueOnce({ count: 1 }).mockResolvedValueOnce({ count: 0 });
    const results = await Promise.allSettled([
      svc.redeemInvite(session, "PROMO-1"),
      svc.redeemInvite(session, "PROMO-1"),
    ]);
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    expect(results.filter((r) => r.status === "rejected")).toHaveLength(1);
    expect(userCreate).toHaveBeenCalledTimes(1);
  });

  it("rejects a revoked invite before claiming", async () => {
    inviteFind.mockResolvedValueOnce(invite({ revoked: true }));
    await expect(svc.redeemInvite(session, "PROMO-1")).rejects.toThrow(/revoked/i);
    expect(inviteClaim).not.toHaveBeenCalled();
  });

  it("rejects an expired invite before claiming", async () => {
    inviteFind.mockResolvedValueOnce(invite({ expiresAt: new Date(Date.now() - 60_000) }));
    await expect(svc.redeemInvite(session, "PROMO-1")).rejects.toThrow(/expired/i);
    expect(inviteClaim).not.toHaveBeenCalled();
  });

  it("falls back to a referral code and grants guest", async () => {
    inviteFind.mockResolvedValueOnce(null);
    userFind
      .mockResolvedValueOnce(null) // by authUid
      .mockResolvedValueOnce(null) // by email
      .mockResolvedValueOnce({ ...created, id: "inviter", role: "guest", referralCode: "E-ABCD" }); // inviter
    await svc.redeemInvite(session, "E-ABCD");
    expect(userCreate).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ role: "guest", referredById: "inviter" }) }),
    );
  });

  it("rejects an unknown code", async () => {
    await expect(svc.redeemInvite(session, "NOPE")).rejects.toThrow(/invalid invite code/i);
  });

  it("still succeeds when mirroring the role to Supabase fails", async () => {
    inviteFind.mockResolvedValueOnce(invite());
    inviteClaim.mockResolvedValueOnce({ count: 1 });
    admin.updateRole.mockRejectedValueOnce(new Error("supabase down"));
    await expect(svc.redeemInvite(session, "PROMO-1")).resolves.toMatchObject({ user: { id: "u-new" } });
  });

  it("still succeeds when the welcome email fails", async () => {
    inviteFind.mockResolvedValueOnce(invite());
    inviteClaim.mockResolvedValueOnce({ count: 1 });
    mail.send.mockRejectedValueOnce(new Error("smtp down"));
    await expect(svc.redeemInvite(session, "PROMO-1")).resolves.toMatchObject({ user: { id: "u-new" } });
  });
});
