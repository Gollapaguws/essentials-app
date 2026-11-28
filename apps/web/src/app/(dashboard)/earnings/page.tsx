"use client";

import { useState } from "react";
import { TopNav } from "@/components/TopNav";
import { Stat } from "@/components/Stat";
import { API_URL, api } from "@essentials/api-client";
import { errorMessage } from "@/lib/errors";
import { useResource } from "@/hooks/useResource";

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
  travelFee: number;
  amount: number;
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
  if (!gig.invoice) return { label: "not invoiced", className: "text-warn" };
  if (gig.invoice.status === "paid") return { label: "paid", className: "text-neon" };
  if (gig.invoice.status === "overdue") return { label: "overdue", className: "text-alert" };
  return { label: `invoiced · ${gig.invoice.status}`, className: "text-muted" };
}

/** Artist: money earned from played gigs, what is invoiced, and what is still owed. */
export default function Earnings() {
  const source = useResource<Earnings>("/artists/earnings");
  const data = source.data;
  // An admin opening the page has no DJ profile yet — that is not an error.
  const noProfile = /artist profile/i.test(source.error ?? "");
  const loadError = noProfile ? null : source.error;

  const [busyId, setBusyId] = useState<string | null>(null);
  const [remindingId, setRemindingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const invoice = async (gig: PlayedGig) => {
    setBusyId(gig.id);
    setError(null);
    setNotice(null);
    try {
      const inv = await api.post<{ number: string }>("/invoices/generate", { bookingIds: [gig.id] });
      setNotice(`Invoice ${inv.number} sent to ${gig.venue} for ${rand(gig.amount)}.`);
      source.reload();
    } catch (e) {
      setError(errorMessage(e) ?? "Could not invoice this gig.");
    } finally {
      setBusyId(null);
    }
  };

  // The DJ owns the invoice, but the venue is the account that pays it.
  const remind = async (gig: PlayedGig) => {
    if (!gig.invoice) return;
    setRemindingId(gig.invoice.id);
    setError(null);
    setNotice(null);
    try {
      await api.post(`/invoices/${gig.invoice.id}/remind`);
      setNotice(`Reminder sent to ${gig.venue} for ${gig.invoice.number}.`);
    } catch (e) {
      setError(errorMessage(e) ?? "Could not send the reminder.");
    } finally {
      setRemindingId(null);
    }
  };

  const totals = data?.totals;

  return (
    <>
      <TopNav />
      <main className="max-w-4xl mx-auto px-6 py-8 space-y-6">
        <div>
          <h1 className="text-2xl font-black tracking-wide">EARNINGS</h1>
          <p className="text-muted text-xs mt-1">
            Gigs the promoter has confirmed you played — what you have billed, what has been paid,
            and what is still owed. Raise each invoice here, remind the venue while it is unpaid,
            and open the printed invoice for your records.
          </p>
        </div>

        {notice && <p className="text-neon text-sm">{notice}</p>}
        {(error ?? loadError) && (
          <p role="alert" className="text-alert text-sm">
            {error ?? loadError}
          </p>
        )}

        {noProfile && (
          <p className="border border-line bg-surface rounded-xl p-4 text-muted text-sm">
            Earnings belong to a DJ profile. Create one on{" "}
            <a href="/artist/profile" className="text-neon hover:underline">
              My Profile
            </a>{" "}
            to see your played gigs here.
          </p>
        )}

        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <Stat label="Earned" value={rand(totals?.earned ?? 0)} />
          <Stat label="Invoiced" value={rand(totals?.invoiced ?? 0)} />
          <Stat label="Paid" value={rand(totals?.paid ?? 0)} />
          <Stat label="Still owed" value={rand(totals?.outstanding ?? 0)} />
        </div>

        <p className="text-muted text-xs">
          {totals
            ? `${totals.gigs} played gig${totals.gigs === 1 ? "" : "s"} · ${rand(totals.readyToInvoice)} not yet invoiced (${totals.readyToInvoiceCount}) · ${rand(totals.awaitingPayment)} invoiced, waiting on the venue (${totals.awaitingPaymentCount})`
            : "loading…"}
        </p>

        <section className="border border-line bg-surface rounded-xl overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-[11px] uppercase tracking-widest text-muted border-b border-line">
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
                      <p className="text-muted text-xs">{gig.venue}</p>
                    </td>
                    <td className="px-4 py-3 text-muted text-xs">
                      {new Date(gig.startAt).toLocaleDateString()}
                    </td>
                    <td className="px-4 py-3 text-right font-bold">
                      {rand(gig.amount)}
                      {gig.travelFee > 0 && (
                        <span className="block text-muted text-[11px] font-normal">
                          {rand(gig.fee)} + {rand(gig.travelFee)} travel
                        </span>
                      )}
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className={`text-xs ${state.className}`}>{state.label}</span>
                        {gig.invoice && <span className="text-muted text-xs">{gig.invoice.number}</span>}
                        {gig.invoice && (
                          <a
                            href={`${API_URL}/invoices/${gig.invoice.id}/print`}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="text-neon text-xs underline underline-offset-2"
                          >
                            Print/PDF
                          </a>
                        )}
                        {gig.invoice && gig.invoice.status !== "paid" && (
                          <button
                            onClick={() => remind(gig)}
                            disabled={remindingId === gig.invoice.id}
                            title="Tell the venue manager this invoice is still unpaid"
                            className="border border-line text-fg rounded-lg px-2 py-0.5 text-[10px] tracking-widest disabled:opacity-40"
                          >
                            {remindingId === gig.invoice.id ? "SENDING…" : "REMIND VENUE"}
                          </button>
                        )}
                        {!gig.invoice && (
                          <button
                            disabled={busyId === gig.id || gig.fee <= 0}
                            onClick={() => invoice(gig)}
                            title={
                              gig.fee <= 0
                                ? "This gig has no agreed fee — the promoter sets the DJ fee per hour on the event"
                                : "Bill the venue for the agreed fee and return travel"
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
                  <td colSpan={4} className="px-4 py-8 text-center text-muted">
                    No played gigs yet. A gig lands here once the promoter confirms you played it.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </section>

        <p className="text-muted text-[11px]">
          Only a gig the promoter has confirmed as played can be invoiced. Invoices bill the agreed
          fee plus return travel from your home base to the venue at the platform rate. Add your home
          base in My Profile so travel can be calculated.
        </p>
      </main>
    </>
  );
}
