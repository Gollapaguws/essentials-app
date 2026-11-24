"use client";

import { useState } from "react";
import { api } from "@essentials/api-client";
import { errorMessage } from "@/lib/errors";
import { useResource } from "@/hooks/useResource";
import { Panel } from "@/components/console/Panel";
import { Badge, bookingTone } from "@/components/console/Badge";
import { EmptyState } from "@/components/console/EmptyState";

interface DoorApplication {
  id: string;
  status: string;
  appliedAt?: string | null;
  completedAt?: string | null;
  declineReason?: string | null;
  fee: number;
  host: { name: string | null; email: string; travelRatePerKm: number };
  event: {
    id: string;
    title: string;
    date: string;
    budget: number;
    doorFee: number;
    committed: number;
  };
}

/** Promoter: the door-hosting queue, mirroring DJ applications. */
export function DoorApplicationsPanel() {
  const source = useResource<DoorApplication[]>("/door-gigs/applications");
  const applications = source.data ?? [];
  const [error, setError] = useState<string | null>(null);
  const [reasons, setReasons] = useState<Record<string, string>>({});
  const [busyId, setBusyId] = useState<string | null>(null);

  const decide = async (id: string, confirm: boolean) => {
    setError(null);
    setBusyId(id);
    try {
      await api.post(`/door-gigs/applications/${id}/decide`, {
        confirm,
        reason: reasons[id]?.trim() || undefined,
      });
      setReasons((prev) => ({ ...prev, [id]: "" }));
      source.reload();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusyId(null);
    }
  };

  // The second confirmation: the shift was worked. This unlocks invoicing.
  const complete = async (id: string) => {
    setError(null);
    setBusyId(id);
    try {
      await api.post(`/door-gigs/bookings/${id}/complete`);
      source.reload();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusyId(null);
    }
  };

  const pending = applications.filter((a) => a.status === "pending").length;
  const confirmed = applications.filter((a) => a.status === "confirmed").length;

  return (
    <Panel
      title="Door applications"
      description="Door hosts apply for nights with a door fee. Confirming promises money from the same budget as the DJs."
      actions={
        <>
          <Badge tone="warning">{pending} pending</Badge>
          <Badge tone="success">{confirmed} confirmed</Badge>
        </>
      }
      flush
    >
      {(error ?? source.error) && (
        <p role="alert" className="border-b border-line/70 px-4 py-2 text-sm text-red-400">
          {error ?? source.error}
        </p>
      )}
      {source.loading && <p className="px-4 py-2 text-xs text-neutral-500">Loading door applications…</p>}

      {applications.map((a) => {
        const overBudget = a.event.budget > 0 && a.event.committed + a.fee > a.event.budget;
        const happened = new Date(a.event.date).getTime() <= Date.now();
        return (
          <article key={a.id} className="border-t border-line/70 px-4 py-4 first:border-t-0 sm:px-5">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="grid h-9 w-9 shrink-0 place-items-center rounded-xl border border-line bg-white/[0.03] text-[10px] font-black tracking-wider text-neon">
                    {(a.host.name ?? a.host.email).slice(0, 2).toUpperCase()}
                  </span>
                  <span className="font-bold text-white">{a.host.name ?? a.host.email}</span>
                  <Badge tone={bookingTone(a.status)}>{a.status}</Badge>
                </div>
                <p className="mt-2 text-xs text-neutral-500">
                  {a.event.title} · {new Date(a.event.date).toLocaleDateString()} · {a.host.email}
                </p>
                <div className="mt-2 flex flex-wrap items-center gap-1.5 text-[10px] text-neutral-500">
                  <span className="rounded-md border border-line/70 bg-white/[0.02] px-2 py-1 text-neutral-300">
                    R{a.fee.toLocaleString()} door fee
                  </span>
                  <span className="rounded-md border border-line/70 bg-white/[0.02] px-2 py-1 text-neutral-400">
                    travel R{a.host.travelRatePerKm.toFixed(2)}/km on invoice
                  </span>
                  {a.appliedAt && (
                    <span className="rounded-md border border-line/70 px-2 py-1">
                      applied {new Date(a.appliedAt).toLocaleDateString()}
                    </span>
                  )}
                </div>
                {a.status === "cancelled" && a.declineReason && (
                  <p className="mt-2 text-xs text-neutral-500">declined — told the host: {a.declineReason}</p>
                )}
                {overBudget && a.status === "pending" && (
                  <p className="mt-2 text-xs text-red-400">
                    Confirming this would go R
                    {(a.event.committed + a.fee - a.event.budget).toLocaleString()} over the R
                    {a.event.budget.toLocaleString()} budget; raise it on Events.
                  </p>
                )}
              </div>

              <div className="flex max-w-full flex-wrap items-start justify-end gap-2">
                {a.status === "pending" && (
                  <>
                    <button
                      onClick={() => decide(a.id, true)}
                      disabled={overBudget || busyId === a.id}
                      title={overBudget ? "This confirmation would put the night over its budget" : undefined}
                      className="console-btn console-btn-primary"
                    >
                      CONFIRM
                    </button>
                    <input
                      value={reasons[a.id] ?? ""}
                      onChange={(e) => setReasons({ ...reasons, [a.id]: e.target.value })}
                      maxLength={500}
                      placeholder="Reason (optional)"
                      aria-label="Reason for declining this door host"
                      className="console-input w-36 text-xs"
                    />
                    <button
                      onClick={() => decide(a.id, false)}
                      disabled={busyId === a.id}
                      className="console-btn console-btn-danger"
                    >
                      DECLINE
                    </button>
                  </>
                )}

                {a.status === "confirmed" &&
                  (happened ? (
                    <button
                      onClick={() => complete(a.id)}
                      disabled={busyId === a.id}
                      className="console-btn console-btn-primary"
                      title="Lets the door host invoice the venue"
                    >
                      {busyId === a.id ? "SAVING…" : "SHIFT WORKED"}
                    </button>
                  ) : (
                    <span className="self-center text-[10px] uppercase tracking-wider text-neutral-600">
                      confirm after the night
                    </span>
                  ))}
              </div>
            </div>
          </article>
        );
      })}

      {!applications.length && !source.loading && (
        <EmptyState
          title="No door applications yet"
          description="Door hosts see nights with a door fee once they are approved; their applications land here."
        />
      )}
    </Panel>
  );
}
