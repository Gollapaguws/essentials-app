"use client";

import { BarChart, Bar, LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid, Legend } from "recharts";

const axis = { stroke: "#555", fontSize: 12 };
const tooltipStyle = { backgroundColor: "#141414", border: "1px solid #222", borderRadius: 8 };

export function OverviewCharts({
  perEvent,
  perVenue,
}: {
  perEvent: { name: string; rsvps: number; door: number; noShows: number; tableRevenue: number }[];
  perVenue: { venue: string; tableRevenue: number; rsvps: number }[];
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

      <section className="border border-line bg-surface rounded-xl p-4">
        <h2 className="text-sm font-bold text-neutral-400 uppercase tracking-wider mb-4">Table revenue per event</h2>
        <ResponsiveContainer width="100%" height={260}>
          <LineChart data={perEvent}>
            <CartesianGrid stroke="#1c1c1c" />
            <XAxis dataKey="name" tick={axis} />
            <YAxis tick={axis} />
            <Tooltip contentStyle={tooltipStyle} />
            <Line type="monotone" dataKey="tableRevenue" name="Table revenue" stroke="#00FF66" strokeWidth={2} dot={{ fill: "#00FF66" }} />
          </LineChart>
        </ResponsiveContainer>
      </section>

      <section className="border border-line bg-surface rounded-xl p-4 md:col-span-2">
        <h2 className="text-sm font-bold text-neutral-400 uppercase tracking-wider mb-4">Revenue per venue</h2>
        <ResponsiveContainer width="100%" height={240}>
          <BarChart data={perVenue}>
            <CartesianGrid stroke="#1c1c1c" />
            <XAxis dataKey="venue" tick={axis} />
            <YAxis tick={axis} />
            <Tooltip contentStyle={tooltipStyle} />
            <Legend />
            <Bar dataKey="tableRevenue" name="Table revenue" fill="#00FF66" radius={[4, 4, 0, 0]} />
            <Bar dataKey="rsvps" name="RSVPs" fill="#555" radius={[4, 4, 0, 0]} />
          </BarChart>
        </ResponsiveContainer>
      </section>
    </div>
  );
}
