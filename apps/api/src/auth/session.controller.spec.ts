import { BadRequestException } from "@nestjs/common";
import type { Request, Response } from "express";
import { SessionController } from "./session.controller";
import type { DashboardSessionService } from "./dashboard-session.service";

/** The controller only uses `get("origin")` for the recovery redirect. */
const req = (origin?: string) =>
  ({
    get: (header: string) => (header === "origin" ? origin : undefined),
    protocol: "http",
  }) as unknown as Request;

const res = {} as Response;

function build() {
  const sessions = { startRecovery: jest.fn().mockResolvedValue(undefined) };
  return {
    controller: new SessionController(sessions as unknown as DashboardSessionService),
    sessions,
  };
}

const dto = { email: "dj@example.test", path: "/dashboard/auth/callback?type=recovery" };

const saved = { CORS_ORIGINS: process.env.CORS_ORIGINS, SITE_URL: process.env.SITE_URL };

beforeEach(() => {
  process.env.CORS_ORIGINS = "http://72.62.211.31:4200";
  process.env.SITE_URL = "https://essentialsedm.com";
});

afterAll(() => {
  for (const [key, value] of Object.entries(saved)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
});

describe("SessionController recovery links", () => {
  it("sends the mail back to the dashboard, which is same-origin and not in CORS_ORIGINS", async () => {
    const { controller, sessions } = build();

    await controller.recover(dto, req("https://essentialsedm.com"), res);

    expect(sessions.startRecovery).toHaveBeenCalledWith(
      "dj@example.test",
      "https://essentialsedm.com/dashboard/auth/callback?type=recovery",
      res,
    );
  });

  it("also trusts an origin from the CORS allowlist", async () => {
    const { controller, sessions } = build();

    await controller.recover(dto, req("http://72.62.211.31:4200"), res);

    expect(sessions.startRecovery).toHaveBeenCalledWith(
      "dj@example.test",
      "http://72.62.211.31:4200/dashboard/auth/callback?type=recovery",
      res,
    );
  });

  it("refuses to aim the link at someone else's host", async () => {
    const { controller, sessions } = build();

    await expect(controller.recover(dto, req("https://evil.example"), res)).rejects.toBeInstanceOf(
      BadRequestException,
    );
    expect(sessions.startRecovery).not.toHaveBeenCalled();
  });

  it("falls back to a known host when no Origin is sent", async () => {
    const { controller, sessions } = build();

    await controller.recover(dto, req(), res);

    expect(sessions.startRecovery.mock.calls[0][1]).toBe(
      "http://72.62.211.31:4200/dashboard/auth/callback?type=recovery",
    );
  });
});
