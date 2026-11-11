#!/usr/bin/env node
/**
 * MFA + recovery-code smoke test against a running stack.
 *
 *   npm run smoke:mfa
 *
 * Creates a throwaway promoter (Supabase identity + Prisma row), signs in with
 * the dashboard session cookie, enrolls TOTP, verifies a generated code, checks
 * that privileged analytics now answer at aal2, then generates and consumes a
 * recovery code. Always removes the identity, sessions and codes.
 *
 * This is the deploy gate for the two things a plain smoke test cannot prove:
 * that a real second factor elevates the session, and that recovery codes are
 * issued and consumable against the deployed database.
 *
 * Env: API_URL (default http://127.0.0.1:4000/api), SUPABASE_URL
 * (default http://127.0.0.1:54321), SUPABASE_ANON_KEY, SUPABASE_SERVICE_ROLE_KEY
 * and DATABASE_URL — read from .env when not exported.
 *
 * Exits non-zero on failure or when the required credentials are missing.
 */
import { createHmac, randomUUID } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const envFile = resolve(root, ".env");
if (existsSync(envFile)) {
  for (const line of readFileSync(envFile, "utf8").split("\n")) {
    const m = /^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*?)\s*$/.exec(line);
    if (!m || m[1] in process.env) continue;
    let value = m[2];
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    process.env[m[1]] = value;
  }
}

const API = (process.env.API_URL ?? "http://127.0.0.1:4000/api").replace(/\/$/, "");
const SUPABASE = (process.env.SUPABASE_URL ?? "http://127.0.0.1:54321").replace(/\/$/, "");
const GT = `${SUPABASE}/auth/v1`;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const ANON_KEY = process.env.SUPABASE_ANON_KEY ?? SERVICE_KEY;

const email = `mfa-smoke-${Date.now()}@example.test`;
const password = `${randomUUID()}Aa1!`;

let passes = 0;
let failures = 0;

function check(name, ok, detail) {
  if (ok) passes++;
  else failures++;
  console.log(`\n[${ok ? "PASS" : "FAIL"}] ${name}`);
  if (detail !== undefined) {
    console.log("       ", typeof detail === "string" ? detail : JSON.stringify(detail));
  }
}

