#!/usr/bin/env node
/**
 * Browser end-to-end check for the deployed dashboard.
 *
 * The smoke script fetches HTML and chunks but never runs them, which is how a
 * dashboard that rendered "Loading…" forever still passed every check. This
 * drives a real Chromium: the login page must hydrate, its JS must arrive with a
 * JavaScript content type, a protected route must redirect to the login form,
 * and no page error may be thrown on the way.
 *
 * Read-only: it signs nobody in. Set SITE_URL (default https://essentialsedm.com)
 * and CHROMIUM_PATH to point at a specific binary.
 */
import { chromium } from "playwright-core";
import { findChromium } from "./lib/chromium.mjs";

const ORIGIN = (process.env.SITE_URL ?? process.env.DASHBOARD_URL ?? "https://essentialsedm.com").replace(/\/+$/, "");
const DASHBOARD = `${ORIGIN}/dashboard`;
const TIMEOUT_MS = Number(process.env.E2E_TIMEOUT_MS ?? 20_000);

const results = [];
function check(name, ok, detail) {
  results.push({ name, ok: Boolean(ok), detail });
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? ` — ${detail}` : ""}`);
}

const executablePath = findChromium();
if (!executablePath) {
  console.log("SKIP  no Chromium found (set CHROMIUM_PATH) — dashboard E2E not run");
  process.exit(0);
}

const browser = await chromium.launch({
  executablePath,
  headless: true,
  args: ["--no-sandbox", "--disable-dev-shm-usage"],
});

const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
const page = await context.newPage();

const pageErrors = [];
const consoleErrors = [];
const assetResponses = [];

page.on("pageerror", (err) => pageErrors.push(err.message));
page.on("console", (msg) => {
  if (msg.type() === "error") consoleErrors.push(msg.text());
});
page.on("response", (res) => {
  const url = res.url();
  if (url.includes("/_next/")) {
    assetResponses.push({ url, status: res.status(), type: res.headers()["content-type"] ?? "" });
  }
});

try {
  const login = await page.goto(`${DASHBOARD}/login`, { waitUntil: "domcontentloaded", timeout: TIMEOUT_MS });
  check("login page responds", Boolean(login && login.status() < 400), login ? `HTTP ${login.status()}` : "no response");

  let hydrated = true;
  try {
    await page.waitForSelector('input[type="email"]', { timeout: TIMEOUT_MS });
  } catch {
    hydrated = false;
  }
  check("login form hydrates", hydrated, hydrated ? "email field visible" : "email field never appeared");

  const signIn = await page
    .getByRole("button", { name: /sign in/i })
    .first()
    .textContent()
    .catch(() => null);
  check("sign-in button is live", Boolean(signIn), signIn ? `button reads "${signIn.trim()}"` : "no SIGN IN button");

  const loadingShell = await page.getByText(/checking your session/i).count();
  check("session check finishes", loadingShell === 0, loadingShell ? `still showing ${loadingShell} loading shell(s)` : "no loading shell");

  // The outage: chunks requested from a path nginx answered with index.html.
  const scripts = assetResponses.filter((r) => r.url.endsWith(".js"));
  const htmlChunks = scripts.filter((r) => r.type.includes("text/html"));
  check(
    "chunks are JavaScript",
    scripts.length > 0 && htmlChunks.length === 0,
    htmlChunks.length ? `${htmlChunks.length} chunk(s) served as text/html` : `${scripts.length} JS response(s)`,
  );
  const badStatus = assetResponses.filter((r) => r.status >= 400);
  check("chunks load", assetResponses.length > 0 && badStatus.length === 0, badStatus.length ? `${badStatus.length} asset(s) 4xx/5xx` : `${assetResponses.length} asset(s) ok`);

  const buildId = await page.getAttribute('meta[name="essentials-build"]', "content").catch(() => null);
  check("build id is stamped", Boolean(buildId), buildId ? `build ${buildId}` : "meta[name=essentials-build] missing");

  // A protected page must bounce to the login form rather than hang on the shell.
  await page.goto(`${DASHBOARD}/bookings`, { waitUntil: "domcontentloaded", timeout: TIMEOUT_MS });
  let redirected = true;
  try {
    await page.waitForURL(/\/dashboard\/login/, { timeout: TIMEOUT_MS });
    await page.waitForSelector('input[type="email"]', { timeout: TIMEOUT_MS });
  } catch {
    redirected = false;
  }
  check("protected route redirects to login", redirected, redirected ? page.url() : `stuck at ${page.url()}`);

  const mimeErrors = consoleErrors.filter((e) => /MIME type|Loading chunk|ChunkLoadError|is not a valid JavaScript/i.test(e));
  check("no module loading errors", mimeErrors.length === 0, mimeErrors[0]);

  check("no uncaught page errors", pageErrors.length === 0, pageErrors[0]);
} finally {
  await context.close();
  await browser.close();
}

const failed = results.filter((r) => !r.ok);
console.log(
  `\n${failed.length ? "E2E FAILED" : "E2E PASSED"} — ${results.length - failed.length} passed, ${failed.length} failed`,
);
process.exit(failed.length ? 1 : 0);
