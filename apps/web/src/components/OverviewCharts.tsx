"use client";

import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid, Legend } from "recharts";

/** Chart palette: the console's own tokens, so the charts move with the theme. */
const series = {
  accent: "var(--color-neon)",
  ink: "var(--color-fg)",
  muted: "var(--color-muted)",
  faint: "var(--color-faint)",
};
const tick = { fill: "var(--color-muted)", fontSize: 12 };
const tooltipStyle = {
  backgroundColor: "var(--color-surface)",
  border: "1px solid var(--color-line)",
  borderRadius: 8,
};

export function OverviewCharts({
  perEvent,
}: {
  perEvent: { name: string; rsvps: number; door: number; noShows: number }[];
}) {
  return (
    <div className="grid md:grid-cols-2 gap-6">
      <section className="border-t border-line bg-surface rounded-none p-4">
        <h2 className="text-sm font-bold text-muted uppercase tracking-wider mb-4">Door vs list & no-shows per event</h2>
        <ResponsiveContainer width="100%" height={260}>
          <BarChart data={perEvent}>
            <CartesianGrid stroke="var(--color-line)" vertical={false} />
            <XAxis dataKey="name" tick={tick} stroke="var(--color-line)" />
            <YAxis tick={tick} stroke="var(--color-line)" />
            <Tooltip
              contentStyle={tooltipStyle}
              itemStyle={{ color: "var(--color-fg)" }}
              labelStyle={{ color: "var(--color-muted)" }}
            />
            <Legend wrapperStyle={{ color: "var(--color-muted)" }} />
            <Bar dataKey="rsvps" name="List" fill={series.accent} radius={[4, 4, 0, 0]} />
            <Bar dataKey="door" name="Door" fill={series.ink} radius={[4, 4, 0, 0]} />
            <Bar dataKey="noShows" name="No-shows" fill={series.muted} radius={[4, 4, 0, 0]} />
          </BarChart>
        </ResponsiveContainer>
      </section>
    </div>
  );
}
