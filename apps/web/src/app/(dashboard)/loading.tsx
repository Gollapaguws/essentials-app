/**
 * Shown while a dashboard route's bundle loads. Each page still shows its own
 * "Loading…" for its data; this covers the gap before the page exists at all.
 */
export default function DashboardLoading() {
  return (
    <main className="mx-auto max-w-6xl space-y-6 px-6 py-8" aria-busy="true" aria-live="polite">
      <div className="space-y-2">
        <div className="h-2 w-24 animate-pulse rounded bg-white/10" />
        <div className="h-6 w-64 animate-pulse rounded bg-white/10" />
      </div>
      <div className="h-40 animate-pulse rounded-xl border border-line bg-surface/60" />
      <div className="h-40 animate-pulse rounded-xl border border-line bg-surface/60" />
      <p className="text-center text-[10px] uppercase tracking-[0.3em] text-neutral-600">Loading…</p>
    </main>
  );
}
