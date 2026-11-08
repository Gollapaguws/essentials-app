import { createUnsubscribeToken, readUnsubscribeToken, unsubscribeLink } from "./unsubscribe";

describe("unsubscribe tokens", () => {
  beforeAll(() => {
    process.env.EMAIL_UNSUBSCRIBE_SECRET = "test-unsubscribe-secret";
  });

  it("round-trips and normalises the address", () => {
    const token = createUnsubscribeToken("  Guest@Example.COM ");
    expect(readUnsubscribeToken(token)).toBe("guest@example.com");
  });

  it("rejects a tampered address", () => {
    const token = createUnsubscribeToken("guest@example.com");
    const [encoded, expires, sig] = token.split(".");
    const other = Buffer.from("attacker@example.com", "utf8").toString("base64url");
    expect(readUnsubscribeToken(`${other}.${expires}.${sig}`)).toBeNull();
    expect(encoded).not.toBe(other);
  });

  it("rejects a tampered signature", () => {
    const token = createUnsubscribeToken("guest@example.com");
    const [encoded, expires] = token.split(".");
    expect(readUnsubscribeToken(`${encoded}.${expires}.not-a-signature`)).toBeNull();
  });

  it("rejects an expired token", () => {
    const token = createUnsubscribeToken("guest@example.com", -1);
    expect(readUnsubscribeToken(token)).toBeNull();
  });

  it("rejects malformed input", () => {
    expect(readUnsubscribeToken("")).toBeNull();
    expect(readUnsubscribeToken("a.b")).toBeNull();
    expect(readUnsubscribeToken("a.b.c.d")).toBeNull();
  });

  it("builds a URL that carries the token, not the address", () => {
    const url = unsubscribeLink("guest@example.com", "https://essentialsedm.com/");
    expect(url).toContain("https://essentialsedm.com/api/email/unsubscribe?token=");
    expect(url).not.toContain("guest@example.com");
    const token = decodeURIComponent(url.split("token=")[1]);
    expect(readUnsubscribeToken(token)).toBe("guest@example.com");
  });
});
