"use client";

import { useEffect } from "react";
import Link from "next/link";

/**
 * Without this file one thrown render error blanks the whole console: Next has
 * nothing to fall back to. Plain markup on purpose — this must not depend on any
 * component that could be the thing that failed.
 */
export default function DashboardError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    // The API logs the same failure server-side; this keeps the browser copy visible
    // to anyone with the console open.
    console.error(error);
  }, [error]);

  return (
    <main className="mx-auto flex min-h-screen max-w-xl flex-col justify-center gap-4 px-6">
      <p className="text-[10px] uppercase tracking-[0.3em] text-muted">Console</p>
      <h1 className="text-2xl font-black tracking-wide">THIS SCREEN BROKE</h1>
      <p className="text-sm text-muted">
        Something failed while rendering this page. Nothing you saved was lost — try again, and if it
        keeps happening send us the reference below.
      </p>
      {error.digest && (
        <p className="rounded-lg border border-line bg-surface px-3 py-2 font-mono text-xs text-muted">
          reference: {error.digest}
        </p>
      )}
      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={reset}
          className="console-btn console-btn-primary px-4"
        >
          TRY AGAIN
        </button>
        <Link href="/" className="text-xs uppercase tracking-widest text-muted hover:text-neon">
          Back to dashboard
        </Link>
      </div>
    </main>
  );
}
