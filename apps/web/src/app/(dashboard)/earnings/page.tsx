"use client";

import { useCallback, useEffect, useState } from "react";
import { TopNav } from "@/components/TopNav";
import { Stat } from "@/components/Stat";
import { api } from "@essentials/api-client";
import { errorMessage } from "@/lib/errors";

interface InvoiceRef {
  id: string;
  number: string;
  status: string;
  total: number;
}

interface PlayedGig {
  id: string;
  eventTitle: string;
  venue: string;
  startAt: string;
  completedAt: string | null;
  fee: number;
  invoice: InvoiceRef | null;
}

interface Earnings {
  gigs: PlayedGig[];
  totals: {
    earned: number;
    invoiced: number;
    paid: number;
    readyToInvoice: number;
    readyToInvoiceCount: number;
    awaitingPayment: number;
    awaitingPaymentCount: number;
    outstanding: number;
    gigs: number;
  };
}

const rand = (value: number) => `R${value.toLocaleString()}`;

/** Where a gig's money is: not billed, billed and waiting, or collected. */
function invoiceState(gig: PlayedGig) {
  if (!gig.invoice) return { label: "not invoiced", className: "text-yellow-400" };
  if (gig.invoice.status === "paid") return { label: "paid", className: "text-neon" };
  if (gig.invoice.status === "overdue") return { label: "overdue", className: "text-red-400" };
  return { label: `invoiced · ${gig.invoice.status}`, className: "text-neutral-400" };
}

/** Artist: money earned from played gigs, what is invoiced, and what is still owed. */
export default function Earnings() {
  const [data, setData] = useState<Earnings | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const load = useCallback(async () => {
    setError(null);
    try {
      setData(await api.get<Earnings>("/artists/earnings"));
    } catch (e) {
      setError(errorMessage(e) ?? "Could not load your earnings.");
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const invoice = async (gig: PlayedGig) => {
    setBusyId(gig.id);
    setError(null);
    setNotice(null);
    try {
      const inv = await api.post<{ number: string }>("/invoices/generate", { bookingIds: [gig.id] });
      setNotice(`Invoice ${inv.number} sent to ${gig.venue} for ${rand(gig.fee)}.`);
      await load();
    } catch (e) {
      setError(errorMessage(e) ?? "Could not invoice this gig.");
    } finally {
      setBusyId(null);
    }
  };

  const totals = data?.totals;

  return (
    <>
      <TopNav />
      <main className="max-w-4xl mx-auto px-6 py-8 space-y-6">
        <div>
          <h1 className="text-2xl font-black tracking-wide">EARNINGS</h1>
          <p className="text-neutral-500 text-xs mt-1">
            Gigs the promoter has confirmed you played — what you have billed, what has been paid,
            and what is still owed.
          </p>
        </div>

        {notice && <p className="text-neon text-sm">{notice}</p>}
        {error && <p className="text-red-400 text-sm">{error}</p>}

        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <Stat label="Earned" value={rand(totals?.earned ?? 0)} />
          <Stat label="Invoiced" value={rand(totals?.invoiced ?? 0)} />
          <Stat label="Paid" value={rand(totals?.paid ?? 0)} />
          <Stat label="Still owed" value={rand(totals?.outstanding ?? 0)} />
        </div>

        <p className="text-neutral-500 text-xs">
          {totals
            ? `${totals.gigs} played gig${totals.gigs === 1 ? "" : "s"} · ${rand(totals.readyToInvoice)} not yet invoiced (${totals.readyToInvoiceCount}) · ${rand(totals.awaitingPayment)} invoiced, waiting on the venue (${totals.awaitingPaymentCount})`
            : "loading…"}
        </p>

        <section className="border border-line bg-surface rounded-xl overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-[11px] uppercase tracking-widest text-neutral-500 border-b border-line">
                <th className="px-4 py-3">Gig</th>
                <th className="px-4 py-3">Played</th>
                <th className="px-4 py-3 text-right">Fee</th>
                <th className="px-4 py-3">Money</th>
              </tr>
            </thead>
            <tbody>
              {data?.gigs.map((gig) => {
                const state = invoiceState(gig);
                return (
                  <tr key={gig.id} className="border-t border-line align-top">
                    <td className="px-4 py-3">
                      <p className="font-bold">{gig.eventTitle}</p>
                      <p className="text-neutral-500 text-xs">{gig.venue}</p>
                    </td>
                    <td className="px-4 py-3 text-neutral-400 text-xs">
                      {new Date(gig.startAt).toLocaleDateString()}
                    </td>
                    <td className="px-4 py-3 text-right font-bold">{rand(gig.fee)}</td>
                    <td className="px-4 py-3">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className={`text-xs ${state.className}`}>{state.label}</span>
                        {gig.invoice && <span className="text-neutral-600 text-xs">{gig.invoice.number}</span>}
                        {!gig.invoice && (
                          <button
                            disabled={busyId === gig.id || gig.fee <= 0}
                            onClick={() => invoice(gig)}
                            title={
                              gig.fee <= 0
                                ? "This gig has no agreed fee — the promoter sets the DJ fee per hour on the event"
                                : "Bill the venue for the agreed fee"
                            }
                            className="bg-neon text-bg font-black rounded-lg px-3 py-1 text-[11px] tracking-widest disabled:opacity-40"
                          >
                            {busyId === gig.id ? "SENDING…" : "INVOICE VENUE"}
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                );
              })}
              {data && !data.gigs.length && (
                <tr>
                  <td colSpan={4} className="px-4 py-8 text-center text-neutral-500">
                    No played gigs yet. A gig lands here once the promoter confirms you played it.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </section>

        <p className="text-neutral-600 text-[11px]">
          Only a gig the promoter has confirmed as played can be invoiced. Invoices bill the agreed
          fee per gig — travel is priced separately at the platform rate.
        </p>
      </main>
    </>
  );
}
