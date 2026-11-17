#!/usr/bin/env node
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const baseline = JSON.parse(
  readFileSync(resolve(root, "scripts/production-audit-baseline.json"), "utf8"),
);
const allowed = new Set(baseline.allowed.map((entry) => entry.url));

let raw;
try {
  raw = execFileSync("npm", ["audit", "--omit=dev", "--json"], {
    cwd: root,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "ignore"],
    maxBuffer: 50 * 1024 * 1024,
  });
} catch (error) {
  raw = error.stdout;
}

if (!raw) {
  console.error("::error::npm audit did not produce a report");
  process.exit(1);
}

let report;
try {
  report = JSON.parse(raw);
} catch {
  console.error("::error::Could not parse the npm audit report");
  process.exit(1);
}

const counts = report.metadata?.vulnerabilities ?? {};
const findings = new Map();

for (const [pkg, vulnerability] of Object.entries(report.vulnerabilities ?? {})) {
  if (!["critical", "high"].includes(vulnerability.severity)) continue;

  for (const via of vulnerability.via ?? []) {
    if (typeof via !== "object") continue;
    const key = via.url ?? `${via.name}@${via.source}`;
    if (allowed.has(key)) continue;

    findings.set(key, {
      package: via.name ?? pkg,
      severity: via.severity ?? vulnerability.severity,
      title: via.title ?? "Unknown advisory",
      range: via.range ?? vulnerability.range,
      url: via.url ?? key,
    });
  }
}

console.log(
  `Production audit: ${counts.critical ?? 0} critical, ${counts.high ?? 0} high, ` +
    `${counts.moderate ?? 0} moderate, ${counts.low ?? 0} low.`,
);

if ((counts.critical ?? 0) > 0 && findings.size === 0) {
  console.error("::error::Production dependencies report critical advisories with no advisory details.");
  process.exit(1);
}

if (findings.size > 0) {
  console.error("New critical/high production dependency advisories:");
  for (const finding of findings.values()) {
    console.error(
      `- [${finding.severity}] ${finding.package}: ${finding.title} ` +
        `(affected ${finding.range}) ${finding.url}`,
    );
  }
  console.error(
    "Fix the dependency, or document an unpatchable advisory in scripts/production-audit-baseline.json.",
  );
  process.exit(1);
}

console.log(
  allowed.size === 0
    ? "No critical or high production advisories."
    : `No new critical/high advisories beyond ${allowed.size} documented unpatchable one(s).`,
);
