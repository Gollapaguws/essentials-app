"use client";

import { useEffect, useState } from "react";
import { Stat } from "@/components/Stat";
import { api } from "@essentials/api-client";
import { errorMessage } from "@/lib/errors";
import { ConsolePage } from "@/components/console/ConsolePage";
import { PageHeader } from "@/components/console/PageHeader";
import { Panel } from "@/components/console/Panel";
import { Badge } from "@/components/console/Badge";
import { DownloadButton } from "@/components/DownloadButton";

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
    nights: number;
  };
}

const rand = (v: number) => `R${v.toLocaleString()}`;

/** Where the DJ money is per night: agreed, billed, collected, still out. */
export default function Settlements() {
  const [data, setData] = useState<Settlements | null>(null);
  const [error, setError] = useState<string | null>(null);
  // The month a statement download covers; defaults to this one.
  const [month, setMonth] = useState(() => new Date().toISOString().slice(0, 7));

  useEffect(() => {
    api
      .get<Settlements>("/artists/settlements")
      .then(setData)
      .catch((e) => setError(errorMessage(e) ?? "Could not load settlements."));
  }, []);

  const totals = data?.totals;

  return (
    <ConsolePage size="lg">
      <PageHeader
        eyebrow="Night ops / Money"
        title="SETTLEMENTS"
        description="DJ fees you have agreed per night, what the DJs have invoiced the venue, what has been paid, and what is still outstanding."
        actions={
          <div className="flex flex-wrap items-center gap-3">
            <Badge tone="info">{totals?.nights ?? 0} nights</Badge>
            <label className="text-[10px] uppercase tracking-widest text-neutral-500">
              Statement month
              <input
                type="month"
                value={month}
                onChange={(e) => setMonth(e.target.value || month)}
                className="ml-2 bg-bg border border-line rounded-lg px-2 py-1 text-xs text-neutral-200"
              />
            </label>
            <DownloadButton
              path={`/artists/statements.csv?month=${month}`}
              filename={`statement-${month}.csv`}
              label="DOWNLOAD STATEMENT"
            />
          </div>
        }
      />

      {error && <p className="text-red-400 text-sm">{error}</p>}

      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <Stat label="Committed" value={rand(totals?.committed ?? 0)} />
        <Stat label="Invoiced" value={rand(totals?.invoiced ?? 0)} />
        <Stat label="Paid" value={rand(totals?.paid ?? 0)} />
        <Stat label="Outstanding" value={rand(totals?.outstanding ?? 0)} />
      </div>

      <Panel flush>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[720px] text-sm">
            <thead className="bg-surface text-neutral-400 uppercase text-xs">
              <tr>
                <th className="text-left px-4 py-3">Night</th>
                <th className="text-right px-4 py-3">Committed</th>
                <th className="text-right px-4 py-3">Invoiced</th>
                <th className="text-right px-4 py-3">Paid</th>
                <th className="text-right px-4 py-3">Outstanding</th>
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
                </tr>
              ))}
              {data && !data.events.length && (
                <tr>
                  <td colSpan={5} className="px-4 py-6 text-center text-neutral-500">
                    No confirmed DJ fees yet.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </Panel>
    </ConsolePage>
  );
}
