import { UnauthorizedException } from "@nestjs/common";
import type { ConfigService } from "@nestjs/config";
import type { Request } from "express";
import { prisma } from "@essentials/db";
import { DashboardSessionService } from "./dashboard-session.service";

/**
 * Recovery codes are stored, hashed and retired in Postgres, so this suite uses
 * the real database. Only session resolution is stubbed: the subject here is the
 * code lifecycle, not how a cookie becomes a session (that has its own suite).
 *
 * Skipped unless TEST_DATABASE_URL names a `*_test` database.
 */
const testUrl = process.env.TEST_DATABASE_URL ?? "";
const databaseName = testUrl.split("?")[0].split("/").pop() ?? "";
const enabled = testUrl.length > 0 && databaseName.endsWith("_test");
const describeDb = enabled ? describe : describe.skip;

const USER_ID = "mfa-recovery-test-user";
const SESSION_ID = "mfa-recovery-test-session";
const req = {} as Request;

function service() {
  const config = {
    get: () => undefined,
    getOrThrow: () => "test-session-secret",
  } as unknown as ConfigService;
  const instance = new DashboardSessionService(config, {} as never, {} as never);
  // The code paths under test only need the row's owner and id.
  jest.spyOn(instance, "resolve").mockResolvedValue({
    session: { sub: USER_ID, email: "mfa-recovery@example.test", aal: "aal1" },
    row: { id: SESSION_ID, userId: USER_ID },
  } as never);
  return instance;
}

describeDb("DashboardSessionService recovery codes (database)", () => {
  beforeAll(async () => {
    await prisma.mfaRecoveryCode.deleteMany({ where: { userId: USER_ID } });
    await prisma.dashboardSession.deleteMany({ where: { id: SESSION_ID } });
    await prisma.user.deleteMany({ where: { id: USER_ID } });
    await prisma.user.create({
      data: { id: USER_ID, email: "mfa-recovery@example.test", role: "promoter" },
    });
    // Consuming a code also elevates the browser session to aal2, so the row
    // the stubbed resolve() names has to exist for real.
    await prisma.dashboardSession.create({
      data: {
        id: SESSION_ID,
        userId: USER_ID,
        authUid: "mfa-recovery-test-auth",
        accessToken: "unused-in-this-test",
        aal: "aal1",
        expiresAt: new Date(Date.now() + 60 * 60 * 1000),
        refreshUntil: new Date(Date.now() + 24 * 60 * 60 * 1000),
      },
    });
  }, 30_000);

  afterAll(async () => {
    await prisma.mfaRecoveryCode.deleteMany({ where: { userId: USER_ID } });
    await prisma.dashboardSession.deleteMany({ where: { id: SESSION_ID } });
    await prisma.user.deleteMany({ where: { id: USER_ID } });
    await prisma.$disconnect();
  });

  it("issues ten single-use codes and stores only their hashes", async () => {
    const { codes } = await service().generateRecoveryCodes(req);

    expect(codes).toHaveLength(10);
    expect(new Set(codes).size).toBe(10);
    for (const code of codes) expect(code).toMatch(/^[0-9A-F]{5}-[0-9A-F]{5}$/);

    const rows = await prisma.mfaRecoveryCode.findMany({ where: { userId: USER_ID } });
    expect(rows).toHaveLength(10);
    expect(rows.every((r) => r.usedAt === null)).toBe(true);
    // No stored value contains the plaintext a user was shown.
    for (const code of codes) {
      expect(rows.some((r) => r.codeHash.includes(code))).toBe(false);
      expect(rows.some((r) => r.codeHash.includes(code.replace("-", "")))).toBe(false);
    }
  }, 30_000);

  it("consumes a code once, accepting sloppy casing and separators", async () => {
    const svc = service();
    const { codes } = await svc.generateRecoveryCodes(req);
    const sloppy = ` ${codes[0].toLowerCase().replace("-", " ")} `;

    await expect(svc.consumeRecoveryCode(req, sloppy)).resolves.toEqual({ ok: true });

    const used = await prisma.mfaRecoveryCode.findFirst({ where: { userId: USER_ID, usedAt: { not: null } } });
    expect(used).not.toBeNull();
    await expect(svc.recoveryStatus(req)).resolves.toEqual({ remaining: 9, total: 10 });
    await expect(svc.consumeRecoveryCode(req, codes[0])).rejects.toBeInstanceOf(UnauthorizedException);
  }, 30_000);

  it("retires the previous set when a new one is generated", async () => {
    const svc = service();
    const first = await svc.generateRecoveryCodes(req);
    const second = await svc.generateRecoveryCodes(req);

    await expect(svc.consumeRecoveryCode(req, first.codes[1])).rejects.toBeInstanceOf(UnauthorizedException);
    await expect(svc.consumeRecoveryCode(req, second.codes[1])).resolves.toEqual({ ok: true });
    await expect(svc.recoveryStatus(req)).resolves.toEqual({ remaining: 9, total: 10 });
  }, 30_000);

  it("rejects an unknown code without marking anything used", async () => {
    const svc = service();
    await svc.generateRecoveryCodes(req);

    await expect(svc.consumeRecoveryCode(req, "00000-00000")).rejects.toBeInstanceOf(UnauthorizedException);
    await expect(svc.recoveryStatus(req)).resolves.toEqual({ remaining: 10, total: 10 });
  }, 30_000);
});
