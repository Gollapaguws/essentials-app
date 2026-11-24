import { existsSync, readdirSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

/**
 * A Chromium to drive: CHROMIUM_PATH, a Playwright-managed build, or the system one.
 * Shared by the browser checks so they all find the same binary.
 */
export function findChromium() {
  if (process.env.CHROMIUM_PATH) return process.env.CHROMIUM_PATH;

  const root = join(homedir(), ".cache", "ms-playwright");
  if (existsSync(root)) {
    const builds = readdirSync(root)
      .filter((d) => d.startsWith("chromium-"))
      .sort()
      .reverse();
    for (const build of builds) {
      for (const dir of ["chrome-linux64", "chrome-linux"]) {
        const candidate = join(root, build, dir, "chrome");
        if (existsSync(candidate)) return candidate;
      }
    }
  }

  for (const candidate of [
    "/usr/bin/chromium-browser",
    "/usr/bin/chromium",
    "/usr/bin/google-chrome",
  ]) {
    if (existsSync(candidate)) return candidate;
  }
  return null;
}
