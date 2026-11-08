#!/usr/bin/env node
/**
 * Post-deploy smoke test — real HTTP calls against a running stack.
 *
 *   npm run smoke                  # health + lineup + auth + door pass
 *   npm run smoke -- --read-only   # health, lineup and auth service, no writes
 *
 * The full run creates a throwaway guest, RSVPs to an approved upcoming event,
 * fetches its door pass, checks the RBAC gate, then removes the RSVP, the
 * Supabase identity and the Prisma row. A stack with no eligible event reports
 * the door-pass checks as SKIP rather than failing the deploy.
 *
 * The lineup check always runs: it reads /site/content and, when DATABASE_URL
 * is set, asserts the confirmed DJs and their slot times on the front page are
 * exactly the confirmed bookings for those events — nothing missing, nothing
 * cancelled, nothing without a time.
 *
 * Env: API_URL (default http://127.0.0.1:4000/api), SUPABASE_URL
 * (default http://127.0.0.1:54321), plus DATABASE_URL,
 * SUPABASE_SERVICE_ROLE_KEY and SUPABASE_ANON_KEY (falls back to the service
 * role key for the password grant) — all read from .env when not exported.
 *
 * Exits non-zero if any check fails, so `npm run smoke` can gate a deploy.
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
const APIKEY = process.env.SUPABASE_ANON_KEY ?? SERVICE_KEY;
const READ_ONLY = process.argv.includes("--read-only");

const email = `smoke-${Date.now()}@example.test`;
const password = `${randomUUID()}Aa1!`;

let failures = 0;
let passes = 0;
let skips = 0;

function check(name, ok, detail) {
  if (ok) passes++;
  else failures++;
  console.log(`\n[${ok ? "PASS" : "FAIL"}] ${name}`);
  if (detail !== undefined) {
    console.log("       ", typeof detail === "string" ? detail : JSON.stringify(detail));
  }
}

function skip(name, reason) {
  skips++;
  console.log(`\n[SKIP] ${name}`);
  console.log("       ", reason);
}

async function req(url, { method = "GET", token, body, headers } = {}) {
  const res = await fetch(url, {
    method,
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...headers,
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
  return { status: res.status, body: parsed };
}

/**
 * The front page must show every confirmed DJ with the time they play, and no
 * one else. Compares what /site/content serves against the bookings table.
 */
async function checkLineup() {
  const content = await req(`${API}/site/content`);
  const events = Array.isArray(content.body?.events) ? content.body.events : [];
  check(
    "GET /site/content → 200 lineup",
    content.status === 200 && Array.isArray(content.body?.events),
    { status: content.status, entries: events.length },
  );
  if (content.status !== 200 || !Array.isArray(content.body?.events)) return;

  const listed = events.filter((e) => typeof e.eventId === "string");
  const withDjs = listed.filter((e) => Array.isArray(e.artists) && e.artists.length > 0);
  const malformed = withDjs.flatMap((e) =>
    e.artists
      .filter((a) => !a || typeof a.name !== "string" || !a.name || typeof a.time !== "string" || !a.time)
      .map((artist) => ({ event: e.title, artist })),
  );
  check(
    "every DJ on the lineup has a name and a time",
    malformed.length === 0,
    malformed.length ? malformed : `${withDjs.length} event(s) with DJs`,
  );

  if (!process.env.DATABASE_URL) {
    skip("lineup matches confirmed bookings", "DATABASE_URL not set");
    return;
  }
  if (listed.length === 0) {
    skip("lineup matches confirmed bookings", "no event-linked lineup entries");
    return;
  }

  const { prisma } = await import("@essentials/db");
  try {
    const bookings = await prisma.artistBooking.findMany({
      where: { eventId: { in: listed.map((e) => e.eventId) }, status: "confirmed" },
      select: {
        eventId: true,
        slot: true,
        slotRef: { select: { label: true } },
        artist: { select: { stageName: true } },
      },
      orderBy: { startAt: "asc" },
    });

    const expected = new Map();
    for (const booking of bookings) {
      const list = expected.get(booking.eventId) ?? [];
      list.push({
        name: booking.artist.stageName,
        time: booking.slotRef?.label ?? booking.slot ?? null,
      });
      expected.set(booking.eventId, list);
    }

    const mismatches = listed
      .map((e) => ({ event: e.title, want: expected.get(e.eventId) ?? [], got: e.artists ?? [] }))
      .filter(({ want, got }) => JSON.stringify(want) !== JSON.stringify(got));

    check(
      "lineup matches confirmed bookings",
      mismatches.length === 0,
      mismatches.length ? mismatches : `${bookings.length} confirmed booking(s) across ${listed.length} entr(ies)`,
    );
  } finally {
    await prisma.$disconnect();
  }
}

