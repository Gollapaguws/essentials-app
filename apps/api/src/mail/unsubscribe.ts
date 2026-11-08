import { createHmac, timingSafeEqual } from "crypto";

/**
 * Unsubscribe links are public and unauthenticated, so the address has to be
 * vouched for by the link itself. Each token is `base64url(email).exp.signature`
 * where the signature is an HMAC over the first two parts. Without it, anyone
 * could unsubscribe any address by editing `?email=` in the URL.
 */
const TTL_SECONDS = 90 * 24 * 60 * 60;

function signingKey(): string {
  const dedicated = process.env.EMAIL_UNSUBSCRIBE_SECRET;
  if (dedicated) return dedicated;

  // Derive a purpose-specific key rather than reusing another secret raw. QR_SECRET
  // is the door-pass key; JWT_SECRET is the legacy fallback EventsService already
  // uses for door passes, and it is present on the deployed server.
  const source = process.env.QR_SECRET ?? process.env.JWT_SECRET;
  if (source) return createHmac("sha256", source).update("unsubscribe-token-v1").digest("hex");

  if (process.env.NODE_ENV === "production") {
    throw new Error("EMAIL_UNSUBSCRIBE_SECRET (or QR_SECRET) must be set in production");
  }
  return "dev-unsubscribe-secret";
}

function signature(payload: string, key: string): string {
  return createHmac("sha256", key).update(payload).digest("base64url");
}

export function createUnsubscribeToken(email: string, ttlSeconds = TTL_SECONDS): string {
  const encoded = Buffer.from(email.trim().toLowerCase(), "utf8").toString("base64url");
  const expires = Math.floor(Date.now() / 1000) + ttlSeconds;
  const payload = `${encoded}.${expires}`;
  return `${payload}.${signature(payload, signingKey())}`;
}

/** The signed address, or null when the token is malformed, tampered with or expired. */
export function readUnsubscribeToken(token: string): string | null {
  const parts = token.split(".");
  if (parts.length !== 3) return null;
  const [encoded, expires, provided] = parts;

  const expected = signature(`${encoded}.${expires}`, signingKey());
  const a = Buffer.from(provided);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;

  const exp = Number(expires);
  if (!Number.isFinite(exp) || exp <= Math.floor(Date.now() / 1000)) return null;

  const email = Buffer.from(encoded, "base64url").toString("utf8").trim();
  return email.includes("@") ? email : null;
}

/** Absolute one-click unsubscribe URL for an email footer / List-Unsubscribe header. */
export function unsubscribeLink(email: string, siteUrl: string): string {
  const base = siteUrl.replace(/\/$/, "");
  return `${base}/api/email/unsubscribe?token=${encodeURIComponent(createUnsubscribeToken(email))}`;
}
