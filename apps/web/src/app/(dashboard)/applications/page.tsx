"use client";

import { useState } from "react";
import Link from "next/link";
import { api } from "@essentials/api-client";
import { errorMessage } from "@/lib/errors";
import { useAuth } from "@/components/AuthProvider";
import { ConsolePage } from "@/components/console/ConsolePage";
import { PageHeader } from "@/components/console/PageHeader";
import { Panel } from "@/components/console/Panel";
import { Badge, bookingTone } from "@/components/console/Badge";
import { EmptyState } from "@/components/console/EmptyState";
import { useResource } from "@/hooks/useResource";

interface ArtistNote {
  id: string;
  body: string;
  updatedAt: string;
}

interface ExtendableSlot {
  id: string;
  label: string;
  startsAt: string;
  fee: number;
  role?: string | null;
  bpmRange?: string | null;
  genres?: string | null;
}

interface Application {
  id: string; slot?: string | null; status: string; appliedAt?: string;
  startAt: string; endAt: string; performanceFee: number;
  /** Present on a decline: the reason the DJ was given. */
  declineReason?: string | null;
  artist: { id: string; stageName: string; user: { name: string | null; email: string } };
  event: {
    id: string; title: string; date: string; budget: number; committed: number;
    /** Future slots this DJ can be added to by the promoter. */
    extendableSlots?: ExtendableSlot[];
  };
  /** The promoter's own note from last time, or null. */
  note: ArtistNote | null;
}

const initials = (name: string) =>
  name
    .split(/\s+/)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() ?? "")
    .join("");