async function req(path, { method = "GET", cookie, body } = {}) {
  const res = await fetch(`${API}${path}`, {
    method,
    headers: {
      "Content-Type": "application/json",
      ...(cookie ? { cookie } : {}),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
    signal: AbortSignal.timeout(10_000),
  });
  const text = await res.text();
  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch {
    parsed = text;
  }
  return { status: res.status, body: parsed, headers: res.headers };
}

const B32 = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
function base32(input) {
  const clean = input.replace(/=+$/, "").replace(/\s/g, "").toUpperCase();
  let bits = 0;
  let value = 0;
  const bytes = [];
  for (const ch of clean) {
    const idx = B32.indexOf(ch);
    if (idx < 0) throw new Error("invalid TOTP secret");
    value = (value << 5) | idx;
    bits += 5;
    if (bits >= 8) {
      bits -= 8;
      bytes.push((value >>> bits) & 0xff);
    }
  }
  return Buffer.from(bytes);
}

function totp(secret) {
  const counter = Math.floor(Date.now() / 1000 / 30);
  const msg = Buffer.alloc(8);
  msg.writeBigUInt64BE(BigInt(counter));
  const h = createHmac("sha1", base32(secret)).update(msg).digest();
  const offset = h[h.length - 1] & 0x0f;
  return ((h.readUInt32BE(offset) & 0x7fffffff) % 1_000_000).toString().padStart(6, "0");
}

async function main() {
  if (!SERVICE_KEY || !ANON_KEY) {
    throw new Error("SUPABASE_SERVICE_ROLE_KEY and SUPABASE_ANON_KEY must be set");
  }
  if (!process.env.DATABASE_URL) {
    throw new Error("DATABASE_URL must be set: the promoter role lives in Prisma");
  }

  console.log(`API: ${API}\nSupabase: ${SUPABASE}\nAccount: ${email}`);

  const { prisma } = await import("@essentials/db");
  let authUserId = null;
  let userId = null;

  try {
    // A promoter is required for the analytics checks and must exist before the
    // first /auth/me so the role cache never sees a guest and has to expire.
    const created = await fetch(`${GT}/admin/users`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        apikey: SERVICE_KEY,
        Authorization: `Bearer ${SERVICE_KEY}`,
      },
      body: JSON.stringify({ email, password, email_confirm: true }),
      signal: AbortSignal.timeout(10_000),
    });
    const user = await created.json();
    authUserId = user?.id ?? null;
    check("create throwaway promoter identity → 200", created.status === 200 && Boolean(authUserId), created.status);
    if (!authUserId) return;

    const row = await prisma.user.create({
      data: { email, authUid: authUserId, role: "promoter" },
    });
    userId = row.id;

    const login = await fetch(`${API}/auth/session`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email, password }),
      signal: AbortSignal.timeout(10_000),
    });
    const setCookie = login.headers.get("set-cookie") ?? "";
    const cookie = setCookie.split(";")[0] ?? "";
    check("promoter signs in with a session cookie", login.status === 200 && /^ess_dash=/.test(cookie), {
      status: login.status,
      cookie: /^ess_dash=/.test(cookie),
    });
    if (login.status !== 200) return;

    const before = await req("/auth/me", { cookie });
    check(
      "MFA is required at aal1",
      before.status === 200 && before.body?.mfaRequired === true && before.body?.user?.aal === "aal1",
      { status: before.status, aal: before.body?.user?.aal, mfaRequired: before.body?.mfaRequired },
    );

    const factors = await req("/auth/mfa/factors", { cookie });
    check(
      "no TOTP factor enrolled yet",
      factors.status === 200 && Array.isArray(factors.body?.totp) && factors.body.totp.length === 0,
      { status: factors.status, factors: factors.body?.totp?.length },
    );

    const enroll = await req("/auth/mfa/enroll", { method: "POST", cookie, body: {} });
    const factorId = enroll.body?.id;
    const secret = enroll.body?.secret;
    check(
      "POST /auth/mfa/enroll → factor and secret",
      enroll.status === 200 && typeof factorId === "string" && typeof secret === "string",
      { status: enroll.status, factorId: typeof factorId === "string" },
    );
    if (!factorId || !secret) return;

    const challenge = await req("/auth/mfa/challenge", {
      method: "POST",
      cookie,
      body: { factorId },
    });
    const challengeId = challenge.body?.id;
    check(
      "POST /auth/mfa/challenge → challenge",
      challenge.status === 200 && typeof challengeId === "string",
      { status: challenge.status },
    );
    if (!challengeId) return;

    const code = totp(secret);
    const verify = await req("/auth/mfa/verify", {
      method: "POST",
      cookie,
      body: { factorId, challengeId, code },
    });
    check("POST /auth/mfa/verify → accepted", verify.status === 200 && verify.body?.ok === true, {
      status: verify.status,
    });

    const after = await req("/auth/me", { cookie });
    check(
      "session is aal2 and no longer challenged",
      after.status === 200 && after.body?.user?.aal === "aal2" && after.body?.mfaRequired === false,
      { status: after.status, aal: after.body?.user?.aal, mfaRequired: after.body?.mfaRequired },
    );

    const overview = await req("/analytics/overview", { cookie });
    check(
      "GET /analytics/overview at aal2 → 200",
      overview.status === 200 && typeof overview.body?.totals === "object",
      { status: overview.status },
    );

    const pacing = await req("/analytics/pacing", { cookie });
    check(
      "GET /analytics/pacing at aal2 → 200 list",
      pacing.status === 200 && Array.isArray(pacing.body),
      { status: pacing.status, rows: Array.isArray(pacing.body) ? pacing.body.length : undefined },
    );

    const recovery = await req("/auth/mfa/recovery", { method: "POST", cookie, body: {} });
    const codes = Array.isArray(recovery.body?.codes) ? recovery.body.codes : [];
    check(
      "POST /auth/mfa/recovery → ten codes",
      recovery.status === 200 && codes.length === 10,
      { status: recovery.status, codes: codes.length },
    );
    if (codes.length === 0) return;

    const consume = await req("/auth/mfa/recovery/consume", {
      method: "POST",
      cookie,
      body: { code: codes[0] },
    });
    check("consume a recovery code → 200", consume.status === 200 && consume.body?.ok === true, {
      status: consume.status,
    });

    const remaining = await req("/auth/mfa/recovery", { cookie });
    check(
      "recovery status drops to nine",
      remaining.status === 200 && remaining.body?.remaining === 9 && remaining.body?.total === 10,
      remaining.body,
    );
  } finally {
    try {
      if (authUserId) {
        await fetch(`${GT}/admin/users/${authUserId}`, {
          method: "DELETE",
          headers: { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}` },
          signal: AbortSignal.timeout(10_000),
        });
      }
      if (userId) {
        await prisma.mfaRecoveryCode.deleteMany({ where: { userId } });
        await prisma.dashboardSession.deleteMany({ where: { userId } });
        await prisma.user.deleteMany({ where: { id: userId } });
      } else {
        await prisma.user.deleteMany({ where: { email } });
      }
      await prisma.$disconnect();
      console.log(`\nCleanup: removed ${email} and its MFA data`);
    } catch (e) {
      failures++;
      console.error(`\n[CLEANUP FAILED] ${e.message}`);
      console.error(`  Remove ${email} manually (Supabase identity and/or Prisma rows).`);
    }
  }
}

main()
  .then(() => {
    console.log(
      `\n${failures === 0 ? "MFA SMOKE PASSED" : "MFA SMOKE FAILED"} — ${passes} passed, ${failures} failed`,
    );
    process.exit(failures === 0 ? 0 : 1);
  })
  .catch((e) => {
    console.error("\nMFA SMOKE ABORTED:", e.message);
    process.exit(1);
  });
