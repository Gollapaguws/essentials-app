"use client";

import type { ReactNode } from "react";

/**
 * Hover/focus tooltip with no state, portal or dependency: the bubble is a
 * sibling of the trigger shown by `group-hover` / `group-focus-within`, so it
 * works for links, buttons and form markers alike and never traps a click.
 */
export function Tooltip({
  label,
  children,
  className = "",
  align = "left",
}: {
  /** The hint itself. Keep it to one or two short sentences. */
  label: string;
  children: ReactNode;
  className?: string;
  /** Which edge of the trigger the bubble lines up with. */
  align?: "left" | "right";
}) {
  return (
    <span className={`relative inline-flex group ${className}`}>
      {children}
      <span
        role="tooltip"
        className={`pointer-events-none absolute top-full z-30 mt-2 w-max max-w-[260px] rounded-lg border border-line bg-surface px-3 py-2 text-[11px] font-normal leading-relaxed text-neutral-300 opacity-0 shadow-xl transition-opacity duration-150 group-hover:opacity-100 group-focus-within:opacity-100 ${
          align === "right" ? "right-0" : "left-0"
        }`}
      >
        {label}
      </span>
    </span>
  );
}

/** Small "?" marker for form fields, so the input itself keeps its full width. */
export function InfoTip({ label }: { label: string }) {
  return (
    <Tooltip label={label}>
      <button
        type="button"
        aria-label={label}
        className="grid h-4 w-4 place-items-center rounded-full border border-line text-[10px] font-bold text-neutral-500 hover:border-neon hover:text-neon focus:outline-none focus:border-neon focus:text-neon"
      >
        ?
      </button>
    </Tooltip>
  );
}
