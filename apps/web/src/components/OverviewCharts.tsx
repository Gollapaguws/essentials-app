"use client";

import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid, Legend } from "recharts";

const axis = { stroke: "#555", fontSize: 12 };
const tooltipStyle = { backgroundColor: "#141414", border: "1px solid #222", borderRadius: 8 };

export function OverviewCharts({
  perEvent,
}: {
  perEvent: { name: string; rsvps: number; door: number; noShows: number }[];
}) {
  return (
    <div className="grid md:grid-cols-2 gap-6">
      <section className="border border-line bg-surface rounded-xl p-4">
        <h2 className="text-sm font-bold text-neutral-400 uppercase tracking-wider mb-4">Door vs list & no-shows per event</h2>
        <ResponsiveContainer width="100%" height={260}>
          <BarChart data={perEvent}>
            <CartesianGrid stroke="#1c1c1c" />
            <XAxis dataKey="name" tick={axis} />
            <YAxis tick={axis} />
            <Tooltip contentStyle={tooltipStyle} />
            <Legend />
            <Bar dataKey="rsvps" name="List" fill="#00FF66" radius={[4, 4, 0, 0]} />
            <Bar dataKey="door" name="Door" fill="#0AFF" radius={[4, 4, 0, 0]} />
            <Bar dataKey="noShows" name="No-shows" fill="#FF3B5C" radius={[4, 4, 0, 0]} />
          </BarChart>
        </ResponsiveContainer>
      </section>
    </div>
  );
}
