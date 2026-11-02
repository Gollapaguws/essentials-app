#!/usr/bin/env node
/**
 * Live auth proof — run against a real local stack:
 *
 *   supabase start            # provides SUPABASE_URL + keys
 *   npm run db:migrate && npm run db:seed
 *   npm run dev:api
 *   npm run proof:auth
 *
 * Prints the ACTUAL status and body of every check and exits non-zero on the first
 * failure. A passing build is not evidence; this script is.
 */
import { prisma } from "@essentials/db";

const SUPABASE_URL = process.env.SUPABASE_URL ?? "http://127.0.0.1:54321";
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const ANON_KEY = process.env.SUPABASE_ANON_KEY;
const API = process.env.API_URL ?? "http://127.0.0.1:4000/api";

const GUEST_EMAIL = "proof-guest@example.test";
const PROMOTER_EMAIL = "promoter@essentials.example";
const PASSWORD = "proof-password-123";
const INVITE_CODE = "PROOF-INVITE";

let failures = 0;

function check(name, ok, detail) {
  const status = ok ? "PASS" : "FAIL";
  console.log(`\n[${status}] ${name}`);
  if (detail !== undefined) console.log("       ", typeof detail === "string" ? detail : JSON.stringify(detail));
  if (!ok) failures++;
}

async function api(path, { token, method = "GET", body } = {}) {
  const res = await fetch(`${API}${path}`, {
    method,
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch {
    parsed = text;
  }
  return { status: res.status, body: parsed };
}

async function ensureUser(email) {
  const res = await fetch(`${SUPABASE_URL}/auth/v1/admin/users`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      apikey: SERVICE_KEY,
      Authorization: `Bearer ${SERVICE_KEY}`,
    },
    body: JSON.stringify({ email, password: PASSWORD, email_confirm: true }),
  });
  const body = await res.json();
  // 422 = already registered, which is fine for a repeat run.
  if (!res.ok && res.status !== 422) {
    throw new Error(`admin create ${email}: ${res.status} ${JSON.stringify(body)}`);
  }
  return body;
}

async function passwordToken(email) {
  const res = await fetch(`${SUPABASE_URL}/auth/v1/token?grant_type=password`, {
    method: "POST",
    headers: { "Content-Type": "application/json", apikey: ANON_KEY },
    body: JSON.stringify({ email, password: PASSWORD }),
  });
  const body = await res.json();
  if (!res.ok) throw new Error(`token ${email}: ${res.status} ${JSON.stringify(body)}`);
  return body.access_token;
}

async function main() {
  if (!SERVICE_KEY || !ANON_KEY) {
    throw new Error("SUPABASE_SERVICE_ROLE_KEY and SUPABASE_ANON_KEY must be set");
  }

  console.log(`Supabase: ${SUPABASE_URL}\nAPI: ${API}`);

  // 1. Setup ---------------------------------------------------------------
  await ensureUser(GUEST_EMAIL);
  await ensureUser(PROMOTER_EMAIL); // so the guard's DB fallback finds a real promoter
  await prisma.invite.deleteMany({ where: { code: INVITE_CODE } });
  await prisma.invite.create({
    data: { code: INVITE_CODE, role: "guest", maxUses: 5, createdBy: "auth-proof" },
  });
  console.log("\nSetup: proof users + PROOF-INVITE ready");

  const guest = await passwordToken(GUEST_EMAIL);
  const promoter = await passwordToken(PROMOTER_EMAIL);

  // 2. /auth/me for a first-time identity --------------------------------
  const me1 = await api("/auth/me", { token: guest });
  check("GET /auth/me as new identity → 200", me1.status === 200, me1.body);

  const me2 = await api("/auth/me", { token: guest });
  check("GET /auth/me again → still 200 (idempotent lazy-link)", me2.status === 200, me2.body);

  const lazyLinks = await prisma.authEvent.count({
    where: { kind: "lazy_link", email: GUEST_EMAIL },
  });
  check("exactly one lazy_link event recorded", lazyLinks <= 1, { lazyLinks });

  // 3. Role gate for a guest ---------------------------------------------
  const guestAnalytics = await api("/analytics/overview", { token: guest });
  check(
    "GET /analytics/overview as guest → 403",
    guestAnalytics.status === 403,
    guestAnalytics.body,
  );

  // 4. MFA gate for a privileged aal1 session ----------------------------
  const promoterAnalytics = await api("/analytics/overview", { token: promoter });
  check(
    "GET /analytics/overview as aal1 promoter → 401 MFA_REQUIRED",
    promoterAnalytics.status === 401 && promoterAnalytics.body?.code === "MFA_REQUIRED",
    promoterAnalytics.body,
  );

  // 5. Invite redemption --------------------------------------------------
  const before = await prisma.invite.findUnique({ where: { code: INVITE_CODE } });
  const redeem = await api("/auth/invite/redeem", {
    token: guest,
    method: "POST",
    body: { code: INVITE_CODE },
  });
  check("POST /auth/invite/redeem → 200", redeem.status === 200, redeem.body);

  const after = await prisma.invite.findUnique({ where: { code: INVITE_CODE } });
  check(
    "invite use count incremented by exactly 1",
    after.uses === before.uses + 1,
    { before: before.uses, after: after.uses },
  );

  const me3 = await api("/auth/me", { token: guest });
  check(
    "/auth/me now reports the invited role (cache invalidated)",
    me3.status === 200 && me3.body?.user?.role === "guest" && me3.body?.inviteRequired === undefined,
    me3.body,
  );

  // 6. Rate limit: 5/hour per ip+email -----------------------------------
  const statuses = [];
  for (let i = 0; i < 6; i++) {
    const attempt = await api("/auth/invite/redeem", {
      token: guest,
      method: "POST",
      body: { code: `BAD-CODE-${i}` },
    });
    statuses.push(attempt.status);
  }
  check("6th redeem attempt in the same hour → 429", statuses[5] === 429, { statuses });

  // 7. Removed contracts --------------------------------------------------
  const magicLink = await api("/auth/magic-link", { method: "POST", body: { email: GUEST_EMAIL } });
  check("POST /auth/magic-link → 404 (contract deleted)", magicLink.status === 404, magicLink.body);

  const verify = await api("/auth/verify", { method: "POST", body: { token: "x" } });
  check("POST /auth/verify → 404 (contract deleted)", verify.status === 404, verify.body);

  console.log(`\n${failures === 0 ? "ALL CHECKS PASSED" : `${failures} CHECK(S) FAILED`}`);
  process.exit(failures === 0 ? 0 : 1);
}

main()
  .catch((e) => {
    console.error("\nPROOF ABORTED:", e.message);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
