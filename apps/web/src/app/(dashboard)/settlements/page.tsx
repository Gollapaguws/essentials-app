"use client";

import { useEffect, useState } from "react";
import { TopNav } from "@/components/TopNav";
import { Stat } from "@/components/Stat";
import { api } from "@essentials/api-client";
import { errorMessage } from "@/lib/errors";

interface Gig {
  id: string;
  slot: string | null;
  startAt: string;
  status: string;
  completedAt: string | null;
  fee: number;
  artist: string;
  invoice: { id: string; number: string; status: string; total: number } | null;
  paid: number;
}

interface EventSettlement {
  id: string;
  title: string;
  date: string;
  venue: string;
  budget: number;
  committed: number;
  invoiced: number;
  paid: number;
  outstanding: number;
  revenue: number;
  margin: number;
  overBudget: boolean;
  gigs: Gig[];
}

interface Settlements {
  events: EventSettlement[];
  totals: {
    committed: number;
    invoiced: number;
    paid: number;
    outstanding: number;
    revenue: number;
    margin: number;
    nights: number;
  };
}

const rand = (v: number) => `R${v.toLocaleString()}`;

/** Where the DJ money is per night: agreed, billed, collected, still out. */
export default function Settlements() {
  const [data, setData] = useState<Settlements | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api
      .get<Settlements>("/artists/settlements")
      .then(setData)
      .catch((e) => setError(errorMessage(e) ?? "Could not load settlements."));
  }, []);

  const totals = data?.totals;

  return (
    <>
      <TopNav />
      <main className="max-w-5xl mx-auto px-6 py-8 space-y-6">
        <div>
          <h1 className="text-2xl font-black tracking-wide">SETTLEMENTS</h1>
          <p className="text-neutral-500 text-xs mt-1">
            DJ fees you have agreed per night, what the DJs have invoiced the venue, what has been
            paid, what is still outstanding, and the margin left after table revenue.
          </p>
        </div>

        {error && <p className="text-red-400 text-sm">{error}</p>}

        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <Stat label="Committed" value={rand(totals?.committed ?? 0)} />
          <Stat label="Invoiced" value={rand(totals?.invoiced ?? 0)} />
          <Stat label="Paid" value={rand(totals?.paid ?? 0)} />
          <Stat label="Outstanding" value={rand(totals?.outstanding ?? 0)} />
          <Stat label="Table revenue" value={rand(totals?.revenue ?? 0)} />
          <Stat label="Margin" value={rand(totals?.margin ?? 0)} />
        </div>

        <div className="border border-line rounded-xl overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-surface text-neutral-400 uppercase text-xs">
              <tr>
                <th className="text-left px-4 py-3">Night</th>
                <th className="text-right px-4 py-3">Committed</th>
                <th className="text-right px-4 py-3">Invoiced</th>
                <th className="text-right px-4 py-3">Paid</th>
                <th className="text-right px-4 py-3">Outstanding</th>
                <th className="text-right px-4 py-3">Revenue</th>
                <th className="text-right px-4 py-3">Margin</th>
              </tr>
            </thead>
            <tbody>
              {(data?.events ?? []).map((e) => (
                <tr key={e.id} className="border-t border-line align-top">
                  <td className="px-4 py-3">
                    <p className="font-bold">{e.title}</p>
                    <p className="text-neutral-500 text-xs">
                      {e.venue} · {new Date(e.date).toLocaleDateString()}
                      {e.budget > 0 ? ` · budget ${rand(e.budget)}` : ""}
                      {e.overBudget && <span className="text-red-400"> · over budget</span>}
                    </p>
                    {e.gigs.map((g) => (
                      <p key={g.id} className="text-neutral-500 text-xs mt-1">
                        {g.artist} · {g.slot ?? "slot TBA"} · {rand(g.fee)} ·{" "}
                        {g.invoice ? (
                          <span className={g.invoice.status === "paid" ? "text-neon" : g.invoice.status === "overdue" ? "text-red-400" : "text-neutral-300"}>
                            {g.invoice.number} {g.invoice.status}
                          </span>
                        ) : (
                          <span className="text-yellow-400">not invoiced</span>
                        )}
                        {g.status === "completed" ? "" : " · not yet played"}
                      </p>
                    ))}
                    {!e.gigs.length && <p className="text-neutral-600 text-xs mt-1">No confirmed DJs yet.</p>}
                  </td>
                  <td className="px-4 py-3 text-right">{rand(e.committed)}</td>
                  <td className="px-4 py-3 text-right">{rand(e.invoiced)}</td>
                  <td className="px-4 py-3 text-right text-neon">{rand(e.paid)}</td>
                  <td className="px-4 py-3 text-right">{rand(e.outstanding)}</td>
                  <td className="px-4 py-3 text-right">{rand(e.revenue)}</td>
                  <td className={`px-4 py-3 text-right ${e.margin < 0 ? "text-red-400" : "text-neon"}`}>
                    {rand(e.margin)}
                  </td>
                </tr>
              ))}
              {data && !data.events.length && (
                <tr>
                  <td colSpan={7} className="px-4 py-6 text-center text-neutral-500">
                    No confirmed DJ fees yet.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </main>
    </>
  );
}
