import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ApiError, api, setAccessTokenProvider } from "./index";

const ok = (body: unknown = { ok: true }) =>
  ({ ok: true, status: 200, text: async () => JSON.stringify(body), json: async () => body }) as Response;

const unauthorized = () =>
  ({
    ok: false,
    status: 401,
    text: async () => "expired",
    json: async () => ({ message: "expired" }),
  }) as Response;

const fetchMock = vi.fn();

beforeEach(() => {
  fetchMock.mockReset();
  globalThis.fetch = fetchMock as unknown as typeof fetch;
  setAccessTokenProvider(null);
});

afterEach(() => setAccessTokenProvider(null));

const authHeader = (call: number) =>
  (fetchMock.mock.calls[call]?.[1]?.headers as Record<string, string> | undefined)?.Authorization;

describe("api client", () => {
  it("sends the provider token", async () => {
    setAccessTokenProvider(() => "t1");
    fetchMock.mockResolvedValue(ok());
    await api.get("/x");
    expect(authHeader(0)).toBe("Bearer t1");
  });

  it("omits the header when the provider has no session", async () => {
    setAccessTokenProvider(() => null);
    fetchMock.mockResolvedValue(ok());
    await api.get("/x");
    expect(authHeader(0)).toBeUndefined();
  });

  it("proceeds without a header when the provider throws", async () => {
    setAccessTokenProvider(() => {
      throw new Error("no storage");
    });
    fetchMock.mockResolvedValue(ok());
    await expect(api.get("/x")).resolves.toEqual({ ok: true });
    expect(authHeader(0)).toBeUndefined();
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("retries exactly once with a fresh token", async () => {
    let calls = 0;
    setAccessTokenProvider(() => (calls++ === 0 ? "t1" : "t2"));
    fetchMock.mockResolvedValueOnce(unauthorized()).mockResolvedValueOnce(ok({ ok: "retried" }));
    await expect(api.get("/x")).resolves.toEqual({ ok: "retried" });
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(authHeader(1)).toBe("Bearer t2");
  });

  it("gives up after one retry and surfaces the 401", async () => {
    setAccessTokenProvider(() => "t1");
    fetchMock.mockResolvedValue(unauthorized());
    await expect(api.get("/x")).rejects.toMatchObject({ status: 401 });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("parses structured error codes", async () => {
    fetchMock.mockResolvedValue({
      ok: false,
      status: 403,
      text: async () => JSON.stringify({ code: "MFA_REQUIRED", role: "promoter" }),
      json: async () => ({ code: "MFA_REQUIRED", role: "promoter" }),
    } as Response);
    const err = await api.get("/x").catch((e) => e);
    expect(err).toBeInstanceOf(ApiError);
    expect(err.status).toBe(403);
    expect(err.code).toBe("MFA_REQUIRED");
  });

  it("does not retry non-401 failures", async () => {
    fetchMock.mockResolvedValue({
      ok: false,
      status: 500,
      text: async () => "boom",
      json: async () => ({}),
    } as Response);
    await expect(api.get("/x")).rejects.toMatchObject({ status: 500 });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("does not retry when no token provider is registered", async () => {
    fetchMock.mockResolvedValue(unauthorized());
    await expect(api.get("/x")).rejects.toMatchObject({ status: 401 });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
