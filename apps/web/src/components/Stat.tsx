"use client";

export function Stat({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="group relative overflow-hidden rounded-2xl border border-line bg-surface/80 p-4 transition duration-200 hover:-translate-y-0.5 hover:border-neon/30 hover:bg-surface">
      <span className="absolute inset-x-4 top-0 h-px bg-gradient-to-r from-transparent via-neon/60 to-transparent opacity-40 transition group-hover:opacity-90" />
      <div className="flex items-start justify-between gap-2">
        <div className="text-[10px] font-bold uppercase tracking-[0.16em] text-neutral-500">{label}</div>
        <span className="mt-1 h-1.5 w-1.5 shrink-0 rounded-full bg-neon/40 shadow-[0_0_10px_rgba(0,255,102,0.35)]" />
      </div>
      <div className="mt-2 text-2xl font-black tabular-nums tracking-tight text-white">{value}</div>
    </div>
  );
}
