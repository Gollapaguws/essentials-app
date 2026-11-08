import { NotFoundException, UnauthorizedException } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { createHash } from "node:crypto";
import type { Request, Response } from "express";
import { prisma } from "@essentials/db";
import { DashboardSessionService, SESSION_COOKIE } from "./dashboard-session.service";
import type { AuthUserService } from "./auth-user.service";
import type { SupabaseTokenService, VerifiedSession } from "./supabase-token.service";

jest.mock("@essentials/db", () => ({
  prisma: {
    dashboardSession: {
      findUnique: jest.fn(),
      findMany: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
      deleteMany: jest.fn(),
    },
  },
}));

const db = prisma as unknown as {
  dashboardSession: {
    findUnique: jest.Mock;
    findMany: jest.Mock;
    create: jest.Mock;
    update: jest.Mock;
    deleteMany: jest.Mock;
  };
};

interface Row {
  id: string;
  userId: string;
  authUid: string;
  accessToken: string;
  refreshToken: string | null;
  aal: string;
  expiresAt: Date;
  refreshUntil: Date;
  lastSeenAt: Date;
}

const sha256 = (value: string) => createHash("sha256").update(value).digest("hex");

const cookieReq = (cookies: Record<string, string>): Request =>
  ({
    headers: { cookie: Object.entries(cookies).map(([k, v]) => `${k}=${v}`).join("; ") },
  }) as unknown as Request;

const mockRes = () => {
  const headers: Record<string, unknown> = {};
  return {
    headers,
    cookie: jest.fn((name: string, value: string, opts: Record<string, unknown>) => {
      headers[name] = { value, ...opts };
    }),
    clearCookie: jest.fn((name: string) => {
      delete headers[name];
    }),
  } as unknown as Response & { headers: Record<string, { value: string }> };
};

const json = (body: unknown, status = 200) =>
  ({ ok: status < 400, status, text: async () => JSON.stringify(body) }) as unknown as Response;

const fetchMock = jest.fn();

const config = {
  get: jest.fn((key: string) => {
    switch (key) {
      case "SESSION_SECRET":
        return "test-session-secret";
      case "NODE_ENV":
        return "production";
      case "SUPABASE_URL":
        return "http://gotrue.test";
      case "SUPABASE_ANON_KEY":
        return "anon-key";
      case "SUPABASE_SERVICE_ROLE_KEY":
        return "service-key";
      default:
        return undefined;
    }
  }),
} as unknown as ConfigService;

const tokens = { verify: jest.fn() } as unknown as SupabaseTokenService & { verify: jest.Mock };
const authUsers = { resolveUser: jest.fn() } as unknown as AuthUserService & { resolveUser: jest.Mock };

const session = (over: Partial<VerifiedSession> = {}): VerifiedSession => ({
  sub: "auth-uid-1",
  email: "dj@example.test",
  role: "promoter",
  aal: "aal1",
  ...over,
});

const build = () => new DashboardSessionService(config, tokens, authUsers);

/** Signs in once so the row carries genuinely encrypted tokens. */
async function signIn(over: Partial<VerifiedSession> = {}) {
  fetchMock.mockResolvedValueOnce(json({ access_token: "at-1", refresh_token: "rt-1", expires_in: 3600 }));
  tokens.verify.mockResolvedValueOnce(session(over));
  const res = mockRes();
  await build().login("dj@example.test", "correct-horse", cookieReq({}), res);
  const data = db.dashboardSession.create.mock.calls[0][0].data as Row;
  fetchMock.mockClear();
  return { data, res, cookie: res.headers[SESSION_COOKIE].value };
}

beforeEach(() => {
  db.dashboardSession.findUnique.mockReset();
  db.dashboardSession.findMany.mockReset().mockResolvedValue([]);
  db.dashboardSession.create.mockReset().mockResolvedValue({});
  db.dashboardSession.update.mockReset().mockResolvedValue({});
  db.dashboardSession.deleteMany.mockReset().mockResolvedValue({ count: 1 });
  tokens.verify.mockReset().mockResolvedValue(session());
  authUsers.resolveUser.mockReset().mockResolvedValue({
    id: "user-1",
    role: "promoter",
    mustResetPassword: false,
  });
  fetchMock.mockReset();
  global.fetch = fetchMock as unknown as typeof fetch;
});

