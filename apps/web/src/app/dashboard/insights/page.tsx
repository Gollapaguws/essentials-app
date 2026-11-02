"use client";

import { useEffect, useState } from "react";
import { TopNav } from "@/components/TopNav";
import { Stat } from "@/components/Stat";
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid, Legend } from "recharts";
import { api } from "@essentials/api-client";

interface Ltv { averageLtv: number; topGuests: { userId: string; name: string | null; email: string; visits: number; tableSpend: number; doorSpend: number; ltv: number }[] }
interface Cohort { cohort: string; size: number; retention: { month: number; pct: number }[] }

const axis = { stroke: "#555", fontSize: 12 };
const tooltipStyle = { backgroundColor: "#141414", border: "1px solid #222", borderRadius: 8 };

/** Phase 4 advanced analytics: lifetime value + cohort retention. */
export default function Insights() {
  const [ltv, setLtv] = useState<Ltv | null>(null);
  const [cohorts, setCohorts] = useState<Cohort[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api.get<Ltv>("/insights/ltv").then(setLtv).catch((e) => setError(e.message));
    api.get<Cohort[]>("/insights/cohorts").then(setCohorts).catch(() => {});
  }, []);

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
        {error && <p className="text-red-400 text-sm">{error}</p>}

        {ltv && (
          <section className="space-y-4">
            <Stat label="Average guest LTV" value={`R${ltv.averageLtv.toLocaleString()}`} />
            <div className="border border-line rounded-xl overflow-x-auto">
              <table className="w-full text-sm min-w-[640px]">
                <thead className="bg-surface text-neutral-400 uppercase text-xs">
                  <tr><th className="text-left px-4 py-3">Guest</th><th className="text-left px-4 py-3">Visits</th><th className="text-left px-4 py-3">Table spend</th><th className="text-left px-4 py-3">Door est.</th><th className="text-left px-4 py-3">LTV</th></tr>
                </thead>
                <tbody>
                  {ltv.topGuests.map((g) => (
                    <tr key={g.userId} className="border-t border-line">
                      <td className="px-4 py-3 font-bold">{g.name ?? g.email}</td>
                      <td className="px-4 py-3">{g.visits}</td>
                      <td className="px-4 py-3">R{g.tableSpend.toLocaleString()}</td>
                      <td className="px-4 py-3">R{g.doorSpend.toLocaleString()}</td>
                      <td className="px-4 py-3 text-neon font-bold">R{g.ltv.toLocaleString()}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        )}

        <section className="border border-line bg-surface rounded-xl p-4">
          <h2 className="font-bold text-neutral-400 uppercase text-sm tracking-wider mb-4">Cohort retention (%)</h2>
          <ResponsiveContainer width="100%" height={280}>
            <BarChart data={cohortChart}>
              <CartesianGrid stroke="#1c1c1c" />
              <XAxis dataKey="name" tick={axis} />
              <YAxis tick={axis} unit="%" />
              <Tooltip contentStyle={tooltipStyle} />
              <Legend />
              <Bar dataKey="M0" fill="#00FF66" name="Month 0" radius={[4, 4, 0, 0]} />
              <Bar dataKey="M1" fill="#00B24A" name="Month 1" radius={[4, 4, 0, 0]} />
              <Bar dataKey="M3" fill="#0AF" name="Month 3" radius={[4, 4, 0, 0]} />
              <Bar dataKey="M6" fill="#555" name="Month 6" radius={[4, 4, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
          <div className="overflow-x-auto mt-4">
            <table className="w-full text-sm min-w-[640px]">
              <thead className="text-neutral-400 uppercase text-xs">
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
                          <span className="text-neutral-500">M{r.month}</span>{" "}
                          <span className={r.pct >= 40 ? "text-neon" : r.pct >= 20 ? "text-white" : "text-neutral-500"}>{r.pct}%</span>
                        </span>
                      ))}
                    </td>
                  </tr>
                ))}
                {!cohorts.length && <tr><td colSpan={3} className="px-4 py-6 text-center text-neutral-500">No check-in data yet.</td></tr>}
              </tbody>
            </table>
          </div>
        </section>
      </main>
    </>
  );
}
