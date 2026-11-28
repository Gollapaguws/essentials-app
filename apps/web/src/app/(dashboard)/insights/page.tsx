"use client";

import { TopNav } from "@/components/TopNav";
import { Stat } from "@/components/Stat";
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid, Legend } from "recharts";
import { useResource } from "@/hooks/useResource";

interface Ltv { averageLtv: number; topGuests: { userId: string; name: string | null; email: string; visits: number; doorSpend: number; ltv: number }[] }
interface Cohort { cohort: string; size: number; retention: { month: number; pct: number }[] }

/** Chart palette: the console's own tokens, so the charts move with the theme. */
const series = {
  accent: "var(--color-neon)",
  ink: "var(--color-fg)",
  muted: "var(--color-muted)",
  faint: "var(--color-faint)",
};
const axis = { fill: "var(--color-muted)", fontSize: 12 };
const tooltipStyle = {
  backgroundColor: "var(--color-surface)",
  border: "1px solid var(--color-line)",
  borderRadius: 8,
};

/** Phase 4 advanced analytics: lifetime value + cohort retention. */
export default function Insights() {
  const { data: ltv, error } = useResource<Ltv>("/insights/ltv");
  // Cohorts are optional decoration; a failure here must not hide the LTV table.
  const cohorts = useResource<Cohort[]>("/insights/cohorts").data ?? [];

  const cohortChart = cohorts.map((c) => ({
    name: c.cohort,
    M0: c.retention.find((r) => r.month === 0)?.pct ?? 0,
    M1: c.retention.find((r) => r.month === 1)?.pct ?? 0,
    M3: c.retention.find((r) => r.month === 3)?.pct ?? 0,
    M6: c.retention.find((r) => r.month === 6)?.pct ?? 0,
  }));

  return (
    <>
      <TopNav />
      <main className="max-w-6xl mx-auto px-6 py-8 space-y-8">
        <h1 className="text-2xl font-black tracking-wide">ADVANCED ANALYTICS</h1>
        {error && <p className="text-alert text-sm">{error}</p>}

        {ltv && (
          <section className="space-y-4">
            <Stat label="Average guest LTV" value={`R${ltv.averageLtv.toLocaleString()}`} />
            <div className="border border-line rounded-xl overflow-x-auto">
              <table className="w-full text-sm min-w-[640px]">
                <thead className="bg-surface text-muted uppercase text-xs">
                  <tr><th className="text-left px-4 py-3">Guest</th><th className="text-left px-4 py-3">Visits</th><th className="text-left px-4 py-3">Door est.</th><th className="text-left px-4 py-3">LTV</th></tr>
                </thead>
                <tbody>
                  {ltv.topGuests.map((g) => (
                    <tr key={g.userId} className="border-t border-line">
                      <td className="px-4 py-3 font-bold">{g.name ?? g.email}</td>
                      <td className="px-4 py-3">{g.visits}</td>
                      <td className="px-4 py-3">R{g.doorSpend.toLocaleString()}</td>
                      <td className="px-4 py-3 text-neon font-bold">R{g.ltv.toLocaleString()}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        )}

        <section className="border-t border-line bg-surface p-4">
          <h2 className="font-bold text-muted uppercase text-sm tracking-wider mb-4">Cohort retention (%)</h2>
          <ResponsiveContainer width="100%" height={280}>
            <BarChart data={cohortChart}>
              <CartesianGrid stroke="var(--color-line)" vertical={false} />
              <XAxis dataKey="name" tick={axis} stroke="var(--color-line)" />
              <YAxis tick={axis} unit="%" stroke="var(--color-line)" />
              <Tooltip
                contentStyle={tooltipStyle}
                itemStyle={{ color: "var(--color-fg)" }}
                labelStyle={{ color: "var(--color-muted)" }}
              />
              <Legend wrapperStyle={{ color: "var(--color-muted)" }} />
              <Bar dataKey="M0" fill={series.accent} name="Month 0" radius={[4, 4, 0, 0]} />
              <Bar dataKey="M1" fill={series.ink} name="Month 1" radius={[4, 4, 0, 0]} />
              <Bar dataKey="M3" fill={series.muted} name="Month 3" radius={[4, 4, 0, 0]} />
              <Bar dataKey="M6" fill={series.faint} name="Month 6" radius={[4, 4, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
          <div className="overflow-x-auto mt-4">
            <table className="w-full text-sm min-w-[640px]">
              <thead className="text-muted uppercase text-xs">
                <tr><th className="text-left px-4 py-2">Cohort</th><th className="text-left px-4 py-2">Size</th><th className="text-left px-4 py-2">Retention curve</th></tr>
              </thead>
              <tbody>
                {cohorts.map((c) => (
                  <tr key={c.cohort} className="border-t border-line">
                    <td className="px-4 py-2 font-mono">{c.cohort}</td>
                    <td className="px-4 py-2">{c.size}</td>
                    <td className="px-4 py-2">
                      {c.retention.map((r) => (
                        <span key={r.month} className="inline-block mr-3">
                          <span className="text-muted">M{r.month}</span>{" "}
                          <span className={r.pct >= 40 ? "text-neon" : r.pct >= 20 ? "text-fg" : "text-muted"}>{r.pct}%</span>
                        </span>
                      ))}
                    </td>
                  </tr>
                ))}
                {!cohorts.length && <tr><td colSpan={3} className="px-4 py-6 text-center text-muted">No check-in data yet.</td></tr>}
              </tbody>
            </table>
          </div>
        </section>
      </main>
    </>
  );
}