describe("DashboardSessionService sign-in", () => {
  it("gives the browser an opaque httpOnly cookie and keeps the tokens out of it", async () => {
    const { data, cookie } = await signIn();

    expect(cookie).toMatch(/^[A-Za-z0-9_-]{40,}$/);
    expect(cookie).not.toContain("at-1");
    expect(data.id).toBe(sha256(cookie));
    expect(data.accessToken).not.toContain("at-1");
    expect(data.accessToken.split(".")).toHaveLength(3);
    expect(data.refreshToken).not.toBeNull();
  });

  it("sets Secure, HttpOnly, Lax and the 30-day lifetime in production", async () => {
    const { res } = await signIn();

    expect(res.headers[SESSION_COOKIE]).toMatchObject({
      httpOnly: true,
      secure: true,
      sameSite: "lax",
      path: "/",
      maxAge: 30 * 24 * 60 * 60 * 1000,
    });
  });

  it("refuses credentials Supabase rejects", async () => {
    fetchMock.mockResolvedValueOnce(json({ error: "invalid_grant" }, 400));

    await expect(build().login("dj@example.test", "nope", cookieReq({}), mockRes())).rejects.toBeInstanceOf(
      UnauthorizedException,
    );
    expect(db.dashboardSession.create).not.toHaveBeenCalled();
  });
});

