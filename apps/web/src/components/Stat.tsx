"use client";

export function Stat({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="border border-line bg-surface rounded-xl p-4">
      <div className="text-neutral-500 text-xs uppercase tracking-wider">{label}</div>
      <div className="text-2xl font-black mt-1">{value}</div>
    </div>
  );
}
