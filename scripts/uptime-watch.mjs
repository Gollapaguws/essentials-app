#!/usr/bin/env node
/**
 * Uptime watch — alerts when the public site or the API health endpoint stops
 * answering.
 *
 *   node scripts/uptime-watch.mjs              # one pass (what the timer runs)
 *   node scripts/uptime-watch.mjs --dry-run    # print alerts, send nothing
 *
 * A check has to fail `UPTIME_FAIL_THRESHOLD` passes in a row (default 3, so
 * about three minutes) before it counts as down: a single blip during a deploy
 * or a token refresh is not an outage. One alert goes out when it goes down, a
 * reminder every `UPTIME_REMIND_MINUTES` while it stays down, and one message
 * when it recovers. State lives in `UPTIME_STATE_FILE` so the timer does not
 * repeat itself on every pass.
 *
 * Alerts go to `ALERT_TELEGRAM_CHAT_ID` (comma-separated chats) through the
 * site's existing bot, and/or `ALERT_EMAIL` over the configured SMTP relay.
 * With neither set the pass still logs to the journal, so `journalctl -u
 * essentials-uptime` has the history.
 *
 * This runs on the same VPS it watches: it catches a dead API, a dead nginx or
 * a bad deploy, but not the whole machine going away. Pair it with an external
 * check for that.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
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

const DRY_RUN = process.argv.includes("--dry-run");
const ORIGIN = (process.env.SITE_URL ?? "https://essentialsedm.com").replace(/\/+$/, "");
const API = (process.env.API_URL ?? `${ORIGIN}/api`).replace(/\/+$/, "");
const TIMEOUT_MS = Number(process.env.UPTIME_TIMEOUT_MS ?? 10_000);
const THRESHOLD = Number(process.env.UPTIME_FAIL_THRESHOLD ?? 3);
const REMIND_MS = Number(process.env.UPTIME_REMIND_MINUTES ?? 30) * 60_000;
const STATE_FILE = process.env.UPTIME_STATE_FILE ?? "/var/lib/essentials-uptime/state.json";
const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN ?? "";
const CHAT_IDS = (process.env.ALERT_TELEGRAM_CHAT_ID ?? "")
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean);
const ALERT_EMAIL = process.env.ALERT_EMAIL ?? "";

/** Each check returns a short failure reason, or null when it passed. */
const checks = [
  {
    id: "site",
    name: "site",
    url: process.env.UPTIME_SITE_URL ?? `${ORIGIN}/`,
    async run() {
      const res = await fetch(this.url, {
        redirect: "follow",
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
      const body = await res.text();
      if (!res.ok) return `HTTP ${res.status}`;
      if (!body.includes('id="root"')) return "200 but the page body is not the site";
      return null;
    },
  },
  {
    id: "api",
    name: "API health",
    url: process.env.UPTIME_API_URL ?? `${API}/health`,
    async run() {
      const res = await fetch(this.url, {
        redirect: "follow",
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
      const text = await res.text();
      if (!res.ok) return `HTTP ${res.status}`;
      let body;
      try {
        body = JSON.parse(text);
      } catch {
        return "200 but the response is not JSON";
      }
      if (body?.ok !== true) return "200 but the response is not { ok: true }";
      return null;
    },
  },
];

function loadState() {
  try {
    return JSON.parse(readFileSync(STATE_FILE, "utf8"));
  } catch {
    return { checks: {} };
  }
}

function saveState(state) {
  try {
    mkdirSync(dirname(STATE_FILE), { recursive: true });
    writeFileSync(STATE_FILE, `${JSON.stringify(state, null, 2)}\n`);
  } catch (err) {
    console.error(`could not write ${STATE_FILE}: ${err.message}`);
  }
}

function humanDuration(ms) {
  const minutes = Math.max(1, Math.round(ms / 60_000));
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  return rest ? `${hours}h ${rest}m` : `${hours}h`;
}

function stamp() {
  return new Date().toISOString().replace("T", " ").slice(0, 19);
}

async function sendTelegram(text) {
  if (!BOT_TOKEN || !CHAT_IDS.length) return false;
  let sent = false;
  for (const chatId of CHAT_IDS) {
    try {
      const res = await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ chat_id: chatId, text, disable_web_page_preview: true }),
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
      if (res.ok) sent = true;
      else console.error(`telegram ${chatId}: HTTP ${res.status}`);
    } catch (err) {
      console.error(`telegram ${chatId}: ${err.message}`);
    }
  }
  return sent;
}

/**
 * The local relay needs no auth; a personal mailbox on Bluehost does (465 SSL/TLS
 * or 587 STARTTLS). Same env as the API, so switching providers keeps alerts working.
 */
async function sendEmail(subject, text) {
  if (!ALERT_EMAIL || !process.env.SMTP_HOST) return false;
  try {
    const { createTransport } = await import("nodemailer");
    const host = process.env.SMTP_HOST;
    const port = Number(process.env.SMTP_PORT || (process.env.SMTP_USER ? 465 : 25));
    const secure = process.env.SMTP_SECURE
      ? ["1", "true", "yes"].includes(process.env.SMTP_SECURE.toLowerCase())
      : port === 465;
    const local = ["127.0.0.1", "localhost", "::1"].includes(host);
    const transport = createTransport({
      host,
      port,
      secure,
      auth: process.env.SMTP_USER
        ? { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS ?? "" }
        : undefined,
      requireTLS: !secure && !local,
      tls: { rejectUnauthorized: !local },
    });
    await transport.sendMail({
      from: process.env.MAIL_FROM ?? `ESSENTIALS <noreply@essentialsedm.com>`,
      to: ALERT_EMAIL,
      subject,
      text,
    });
    return true;
  } catch (err) {
    console.error(`email to ${ALERT_EMAIL} failed: ${err.message}`);
    return false;
  }
}

async function alert(subject, text) {
  console.log(`[${stamp()}] ALERT ${subject}\n${text}`);
  if (DRY_RUN) return;
  const telegram = await sendTelegram(`${subject}\n\n${text}`);
  const email = await sendEmail(subject, text);
  if (!telegram && !email) {
    console.error(
      "no alert channel configured (set ALERT_TELEGRAM_CHAT_ID or ALERT_EMAIL) — logged only",
    );
  }
}

async function main() {
  const state = loadState();
  const results = await Promise.all(
    checks.map(async (check) => {
      try {
        return { check, failure: await check.run() };
      } catch (err) {
        const reason = err.name === "TimeoutError" ? `timed out after ${TIMEOUT_MS}ms` : err.message;
        return { check, failure: reason };
      }
    }),
  );

  for (const { check, failure } of results) {
    const previous = state.checks[check.id] ?? {};
    if (failure) {
      const failing = (previous.failing ?? 0) + 1;
      const entry = { ...previous, failing, lastFailure: failure };
      const downSince = previous.downSince ?? new Date().toISOString();
      const isDown = failing >= THRESHOLD;
      const dueForReminder =
        isDown && previous.downSince && Date.now() - new Date(previous.alertedAt).getTime() >= REMIND_MS;

      if (isDown && !previous.downSince) {
        entry.downSince = downSince;
        entry.alertedAt = new Date().toISOString();
        await alert(
          `🔴 ${check.name} is DOWN`,
          `${check.url}\n${failure}\n\nFailed ${failing} checks in a row. Reminders every ${REMIND_MS / 60_000}m until it recovers.`,
        );
      } else if (dueForReminder) {
        entry.alertedAt = new Date().toISOString();
        await alert(
          `🔴 ${check.name} is STILL DOWN`,
          `${check.url}\n${failure}\n\nDown for ${humanDuration(Date.now() - new Date(previous.downSince).getTime())}.`,
        );
      } else if (failing < THRESHOLD) {
        console.log(`[${stamp()}] ${check.name}: failing (${failing}/${THRESHOLD}) — ${failure}`);
      } else {
        console.log(`[${stamp()}] ${check.name}: still down — ${failure}`);
      }
      state.checks[check.id] = entry;
      continue;
    }

    if (previous.downSince) {
      await alert(
        `🟢 ${check.name} is back up`,
        `${check.url}\nRecovered after ${humanDuration(Date.now() - new Date(previous.downSince).getTime())}.`,
      );
    } else {
      console.log(`[${stamp()}] ${check.name}: ok`);
    }
    state.checks[check.id] = { failing: 0 };
  }

  if (!DRY_RUN) saveState(state);
}

main().catch((err) => {
  console.error(`uptime watch crashed: ${err.stack ?? err.message}`);
  process.exit(1);
});