/** Promoter: review DJ applications — confirm, decline, move, or cancel as an admin. */
export default function Applications() {
  const { me } = useAuth();
  const isAdmin = me?.user.role === "admin";
  // Decisions change this list, so it is always re-read rather than cached.
  const appsSource = useResource<Application[]>("/artists/applications");
  const apps = appsSource.data ?? [];
  const setApps = appsSource.setData;
  const [error, setError] = useState<string | null>(null);
  // One note per DJ, not per application: editing either row edits the same note.
  const [editing, setEditing] = useState<{ artistId: string; body: string } | null>(null);
  const [noteBusy, setNoteBusy] = useState(false);
  const [noteError, setNoteError] = useState<string | null>(null);
  // Optional reason per application, sent to the DJ with the decline.
  const [reasons, setReasons] = useState<Record<string, string>>({});
  // Extra-slot choices and the booking currently being extended.
  const [extendChoices, setExtendChoices] = useState<Record<string, string>>({});
  const [extending, setExtending] = useState<string | null>(null);
  // Reassignment choices and the booking currently being moved.
  const [moveChoices, setMoveChoices] = useState<Record<string, string>>({});
  const [moving, setMoving] = useState<string | null>(null);
  const [adminCancelling, setAdminCancelling] = useState<string | null>(null);

  const decide = async (id: string, confirm: boolean) => {
    setError(null);
    try {
      const decided = await api.post<{ status: string; declineReason?: string | null }>(
        `/artists/applications/${id}/decide`,
        { confirm, reason: reasons[id]?.trim() || undefined },
      );
      // Keep the row on screen with its new status while the list reloads.
      setApps((prev) => (prev ?? []).map((a) => (a.id === id
        ? { ...a, status: decided.status, declineReason: decided.declineReason ?? a.declineReason }
        : a)));
      setReasons((prev) => ({ ...prev, [id]: "" }));
      appsSource.reload();
    } catch (err) { setError(errorMessage(err)); }
  };

  const extend = async (a: Application) => {
    const slotId = extendChoices[a.id];
    if (!slotId) return;
    setError(null);
    setExtending(a.id);
    try {
      await api.post(`/artists/bookings/${a.id}/extend`, { slotId });
      setExtendChoices((prev) => ({ ...prev, [a.id]: "" }));
      appsSource.reload();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setExtending(null);
    }
  };

  const move = async (a: Application) => {
    const slotId = moveChoices[a.id];
    if (!slotId) return;
    setError(null);
    setMoving(a.id);
    try {
      await api.post(`/artists/bookings/${a.id}/move`, { slotId });
      setMoveChoices((prev) => ({ ...prev, [a.id]: "" }));
      appsSource.reload();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setMoving(null);
    }
  };

  const adminCancel = async (a: Application) => {
    const label = `${a.artist.stageName}'s ${a.slot ?? "slot"} at ${a.event.title}`;
    const detail = a.status === "confirmed"
      ? "This frees the confirmed slot and notifies the DJ, the promoter and any waiting applicants."
      : "This removes the application from the promoter's queue.";
    if (!window.confirm(`Cancel ${label}?\n\n${detail}`)) return;
    setError(null);
    setAdminCancelling(a.id);
    try {
      await api.post(`/artists/bookings/${a.id}/cancel`);
      setApps((prev) => (prev ?? []).map((row) => row.id === a.id ? { ...row, status: "cancelled" } : row));
      appsSource.reload();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setAdminCancelling(null);
    }
  };

  // The second confirmation: the gig happened. This is what lets the DJ invoice the venue.
  const complete = async (id: string) => {
    setError(null);
    try {
      await api.post(`/artists/bookings/${id}/complete`);
      appsSource.reload();
    } catch (err) { setError(errorMessage(err)); }
  };

  const openNote = (a: Application) => {
    setNoteError(null);
    setEditing({ artistId: a.artist.id, body: a.note?.body ?? "" });
  };

  const saveNote = async () => {
    if (!editing) return;
    setNoteBusy(true);
    setNoteError(null);
    try {
      const saved = await api.patch<{ note: ArtistNote | null }>(`/artists/${editing.artistId}/note`, { body: editing.body });
      // The note belongs to the DJ, so every row for them reflects the save.
      setApps((prev) => (prev ?? []).map((r) => (r.artist.id === editing.artistId ? { ...r, note: saved.note } : r)));
      setEditing(null);
    } catch (err) {
      setNoteError(errorMessage(err));
    } finally {
      setNoteBusy(false);
    }
  };

  const pending = apps.filter((a) => a.status === "pending").length;
  const confirmed = apps.filter((a) => a.status === "confirmed").length;

  return (
    <ConsolePage size="lg">
      <PageHeader
        eyebrow="Night ops / Booking desk"
        title="DJ APPLICATIONS"
        description="Review the queue, protect the budget, and keep every confirmed slot covered."
        actions={
          <>
            <Badge tone="warning">{pending} pending</Badge>
            <Badge tone="success">{confirmed} confirmed</Badge>
          </>
        }
      />

      {(error ?? appsSource.error) && (
        <div role="alert" className="rounded-xl border border-red-500/30 bg-red-500/5 px-4 py-2.5 text-sm text-red-300">
          {error ?? appsSource.error}
        </div>
      )}
      {appsSource.loading && <p className="text-neutral-500 text-xs">Loading applications…</p>}

      <Panel
        title="Application queue"
        description="Confirming promises money. Moving or cancelling a confirmed slot reopens it to the other applicants."
        flush
      >
        {apps.map((a) => {
          // Confirming promises money: the budget is a ceiling, not a warning.
          const overBudget = a.event.budget > 0 && a.event.committed + a.performanceFee > a.event.budget;
          return (
            <article key={a.id} className="border-t border-line/70 px-4 py-4 first:border-t-0 sm:px-5">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="grid h-9 w-9 shrink-0 place-items-center rounded-xl border border-line bg-white/[0.03] text-[10px] font-black tracking-wider text-neon">
                      {initials(a.artist.stageName)}
                    </span>
                    <Link
                      href={`/artists/${a.artist.id}`}
                      className="font-bold text-white underline decoration-line underline-offset-4 hover:text-neon"
                      title="Full profile and booking history"
                    >
                      {a.artist.stageName}
                    </Link>
                    <Badge tone={bookingTone(a.status)}>{a.status}</Badge>
                  </div>
                  <p className="mt-2 text-xs text-neutral-500">
                    {a.event.title} · {new Date(a.event.date).toLocaleDateString()} · {a.artist.user.email}
                  </p>
                  <div className="mt-2 flex flex-wrap items-center gap-1.5 text-[10px] text-neutral-500">
                    <span className="rounded-md border border-line/70 bg-white/[0.02] px-2 py-1 text-neutral-300">
                      {a.slot ?? "slot TBA"}
                    </span>
                    <span className="rounded-md border border-line/70 bg-white/[0.02] px-2 py-1 text-neutral-300">
                      R{a.performanceFee.toLocaleString()}
                    </span>
                    {!a.slot && (
                      <span className="rounded-md border border-line/70 px-2 py-1">
                        {new Date(a.startAt).toLocaleString()} – {new Date(a.endAt).toLocaleTimeString()}
                      </span>
                    )}
                    {a.appliedAt && (
                      <span className="rounded-md border border-line/70 px-2 py-1">
                        applied {new Date(a.appliedAt).toLocaleDateString()}
                      </span>
                    )}
                  </div>
                  {a.status === "cancelled" && a.declineReason && (
                    <p className="mt-2 text-xs text-neutral-500">declined — told the DJ: {a.declineReason}</p>
                  )}
                  {overBudget && a.status === "pending" && (
                    <p className="mt-2 text-xs text-red-400">
                      Confirming this would go R{(a.event.committed + a.performanceFee - a.event.budget).toLocaleString()} over the R{a.event.budget.toLocaleString()} budget; raise it on Events.
                    </p>
                  )}

                  <div className="mt-3 border-t border-line/50 pt-2">
                    {editing?.artistId === a.artist.id ? (
                      <div className="max-w-md space-y-1">
                        <textarea
                          autoFocus
                          value={editing.body}
                          onChange={(e) => setEditing({ ...editing, body: e.target.value })}
                          rows={2}
                          maxLength={2000}
                          placeholder="How did the last set go? Only you can see this."
                          className="console-input w-full text-xs"
                        />
                        <div className="flex flex-wrap items-center gap-2 text-xs">
                          <button
                            onClick={saveNote}
                            disabled={noteBusy}
                            className="console-btn console-btn-primary px-2 py-1 tracking-widest"
                          >
                            {noteBusy ? "SAVING…" : "SAVE"}
                          </button>
                          <button onClick={() => setEditing(null)} className="text-neutral-500 hover:text-neon">CANCEL</button>
                          {!editing.body.trim() && <span className="text-neutral-500">An empty note clears it.</span>}
                          {noteError && <span className="text-red-400">{noteError}</span>}
                        </div>
                      </div>
                    ) : (
                      <div className="flex flex-wrap items-baseline gap-2">
                        {a.note && (
                          <p className="text-xs text-amber-300/90">
                            <span className="text-[9px] uppercase tracking-widest text-neutral-600">your note</span>{" "}
                            {a.note.body}
                          </p>
                        )}
                        <button
                          onClick={() => openNote(a)}
                          className="text-[9px] uppercase tracking-widest text-neutral-600 hover:text-neon"
                        >
                          {a.note ? "edit note" : "add note"}
                        </button>
                      </div>
                    )}
                  </div>
                </div>

                <div className="flex max-w-full flex-wrap items-start justify-end gap-2">
                  {a.status === "pending" && (
                    <>
                      <button
                        onClick={() => decide(a.id, true)}
                        disabled={overBudget}
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
                        aria-label="Reason for declining this DJ"
                        className="console-input w-36 text-xs"
                      />
                      <button onClick={() => decide(a.id, false)} className="console-btn console-btn-danger">
                        DECLINE
                      </button>
                    </>
                  )}

                  {(a.status === "pending" || a.status === "confirmed") && !!a.event.extendableSlots?.length && (
                    <div className="flex items-center gap-1">
                      <select
                        value={moveChoices[a.id] ?? ""}
                        onChange={(e) => setMoveChoices({ ...moveChoices, [a.id]: e.target.value })}
                        aria-label={`Move ${a.artist.stageName} to another slot`}
                        className="console-input max-w-[13rem] py-1.5 text-xs"
                      >
                        <option value="">Change slot…</option>
                        {a.event.extendableSlots.map((slot) => (
                          <option key={slot.id} value={slot.id}>
                            {slot.label} · {slot.role ? `${slot.role} · ` : ""}R{slot.fee.toLocaleString()}
                          </option>
                        ))}
                      </select>
                      <button
                        onClick={() => move(a)}
                        disabled={!moveChoices[a.id] || moving === a.id}
                        className="console-btn console-btn-secondary"
                        title="Move this booking to the chosen slot and use that slot's fee"
                      >
                        {moving === a.id ? "MOVING…" : "MOVE"}
                      </button>
                    </div>
                  )}

                  {a.status === "confirmed" && (
                    <>
                      {!!a.event.extendableSlots?.length && (
                        <div className="flex items-center gap-1">
                          <select
                            value={extendChoices[a.id] ?? ""}
                            onChange={(e) => setExtendChoices({ ...extendChoices, [a.id]: e.target.value })}
                            aria-label={`Add ${a.artist.stageName} to another slot`}
                            className="console-input max-w-[13rem] py-1.5 text-xs"
                          >
                            <option value="">Add another slot…</option>
                            {a.event.extendableSlots.map((slot) => (
                              <option key={slot.id} value={slot.id}>
                                {slot.label} · R{slot.fee.toLocaleString()}
                              </option>
                            ))}
                          </select>
                          <button
                            onClick={() => extend(a)}
                            disabled={!extendChoices[a.id] || extending === a.id}
                            className="console-btn console-btn-secondary"
                            title="The DJ cannot apply again; this is the promoter's explicit extension"
                          >
                            {extending === a.id ? "ADDING…" : "EXTEND"}
                          </button>
                        </div>
                      )}
                      {new Date(a.endAt).getTime() <= Date.now() ? (
                        <button
                          onClick={() => complete(a.id)}
                          className="console-btn console-btn-primary"
                          title="Lets the DJ invoice the venue"
                        >
                          GIG PLAYED
                        </button>
                      ) : (
                        <span className="self-center text-[10px] uppercase tracking-wider text-neutral-600">confirm after the set</span>
                      )}
                    </>
                  )}

                  {isAdmin && (a.status === "pending" || a.status === "confirmed") && (
                    <button
                      onClick={() => adminCancel(a)}
                      disabled={adminCancelling === a.id}
                      className="console-btn console-btn-danger"
                      title="Admin override: cancel this slot and reopen it to other applicants"
                    >
                      {adminCancelling === a.id ? "CANCELLING…" : "CANCEL SLOT"}
                    </button>
                  )}
                </div>
              </div>
            </article>
          );
        })}

        {!apps.length && (
          <EmptyState
            title="No applications yet"
            description="When a DJ applies for one of your events, their application lands here for review."
          />
        )}
      </Panel>
    </ConsolePage>
  );
}