async function main() {
  if (!SERVICE_KEY || !APIKEY) {
    throw new Error("SUPABASE_SERVICE_ROLE_KEY and SUPABASE_ANON_KEY must be set");
  }

  console.log(`API: ${API}\nSupabase: ${SUPABASE}${READ_ONLY ? "\nMode: read-only" : ""}`);

  // 1. Health ------------------------------------------------------------
  const health = await req(`${API}/site/health`);
  check("GET /site/health → 200 ok", health.status === 200 && health.body?.ok === true, health.body);

  const gt = await req(`${GT}/health`);
  check("Supabase auth health → 200", gt.status === 200, gt.body?.name ?? gt.body);

  // 2. Front-page lineup (read-only, runs in both modes) ------------------
  await checkLineup();

  if (READ_ONLY) {
    console.log("\nRead-only: skipping auth and door-pass checks.");
    return;
  }

  // 2. Auth --------------------------------------------------------------
  let authUserId = null;
  let token = null;
  let eventId = null;

  try {
    const created = await req(`${GT}/admin/users`, {
      method: "POST",
      token: SERVICE_KEY,
      headers: { apikey: SERVICE_KEY },
      body: { email, password, email_confirm: true },
    });
    const user = created.body;
    authUserId = user?.id ?? null;
    check("create throwaway identity → 200", created.status === 200 && Boolean(authUserId), created.status);

    const granted = await fetch(`${GT}/token?grant_type=password`, {
      method: "POST",
      headers: { "Content-Type": "application/json", apikey: APIKEY },
      body: JSON.stringify({ email, password }),
      signal: AbortSignal.timeout(10_000),
    });
    const grant = await granted.json();
    token = grant.access_token ?? null;
    check(
      "password grant → access token",
      granted.status === 200 && typeof token === "string",
      granted.status,
    );
    if (!token) return;

    const me = await req(`${API}/auth/me`, { token });
    check(
      "GET /auth/me → 200 guest linked to a Prisma id",
      me.status === 200 && me.body?.user?.role === "guest" && typeof me.body?.user?.id === "string",
      { status: me.status, role: me.body?.user?.role },
    );

    const users = await req(`${API}/users`, { token });
    check("GET /users as guest → 403", users.status === 403, users.status);

    // The dashboard signs in with a server-side session, not a localStorage token.
    const login = await fetch(`${API}/auth/session`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email, password }),
      signal: AbortSignal.timeout(10_000),
    });
    const setCookie = login.headers.get("set-cookie") ?? "";
    const cookie = setCookie.split(";")[0] ?? "";
    check(
      "dashboard login → httpOnly session cookie",
      login.status === 200 && /^ess_dash=/.test(cookie) && /HttpOnly/i.test(setCookie),
      { status: login.status, httpOnly: /HttpOnly/i.test(setCookie) },
    );

    const cookieMe = await fetch(`${API}/auth/me`, { headers: { cookie } });
    check("GET /auth/me with the cookie → 200", cookieMe.status === 200, cookieMe.status);

    const logout = await fetch(`${API}/auth/session`, { method: "DELETE", headers: { cookie } });
    const cookieMeAfter = await fetch(`${API}/auth/me`, { headers: { cookie } });
    check(
      "logout revokes the server session",
      logout.status === 204 && cookieMeAfter.status === 401,
      { logout: logout.status, after: cookieMeAfter.status },
    );

    // 3. Door pass -------------------------------------------------------
    const feed = await req(`${API}/events`, { token });
    const events = Array.isArray(feed.body) ? feed.body : [];
    check("GET /events → 200 list", feed.status === 200 && Array.isArray(feed.body), {
      status: feed.status,
      count: events.length,
    });

    const event = events.find(
      (e) =>
        (e.status === "approved" || e.status === "live") &&
        new Date(e.date).getTime() > Date.now() &&
        (e.going ?? 0) < (e.capacity ?? 0),
    );

    if (!event) {
      skip("door pass", "no approved upcoming event with space — nothing to RSVP to");
    } else {
      eventId = event.id;

      const rsvp = await req(`${API}/events/${eventId}/rsvp`, {
        token,
        method: "POST",
        body: { headcount: 1 },
      });
      check("POST rsvp → attending", rsvp.status === 201 && rsvp.body?.status === "attending", rsvp.body);

      const pass = await req(`${API}/events/${eventId}/door-pass`, { token });
      const qrToken = pass.body?.qrToken ?? "";
      check(
        "GET door-pass → 200 signed token",
        pass.status === 200 && /^EL:[^:]+:[^:]+:[0-9a-f]{24}$/.test(qrToken),
        { status: pass.status, format: qrToken.slice(0, 3) },
      );

      const passAgain = await req(`${API}/events/${eventId}/door-pass`, { token });
      check("door pass is stable across fetches", passAgain.body?.qrToken === qrToken, passAgain.status);

      const key = process.env.QR_SECRET ?? process.env.JWT_SECRET;
      if (key && qrToken) {
        const expected = `EL:${eventId}:${me.body.user.id}:${createHmac("sha256", key)
          .update(`${eventId}:${me.body.user.id}`)
          .digest("hex")
          .slice(0, 24)}`;
        check("door pass signature matches the deployed key", qrToken === expected);
      } else {
        skip("door pass signature", "QR_SECRET/JWT_SECRET not in env");
      }

      const dup = await req(`${API}/events/${eventId}/rsvp`, {
        token,
        method: "POST",
        body: { headcount: 1 },
      });
      check("duplicate rsvp → 409", dup.status === 409, dup.status);

      const cancel = await req(`${API}/events/${eventId}/rsvp`, { token, method: "DELETE" });
      check("DELETE rsvp → 200", cancel.status === 200, cancel.status);
      if (cancel.status === 200) eventId = null;
    }
  } finally {
    // 4. Cleanup — always, even if a check threw.
    try {
      if (eventId && token) {
        await req(`${API}/events/${eventId}/rsvp`, { token, method: "DELETE" });
      }
      if (authUserId) {
        await req(`${GT}/admin/users/${authUserId}`, {
          method: "DELETE",
          token: SERVICE_KEY,
          headers: { apikey: SERVICE_KEY },
        });
      }
      if (process.env.DATABASE_URL) {
        const { prisma } = await import("@essentials/db");
        const removed = await prisma.user.deleteMany({ where: { email } });
        await prisma.$disconnect();
        console.log(`\nCleanup: removed ${removed.count} Prisma row(s) for ${email}`);
      }
    } catch (e) {
      failures++;
      console.error(`\n[CLEANUP FAILED] ${e.message}`);
      console.error(`  Remove ${email} manually (Supabase identity and/or Prisma row).`);
    }
  }
}

main()
  .then(() => {
    console.log(
      `\n${failures === 0 ? "SMOKE PASSED" : "SMOKE FAILED"} — ${passes} passed, ${failures} failed, ${skips} skipped`,
    );
    process.exit(failures === 0 ? 0 : 1);
  })
  .catch((e) => {
    console.error("\nSMOKE ABORTED:", e.message);
    process.exit(1);
  });
