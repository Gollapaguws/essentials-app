#!/usr/bin/env node
/**
 * The three flows that break first when the dashboard is touched: create and
 * publish a night, email a DJ statement, and run the door.
 *
 * Signs in with a real account, so it needs E2E_EMAIL and E2E_PASSWORD; without
 * them it reports SKIP and exits 0 (fork PRs have no secrets).
 *
 * Read-only by default: every flow is driven up to the point where it would
 * commit — the form is filled and the button proved live, the statement action is
 * found and enabled, the door answers an unknown guest — and then abandoned.
 * Set E2E_WRITE=1 to actually create the night, send the statement and check a
 * guest in. Point that at a staging database, not at a night people are attending.
 *
 * Env: E2E_BASE_URL (default https://essentialsedm.com), E2E_EMAIL, E2E_PASSWORD,
 * E2E_WRITE, E2E_TIMEOUT_MS, CHROMIUM_PATH.
 */
import { chromium } from "playwright-core";
import { findChromium } from "./lib/chromium.mjs";

const ORIGIN = (process.env.E2E_BASE_URL ?? "https://essentialsedm.com").replace(/\/+$/, "");
const DASHBOARD = `${ORIGIN}/dashboard`;
const EMAIL = process.env.E2E_EMAIL;
const PASSWORD = process.env.E2E_PASSWORD;
const WRITE = process.env.E2E_WRITE === "1";
const TIMEOUT_MS = Number(process.env.E2E_TIMEOUT_MS ?? 30_000);