describe("DashboardSessionService resolution", () => {
  it("accepts the cookie once, for the session it names", async () => {
    const { cookie } = await signIn();
    db.dashboardSession.findUnique.mockResolvedValueOnce({
      ...(db.dashboardSession.create.mock.calls[0][0].data as Row),
    });
    tokens.verify.mockResolvedValueOnce(session());

    const { session: verified } = await build().resolve(cookieReq({ [SESSION_COOKIE]: cookie }));

    expect(verified.sub).toBe("auth-uid-1");
    expect(db.dashboardSession.findUnique).toHaveBeenCalledWith({ where: { id: sha256(cookie) } });
  });

  it("rejects an unknown cookie without touching the token service", async () => {
    db.dashboardSession.findUnique.mockResolvedValueOnce(null);

    await expect(build().resolve(cookieReq({ [SESSION_COOKIE]: "forged" }))).rejects.toBeInstanceOf(
      UnauthorizedException,
    );
    expect(tokens.verify).not.toHaveBeenCalled();
  });

  it("rejects a missing cookie", async () => {
    await expect(build().resolve(cookieReq({}))).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it("drops a row whose 30-day window has closed", async () => {
    db.dashboardSession.findUnique.mockResolvedValueOnce({
      id: sha256("x"),
      refreshUntil: new Date(Date.now() - 1000),
      expiresAt: new Date(Date.now() + 1000),
    });

    await expect(build().resolve(cookieReq({ [SESSION_COOKIE]: "x" }))).rejects.toBeInstanceOf(
      UnauthorizedException,
    );
    expect(db.dashboardSession.deleteMany).toHaveBeenCalledWith({ where: { id: sha256("x") } });
  });

  it("deletes the row when the stored token no longer verifies", async () => {
    const { data, cookie } = await signIn();
    db.dashboardSession.findUnique.mockResolvedValueOnce(data);
    tokens.verify.mockRejectedValueOnce(new Error("expired"));

    await expect(build().resolve(cookieReq({ [SESSION_COOKIE]: cookie }))).rejects.toBeInstanceOf(
      UnauthorizedException,
    );
    expect(db.dashboardSession.deleteMany).toHaveBeenCalledWith({ where: { id: data.id } });
  });
});

describe("DashboardSessionService refresh", () => {
  it("rotates an expiring token and stores the new one encrypted", async () => {
    const { data, cookie } = await signIn();
    db.dashboardSession.findUnique.mockResolvedValue({
      ...data,
      expiresAt: new Date(Date.now() - 1000),
    });
    fetchMock.mockResolvedValueOnce(json({ access_token: "at-2", refresh_token: "rt-2", expires_in: 3600 }));
    tokens.verify.mockResolvedValueOnce(session());

    await build().resolve(cookieReq({ [SESSION_COOKIE]: cookie }));

    const update = db.dashboardSession.update.mock.calls[0][0];
    expect(update.data.accessToken).not.toContain("at-2");
    expect(update.data.refreshToken).not.toContain("rt-2");
    expect(fetchMock.mock.calls[0][1].body).toContain("rt-1");
  });

  it("refreshes once when a page fires several requests at the same time", async () => {
    const { data, cookie } = await signIn();
    db.dashboardSession.findUnique.mockResolvedValue({
      ...data,
      expiresAt: new Date(Date.now() - 1000),
    });
    fetchMock.mockResolvedValue(json({ access_token: "at-2", refresh_token: "rt-2", expires_in: 3600 }));
    tokens.verify.mockResolvedValue(session());

    const service = build();
    const req = cookieReq({ [SESSION_COOKIE]: cookie });
    await Promise.all([service.resolve(req), service.resolve(req), service.resolve(req)]);

    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});

describe("DashboardSessionService sign-out", () => {
  it("revokes the row and clears the cookie", async () => {
    const res = mockRes();

    await build().logout(cookieReq({ [SESSION_COOKIE]: "abc" }), res);

    expect(db.dashboardSession.deleteMany).toHaveBeenCalledWith({ where: { id: sha256("abc") } });
    expect(res.clearCookie).toHaveBeenCalledWith(SESSION_COOKIE, { path: "/" });
  });

  it("ends the identity-provider session too, so the site cannot sign straight back in", async () => {
    const { data, cookie } = await signIn();
    db.dashboardSession.findUnique.mockResolvedValue(data);
    fetchMock.mockResolvedValueOnce(json({}));

    await build().logout(cookieReq({ [SESSION_COOKIE]: cookie }), mockRes());

    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("http://gotrue.test/auth/v1/logout");
    expect(init.method).toBe("POST");
    expect(init.headers.Authorization).toBe("Bearer at-1");
    expect(db.dashboardSession.deleteMany).toHaveBeenCalledWith({ where: { id: data.id } });
  });

  it("still signs this browser out when the provider refuses the logout", async () => {
    const { data, cookie } = await signIn();
    db.dashboardSession.findUnique.mockResolvedValue(data);
    // An expired access token and a refresh token that cannot be swapped.
    fetchMock.mockResolvedValueOnce(json({ msg: "token expired" }, 401));
    fetchMock.mockResolvedValueOnce(json({ msg: "invalid refresh token" }, 400));
    const res = mockRes();

    await expect(build().logout(cookieReq({ [SESSION_COOKIE]: cookie }), res)).resolves.toBeUndefined();

    expect(db.dashboardSession.deleteMany).toHaveBeenCalledWith({ where: { id: data.id } });
    expect(res.clearCookie).toHaveBeenCalledWith(SESSION_COOKIE, { path: "/" });
  });
});

describe("DashboardSessionService adoption from the site", () => {
  it("verifies the token and stores it encrypted behind the cookie", async () => {
    const res = mockRes();
    fetchMock.mockResolvedValueOnce(json({ id: "auth-uid-1" }));

    await build().adopt("at-site", "rt-site", res);

    expect(fetchMock.mock.calls[0][0]).toBe("http://gotrue.test/auth/v1/user");

    const data = db.dashboardSession.create.mock.calls[0][0].data as Row;
    expect(tokens.verify).toHaveBeenCalledWith("at-site");
    expect(data.accessToken).not.toContain("at-site");
    expect(data.refreshToken).not.toContain("rt-site");
    expect(res.headers[SESSION_COOKIE].value).toMatch(/^[A-Za-z0-9_-]{40,}$/);
  });

  it("creates no session for a token that does not verify", async () => {
    fetchMock.mockResolvedValueOnce(json({ id: "auth-uid-1" }));
    tokens.verify.mockRejectedValueOnce(new UnauthorizedException("Invalid or expired token"));

    await expect(build().adopt("not-a-token", null, mockRes())).rejects.toBeInstanceOf(
      UnauthorizedException,
    );
    expect(db.dashboardSession.create).not.toHaveBeenCalled();
  });

  it("refuses a signed token whose session has already been signed out", async () => {
    // The signature still verifies; the session behind it is gone.
    fetchMock.mockResolvedValueOnce(json({ msg: "session not found" }, 403));

    await expect(build().adopt("at-signed-out", "rt-old", mockRes())).rejects.toBeInstanceOf(
      UnauthorizedException,
    );
    expect(tokens.verify).not.toHaveBeenCalled();
    expect(db.dashboardSession.create).not.toHaveBeenCalled();
  });
});

describe("DashboardSessionService devices", () => {
  it("lists this account's live sessions and marks the caller's own", async () => {
    const { data, cookie } = await signIn();
    db.dashboardSession.findUnique.mockResolvedValue(data);
    db.dashboardSession.findMany.mockResolvedValueOnce([
      { id: data.id, createdAt: new Date("2026-11-08T09:00:00Z"), lastSeenAt: new Date("2026-11-08T09:30:00Z"), aal: "aal2" },
      { id: sha256("other"), createdAt: new Date("2026-11-05T08:00:00Z"), lastSeenAt: new Date("2026-11-05T08:10:00Z"), aal: "aal1" },
    ]);

    const devices = await build().devices(cookieReq({ [SESSION_COOKIE]: cookie }));

    expect(db.dashboardSession.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { userId: "user-1", refreshUntil: { gte: expect.any(Date) } } }),
    );
    expect(devices).toHaveLength(2);
    expect(devices.filter((d) => d.current).map((d) => d.id)).toEqual([data.id]);
    expect(devices[0]).not.toHaveProperty("accessToken");
  });

  it("revokes another device without signing the caller out", async () => {
    const { data, cookie } = await signIn();
    db.dashboardSession.findUnique.mockResolvedValue(data);
    const res = mockRes();

    await build().revokeDevice(cookieReq({ [SESSION_COOKIE]: cookie }), res, sha256("other"));

    expect(db.dashboardSession.deleteMany).toHaveBeenCalledWith({
      where: { id: sha256("other"), userId: "user-1" },
    });
    expect(res.clearCookie).not.toHaveBeenCalled();
  });

  it("revoking your own session also clears the cookie", async () => {
    const { data, cookie } = await signIn();
    db.dashboardSession.findUnique.mockResolvedValue(data);
    const res = mockRes();

    await build().revokeDevice(cookieReq({ [SESSION_COOKIE]: cookie }), res, data.id);

    expect(res.clearCookie).toHaveBeenCalledWith(SESSION_COOKIE, { path: "/" });
  });

  it("refuses an id the account does not own", async () => {
    const { data, cookie } = await signIn();
    db.dashboardSession.findUnique.mockResolvedValue(data);
    db.dashboardSession.deleteMany.mockResolvedValueOnce({ count: 0 });

    await expect(
      build().revokeDevice(cookieReq({ [SESSION_COOKIE]: cookie }), mockRes(), sha256("someone-elses")),
    ).rejects.toBeInstanceOf(NotFoundException);
  });
});

describe("DashboardSessionService pruning", () => {
  it("deletes only rows whose refresh window has closed", async () => {
    db.dashboardSession.deleteMany.mockResolvedValueOnce({ count: 3 });
    const now = new Date("2026-11-09T03:00:00Z");

    await expect(build().pruneExpired(now)).resolves.toBe(3);

    expect(db.dashboardSession.deleteMany).toHaveBeenCalledWith({ where: { refreshUntil: { lt: now } } });
  });

  it("reports zero when nothing is due", async () => {
    db.dashboardSession.deleteMany.mockResolvedValueOnce({ count: 0 });

    await expect(build().pruneExpired()).resolves.toBe(0);
  });
});

describe("DashboardSessionService recovery", () => {
  it("keeps the PKCE verifier in the browser and sends only its hash to Supabase", async () => {
    fetchMock.mockResolvedValueOnce(json({}));
    const res = mockRes();

    await build().startRecovery("dj@example.test", "https://essentialsedm.com/dashboard/auth/callback", res);

    const pkce = res.headers.ess_pkce;
    expect(pkce).toMatchObject({ httpOnly: true, secure: true, sameSite: "lax", path: "/api/auth" });
    const sent = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(sent.code_challenge_method).toBe("s256");
    expect(sent.code_challenge).toBe(createHash("sha256").update(pkce.value).digest("base64url"));
    expect(sent.redirect_to).toBe("https://essentialsedm.com/dashboard/auth/callback");
    expect(fetchMock.mock.calls[0][1].body).not.toContain(pkce.value);
  });

  it("answers the same when the address does not exist", async () => {
    fetchMock.mockResolvedValueOnce(json({ error: "user not found" }, 404));

    await expect(
      build().startRecovery("nobody@example.test", "https://essentialsedm.com/dashboard/auth/callback", mockRes()),
    ).resolves.toBeUndefined();
  });

  it("refuses to exchange a code without the verifier cookie", async () => {
    await expect(build().exchange("code-1", cookieReq({}), mockRes())).rejects.toBeInstanceOf(
      UnauthorizedException,
    );
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("exchanges the mailed code for a session and burns the verifier", async () => {
    fetchMock.mockResolvedValueOnce(json({ access_token: "at-r", refresh_token: "rt-r", expires_in: 3600 }));
    tokens.verify.mockResolvedValueOnce(session());
    const res = mockRes();

    await build().exchange("code-1", cookieReq({ ess_pkce: "verifier-1" }), res);

    expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toEqual({
      auth_code: "code-1",
      code_verifier: "verifier-1",
    });
    expect(res.clearCookie).toHaveBeenCalledWith("ess_pkce", { path: "/api/auth" });
    expect(res.headers[SESSION_COOKIE].value).toBeTruthy();
  });
});

describe("DashboardSessionService privileged actions", () => {
  it("changes the password with the session's own access token", async () => {
    const { data, cookie } = await signIn();
    db.dashboardSession.findUnique.mockResolvedValue(data);
    fetchMock.mockResolvedValueOnce(json({}));

    await build().setPassword(cookieReq({ [SESSION_COOKIE]: cookie }), "new-password");

    expect(fetchMock.mock.calls[0][0]).toBe("http://gotrue.test/auth/v1/user");
    expect(fetchMock.mock.calls[0][1].method).toBe("PUT");
    expect(fetchMock.mock.calls[0][1].headers.Authorization).toBe("Bearer at-1");
  });

  it("lists the caller's TOTP factors on the admin route, not the removed GET /factors", async () => {
    const { data, cookie } = await signIn();
    db.dashboardSession.findUnique.mockResolvedValue(data);
    fetchMock.mockResolvedValueOnce(
      json([
        { id: "factor-1", friendly_name: "Phone", status: "verified", factor_type: "totp" },
        { id: "factor-2", status: "verified", factor_type: "phone" },
        { id: "factor-3", status: "unverified", factor_type: "totp" },
      ]),
    );

    const { totp } = await build().factors(cookieReq({ [SESSION_COOKIE]: cookie }));

    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("http://gotrue.test/auth/v1/admin/users/auth-uid-1/factors");
    // The admin route refuses the anon key.
    expect(init.headers.apikey).toBe("service-key");
    expect(totp).toEqual([
      { id: "factor-1", name: "Phone", status: "verified" },
      { id: "factor-3", name: null, status: "unverified" },
    ]);
  });

  it("records aal2 and the rotated tokens after a factor verifies", async () => {
    const { data, cookie } = await signIn();
    db.dashboardSession.findUnique.mockResolvedValue(data);
    fetchMock.mockResolvedValueOnce(json({ access_token: "at-2fa", refresh_token: "rt-2fa", expires_in: 3600 }));

    await build().verifyMfa(cookieReq({ [SESSION_COOKIE]: cookie }), "factor-1", "challenge-1", "123456");

    const update = db.dashboardSession.update.mock.calls[0][0];
    expect(update.where).toEqual({ id: data.id });
    expect(update.data.aal).toBe("aal2");
    expect(update.data.accessToken).not.toContain("at-2fa");
  });
});
