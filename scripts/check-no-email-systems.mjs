#!/usr/bin/env node
// Fails CI if the removed in-platform email systems come back.
//
// Marketing email is not part of the app: the audience and campaigns live in
// phpList at newsletters.essentialsedm.com. Two narrow exceptions are allowed:
// transactional account notices in apps/api/src/account-mail, and admin-
// provisioned local mailboxes in apps/api/src/user-mail (see
// docs/mailbox-provisioning.md). Everything else stays out unless the removal is
// deliberately reversed — in which case update this guard.
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { dirname, extname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const problems = [];

const removedPackages = ["resend", "mailparser", "@nestjs/bullmq"];
const removedDirs = [
  "apps/api/src/mail",
  "apps/api/src/email-engine",
  "apps/api/src/mailboxes",
];
const forbiddenSourcePatterns = [
  {
    label: "removed mail provider import",
    pattern: /(?:from|require\(|import\()\s*["'](?:resend|mailparser)["']/,
  },
  { label: "removed email-engine module", pattern: /(?:^|["'/])email-engine(?:\/|["'])/ },
  { label: "removed mailboxes module", pattern: /(?:^|["'/])mailboxes(?:\/|["'])/ },
  { label: "removed email API route", pattern: /["'`]\/api\/(?:email|mail|mailboxes)(?:\/|["'`])/ },
  { label: "removed email controller", pattern: /@Controller\(\s*["'](?:email|mail|mailboxes|email-engine)["']/ },
  { label: "removed subscribe route", pattern: /["'`]\/site\/subscribe["'`]/ },
  { label: "removed mail relay probe", pattern: /["'`]\/mail\/status["'`]/ },
  { label: "removed mail service", pattern: /\bMailService\b/ },
  { label: "removed mailboxes service", pattern: /\bMailboxes(?:Service|Module)\b/ },
  { label: "removed email-engine service", pattern: /\bEmailEngine(?:Service|Module)\b/ },
];

// The only sanctioned SMTP sender in the product.
const accountMailDir = "apps/api/src/account-mail/";
const nodemailerImport = /(?:from|require\(|import\()\s*["']nodemailer["']/;

const sourceExtensions = new Set([".ts", ".tsx", ".js", ".jsx", ".mjs"]);
const skipDirs = new Set([
  "node_modules",
  ".git",
  "dist",
  "build",
  ".next",
  ".next-build",
  ".next-e2e",
  "coverage",
  ".expo",
  "android",
  "ios",
]);

for (const dir of removedDirs) {
  if (existsSync(join(root, dir))) {
    problems.push(`${dir}: removed email system directory still exists`);
  }
}

function checkPackageJson(path, { isRoot = false } = {}) {
  const pkg = JSON.parse(readFileSync(path, "utf8"));
  for (const field of ["dependencies", "devDependencies", "optionalDependencies"]) {
    for (const name of removedPackages) {
      // The root copy is only for scripts/uptime-watch.mjs ops alerts.
      if (isRoot && name === "nodemailer") continue;
      if (pkg[field]?.[name]) {
        problems.push(`${relative(root, path)}: removed email dependency "${name}"`);
      }
    }
  }
}

checkPackageJson(join(root, "package.json"), { isRoot: true });
for (const group of ["apps", "packages"]) {
  const groupDir = join(root, group);
  if (!existsSync(groupDir)) continue;
  for (const entry of readdirSync(groupDir, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const pkgPath = join(groupDir, entry.name, "package.json");
    if (existsSync(pkgPath)) checkPackageJson(pkgPath);
  }
}

function walk(dir) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.name.startsWith(".") && entry.name !== ".env.example") continue;
    const path = join(dir, entry.name);
    if (entry.isDirectory()) {
      if (!skipDirs.has(entry.name)) walk(path);
      continue;
    }
    if (!sourceExtensions.has(extname(entry.name))) continue;
    if (path === fileURLToPath(import.meta.url)) continue;

    const rel = relative(root, path);
    const lines = readFileSync(path, "utf8").split("\n");
    lines.forEach((line, index) => {
      if (
        nodemailerImport.test(line) &&
        !rel.startsWith(accountMailDir) &&
        // Ops alerts may use SMTP; the product may not.
        rel !== "scripts/uptime-watch.mjs"
      ) {
        problems.push(
          `${rel}:${index + 1}: mail provider import outside the account-mail module`,
        );
      }
      for (const { label, pattern } of forbiddenSourcePatterns) {
        if (pattern.test(line)) {
          problems.push(`${rel}:${index + 1}: ${label}`);
        }
      }
    });
  }
}

for (const group of ["apps", "packages", "scripts"]) {
  const dir = join(root, group);
  if (existsSync(dir)) walk(dir);
}

if (problems.length > 0) {
  console.error("The in-platform email systems were removed. These references re-add them:\n");
  for (const problem of problems) console.error(`  - ${problem}`);
  console.error(
    "\nUse in-app or Telegram notifications, or the account-mail module for transactional notices.",
  );
  process.exit(1);
}

console.log("No in-platform email providers or email endpoints found.");
