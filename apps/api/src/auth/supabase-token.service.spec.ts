import { createLocalJWKSet, exportJWK, generateKeyPair, SignJWT, type KeyLike } from "jose";
import { SupabaseTokenService } from "./supabase-token.service";

const BASE = "http://test.local";

let privateKey: KeyLike;
let otherKey: KeyLike;
let keySet: ReturnType<typeof createLocalJWKSet>;

beforeAll(async () => {
  const pair = await generateKeyPair("RS256");
  const second = await generateKeyPair("RS256");
  privateKey = pair.privateKey;
  otherKey = second.privateKey;
  const jwk = { ...(await exportJWK(pair.publicKey)), kid: "k1", alg: "RS256", use: "sig" };
  keySet = createLocalJWKSet({ keys: [jwk] });
});

const cfg = { getOrThrow: () => BASE, get: () => BASE } as any;
const svc = () => new SupabaseTokenService(cfg, keySet);

function sign(
  claims: Record<string, unknown> = {},
  opts: { exp?: string; kid?: string; aud?: string; key?: KeyLike; sub?: boolean } = {},
) {
  const jwt = new SignJWT({ email: "a@b.co", aal: "aal1", app_metadata: { role: "promoter" }, ...claims })
    .setProtectedHeader({ alg: "RS256", kid: opts.kid ?? "k1" })
    .setIssuer(`${BASE}/auth/v1`)
    .setAudience(opts.aud ?? "authenticated")
    .setIssuedAt()
    .setExpirationTime(opts.exp ?? "5m");
  if (opts.sub !== false) jwt.setSubject("sub-1");
  return jwt.sign(opts.key ?? privateKey);
}

describe("SupabaseTokenService", () => {
  it("accepts a valid token and maps the claims", async () => {
    await expect(svc().verify(await sign())).resolves.toEqual({
      sub: "sub-1",
      email: "a@b.co",
      role: "promoter",
      aal: "aal1",
    });
  });

  it("rejects an expired token", async () => {
    await expect(svc().verify(await sign({}, { exp: "-1s" }))).rejects.toThrow();
  });

  it("rejects a token signed by an unknown key", async () => {
    await expect(svc().verify(await sign({}, { key: otherKey }))).rejects.toThrow();
  });

  it("rejects a token without a subject", async () => {
    await expect(svc().verify(await sign({}, { sub: false }))).rejects.toThrow();
  });

  it("rejects a wrong audience", async () => {
    await expect(svc().verify(await sign({}, { aud: "other" }))).rejects.toThrow();
  });

  it("returns a null role when app_metadata.role is absent", async () => {
    const token = await sign({ app_metadata: {} });
    await expect(svc().verify(token)).resolves.toMatchObject({ role: null });
  });

  it("ignores the top-level supabase role claim", async () => {
    const token = await sign({ role: "authenticated", app_metadata: {} });
    await expect(svc().verify(token)).resolves.toMatchObject({ role: null });
  });

  it("maps aal2 and defaults unknown aal values to aal1", async () => {
    await expect(svc().verify(await sign({ aal: "aal2" }))).resolves.toMatchObject({ aal: "aal2" });
    await expect(svc().verify(await sign({ aal: "weird" }))).resolves.toMatchObject({ aal: "aal1" });
  });
});