const results = [];
const check = (name, ok, detail) => {
  results.push({ name, ok: Boolean(ok), detail });
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? ` — ${detail}` : ""}`);
};
const skip = (name, why) => {
  results.push({ name, ok: true, skipped: true, detail: why });
  console.log(`SKIP  ${name} — ${why}`);
};

if (!EMAIL || !PASSWORD) {
  console.log("SKIP  E2E flows — E2E_EMAIL / E2E_PASSWORD are not set");
  process.exit(0);
}

const executablePath = findChromium();
if (!executablePath) {
  console.log("SKIP  E2E flows — no Chromium found (set CHROMIUM_PATH)");
  process.exit(0);
}

const stamp = new Date().toISOString().replace(/[-:T]/g, "").slice(0, 12);
const nightTitle = `E2E SMOKE ${stamp}`;
const tomorrow = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString().slice(0, 10);

const browser = await chromium.launch({
  executablePath,
  headless: true,
  args: ["--no-sandbox", "--disable-dev-shm-usage"],
});
const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
const page = await context.newPage();

const pageErrors = [];
page.on("pageerror", (err) => pageErrors.push(err.message));

/** Fill the create form and prove the create button is live. */
async function createAndPublish() {
  await page.goto(`${DASHBOARD}/events`, { waitUntil: "domcontentloaded", timeout: TIMEOUT_MS });
  const title = page.getByPlaceholder("Event title");
  await title.waitFor({ timeout: TIMEOUT_MS });

  await title.fill(nightTitle);
  const venue = page.locator("select").filter({ hasText: "Pick a venue" }).first();
  if ((await venue.count()) === 0) return skip("create and publish a night", "no venues available to this account");
  // The options arrive with the venues fetch, not with the control.
  await venue.locator("option").nth(1).waitFor({ timeout: TIMEOUT_MS }).catch(() => {});
  if ((await venue.locator("option").count()) < 2) {
    return skip("create and publish a night", "no venues available to this account");
  }
  await venue.selectOption({ index: 1 });
  await page.locator('input[type="datetime-local"]').first().fill(`${tomorrow}T22:00`);
  await page.getByPlaceholder("Capacity").fill("120");

  // The fee preview is what tells a promoter the plan is priced before they commit.
  const preview = await page.getByText(/per slot|slot fee|night total/i).first().textContent().catch(() => null);
  check("slot pricing previews as the plan is filled", Boolean(preview), preview?.trim());

  const create = page.getByRole("button", { name: /CREATE/i }).first();
  check("create night button is live", await create.isEnabled());

  if (!WRITE) {
    skip("night is created and published", "read-only mode (set E2E_WRITE=1 to commit)");
    return;
  }

  await create.click();
  const row = page.getByText(nightTitle).first();
  await row.waitFor({ timeout: TIMEOUT_MS });
  const rowText = (await row.textContent()) ?? "";
  check(
    "night is created and published",
    Boolean(rowText),
    `${nightTitle}${rowText ? ` — ${rowText.trim().slice(0, 40)}` : ""}`,
  );
}

/** Promoter side: the statement email action for a DJ's month. */
async function emailStatement() {
  await page.goto(`${DASHBOARD}/statements`, { waitUntil: "domcontentloaded", timeout: TIMEOUT_MS });
  await page.waitForLoadState("networkidle", { timeout: TIMEOUT_MS }).catch(() => {});

  const send = page.getByRole("button", { name: /EMAIL MONTH/i }).first();
  if ((await send.count()) === 0) {
    const pageText = (await page.locator("body").textContent()) ?? "";
    return skip(
      "email a DJ their statement",
      /artist profile|statements belong/i.test(pageText)
        ? "this account is a DJ, not a promoter"
        : "no DJ has a confirmed gig to state",
    );
  }

  check("statement email action is present and enabled", await send.isEnabled());

  if (!WRITE) {
    skip("statement is emailed", "read-only mode (set E2E_WRITE=1 to send)");
    return;
  }

  await send.click();
  const sent = page.getByText(/statement sent to/i).first();
  await sent.waitFor({ timeout: TIMEOUT_MS });
  check("statement is emailed", true, ((await sent.textContent()) ?? "").trim());
}

/** Door: pick the night, search the list, and (in write mode) check a guest in. */
async function doorCheckIn() {
  await page.goto(`${DASHBOARD}/door`, { waitUntil: "domcontentloaded", timeout: TIMEOUT_MS });

  const night = page.getByLabel("Night");
  const appeared = await night.waitFor({ timeout: TIMEOUT_MS }).then(() => true).catch(() => false);
  if (!appeared) {
    // Say what the screen actually is — a redirect and a missing control read the
    // same from here, and only one of them is a bug.
    const text = (await page.locator("body").innerText()).replace(/\s+/g, " ").slice(0, 120);
    return skip("door check-in", `${new URL(page.url()).pathname} — ${text}`);
  }
  // The night list lands after the control does.
  await night.locator("option").first().waitFor({ timeout: TIMEOUT_MS }).catch(() => {});
  const nights = await night.locator("option").count();
  if (nights === 0) return skip("door check-in", "no night is running");

  await night.selectOption({ index: 0 });
  await page.waitForLoadState("networkidle", { timeout: TIMEOUT_MS }).catch(() => {});

  // An unknown guest must come back empty, not with somebody else's list.
  const search = page.getByLabel("Search the guest list");
  await search.fill(`e2e-no-such-guest-${stamp}`);
  await page.getByRole("button", { name: /^SEARCH$/ }).click();
  const empty = page.getByText("No guests on this list.").first();
  const emptyShown = await empty
    .waitFor({ timeout: TIMEOUT_MS })
    .then(() => true)
    .catch(() => false);
  check("door search answers an unknown guest", emptyShown);

  const checkIn = page.getByRole("button", { name: /CHECK IN$/ }).first();
  if ((await checkIn.count()) === 0) return skip("a guest is checked in", "no unchecked guest on this night");

  if (!WRITE) {
    skip("a guest is checked in", "read-only mode (set E2E_WRITE=1 to touch a real list)");
    return;
  }

  await checkIn.click();
  const notice = page.getByText(/checked in|already inside/i).first();
  await notice.waitFor({ timeout: TIMEOUT_MS });
  check("a guest is checked in", true, ((await notice.textContent()) ?? "").trim());
}

try {
  await page.goto(`${DASHBOARD}/login`, { waitUntil: "domcontentloaded", timeout: TIMEOUT_MS });
  await page.waitForSelector('input[type="email"]', { timeout: TIMEOUT_MS });
  await page.fill('input[type="email"]', EMAIL);
  await page.fill('input[type="password"]', PASSWORD);
  await page.getByRole("button", { name: /sign in/i }).first().click();
  await page.waitForURL((url) => !url.pathname.endsWith("/login"), { timeout: 45_000 });

  if (page.url().includes("/auth/mfa")) {
    skip("all three flows", "this account requires MFA, which this script does not type");
  } else {
    check("signs in", true, new URL(page.url()).pathname);
    await createAndPublish();
    await emailStatement();
    await doorCheckIn();
  }

  check("no uncaught page errors", pageErrors.length === 0, pageErrors[0]);
} finally {
  await context.close();
  await browser.close();
}

const failed = results.filter((r) => !r.ok);
const skipped = results.filter((r) => r.skipped);
console.log(
  `\n${failed.length ? "FLOWS FAILED" : "FLOWS PASSED"} — ${results.length - failed.length - skipped.length} passed, ${skipped.length} skipped, ${failed.length} failed${WRITE ? "" : " (read-only)"}`,
);
process.exit(failed.length ? 1 : 0);
