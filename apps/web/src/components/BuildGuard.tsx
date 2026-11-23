"use client";

import { useEffect, useState } from "react";

/** How often an open tab asks the server which build it is serving. */
const POLL_MS = 5 * 60_000;

/** The build id baked into the page that is running right now. */
function runningBuild() {
  return document.querySelector('meta[name="essentials-build"]')?.getAttribute("content") ?? null;
}

/**
 * The build id the server would send if the page were fetched fresh. Parsed out
 * of the HTML rather than an API endpoint, so it works for any deploy without
 * coordinating an environment variable between the web app and the API.
 */
async function servedBuild(): Promise<string | null> {
  const res = await fetch(window.location.href, { cache: "no-store", credentials: "same-origin" });
  if (!res.ok) return null;
  const html = await res.text();
  return (
    new DOMParser()
      .parseFromString(html, "text/html")
      .querySelector('meta[name="essentials-build"]')
      ?.getAttribute("content") ?? null
  );
}

/**
 * Warns when the tab is running an older build than the server. A browser that
 * keeps a page across a deploy then asks for chunk names the new build no longer
 * has, and the dashboard sits on its loading shell with no explanation.
 */
export function BuildGuard() {
  const [staleBuild, setStaleBuild] = useState(false);

  useEffect(() => {
    let cancelled = false;

    const check = async () => {
      const mine = runningBuild();
      if (!mine) return;
      const theirs = await servedBuild().catch(() => null);
      if (!cancelled && theirs && theirs !== mine) setStaleBuild(true);
    };

    const onFocus = () => {
      if (document.visibilityState === "visible") void check();
    };

    void check();
    const timer = window.setInterval(() => void check(), POLL_MS);
    window.addEventListener("focus", onFocus);
    document.addEventListener("visibilitychange", onFocus);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
      window.removeEventListener("focus", onFocus);
      document.removeEventListener("visibilitychange", onFocus);
    };
  }, []);

  if (!staleBuild) return null;

  return (
    <div
      role="alert"
      className="fixed bottom-4 left-1/2 z-[60] flex w-[min(28rem,calc(100vw-2rem))] -translate-x-1/2 items-center justify-between gap-3 rounded-xl border border-neon/60 bg-surface px-4 py-3 shadow-lg"
    >
      <p className="text-xs text-neutral-300">
        A new version of the dashboard was deployed. Reload to pick it up.
      </p>
      <button
        type="button"
        onClick={() => window.location.reload()}
        className="shrink-0 rounded-lg bg-neon px-3 py-2 text-[10px] font-black tracking-widest text-bg"
      >
        RELOAD
      </button>
    </div>
  );
}
