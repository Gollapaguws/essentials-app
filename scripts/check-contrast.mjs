/**
 * Measure every text/background pair the light console actually renders, from
 * the tokens in apps/web/src/app/globals.css. Exits 1 if a pair misses WCAG AA.
 *
 * Body text needs 4.5:1, large text and UI edges need 3:1.
 *
 * Run: npm run check:contrast
 */
import { readFileSync } from "node:fs";

const css = readFileSync("apps/web/src/app/globals.css", "utf8");

/** Reads `--color-x: #rrggbb` out of the @theme block. */
function tokens() {
  const found = new Map();
  for (const [, name, hex] of css.matchAll(/--color-([a-z]+):\s*(#[0-9a-fA-F]{6})/g)) {
    found.set(name, hex.toLowerCase());
  }
  return found;
}

const theme = tokens();

function channel(value) {
  const c = value / 255;
  return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
}

function luminance(hex) {
  const r = channel(parseInt(hex.slice(1, 3), 16));
  const g = channel(parseInt(hex.slice(3, 5), 16));
  const b = channel(parseInt(hex.slice(5, 7), 16));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function ratio(foreground, background) {
  const a = luminance(foreground);
  const b = luminance(background);
  const [light, dark] = a > b ? [a, b] : [b, a];
  return (light + 0.05) / (dark + 0.05);
}

// [foreground, background, minimum] — only pairs the console actually paints.
const pairs = [
  ["fg", "bg", 4.5], // body copy on the page
  ["fg", "surface", 4.5], // body copy in a panel
  ["muted", "bg", 4.5], // lede, meta, table heads
  ["muted", "surface", 4.5],
  ["neon", "bg", 4.5], // accent links and values
  ["neon", "surface", 4.5],
  ["alert", "bg", 4.5], // errors
  ["alert", "surface", 4.5],
  ["warn", "bg", 4.5],
  ["info", "bg", 4.5],
  ["bg", "neon", 4.5], // primary button label on the brass fill
  ["neon", "bg", 3], // focus ring / UI edge — same pair, stricter of the two wins
  ["faint", "surface", 3], // tertiary chart series and marks
];

const missing = pairs.flatMap(([fg, bg]) => (theme.has(fg) && theme.has(bg) ? [] : [`${fg} on ${bg}`]));
if (missing.length) {
  console.error(`Missing colour tokens for: ${missing.join(", ")}`);
  process.exit(1);
}

let failed = 0;
const rows = pairs.map(([fg, bg, minimum]) => {
  const measured = ratio(theme.get(fg), theme.get(bg));
  const pass = measured >= minimum;
  if (!pass) failed += 1;
  return `${pass ? "pass" : "FAIL"}  ${`${fg} on ${bg}`.padEnd(24)} ${measured.toFixed(2)}:1  (needs ${minimum}:1)`;
});

console.log(rows.join("\n"));
if (failed) {
  console.error(`\n${failed} pair${failed === 1 ? "" : "s"} below AA.`);
  process.exit(1);
}
console.log("\nAll pairs meet AA.");
