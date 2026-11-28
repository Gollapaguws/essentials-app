import type { ReactNode } from "react";

const tones = {
  neutral: "border-line bg-fg/[0.03] text-muted",
  success: "border-neon/30 bg-neon/10 text-neon",
  warning: "border-amber-500/30 bg-amber-500/10 text-warn",
  danger: "border-red-500/30 bg-red-500/10 text-alert",
  info: "border-sky-500/30 bg-sky-500/10 text-info",
} as const;

export function Badge({ tone = "neutral", children }: { tone?: keyof typeof tones; children: ReactNode }) {
  return <span className={`console-badge ${tones[tone]}`}>{children}</span>;
}

export function bookingTone(status: string): keyof typeof tones {
  if (status === "confirmed" || status === "completed" || status === "paid") return "success";
  if (status === "pending") return "warning";
  if (status === "cancelled" || status === "overdue") return "danger";
  return "neutral";
}
