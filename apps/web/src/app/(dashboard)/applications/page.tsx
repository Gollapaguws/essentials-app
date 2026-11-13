"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { TopNav } from "@/components/TopNav";
import { api } from "@essentials/api-client";
import { errorMessage } from "@/lib/errors";

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

/** Promoter: review DJ applications — confirm or decline, noting the DJ as they go. */
export default function Applications() {
  const [apps, setApps] = useState<Application[]>([]);
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

  // Decisions change this list; never let the browser answer from its HTTP cache.
  const load = () => api.get<Application[]>("/artists/applications", { cache: "no-store" }).then(setApps).catch((e) => setError(errorMessage(e)));
  useEffect(() => { load(); }, []);

  const decide = async (id: string, confirm: boolean) => {
    setError(null);
    try {
      const decided = await api.post<{ status: string; declineReason?: string | null }>(
        `/artists/applications/${id}/decide`,
        { confirm, reason: reasons[id]?.trim() || undefined },
      );
      // Keep the row on screen with its new status while the list reloads.
      setApps((prev) => prev.map((a) => (a.id === id
        ? { ...a, status: decided.status, declineReason: decided.declineReason ?? a.declineReason }
        : a)));
      setReasons((prev) => ({ ...prev, [id]: "" }));
      load();
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
      load();
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
      load();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setMoving(null);
    }
  };

  // The second confirmation: the gig happened. This is what lets the DJ invoice the venue.
  const complete = async (id: string) => {
    setError(null);
    try {
      await api.post(`/artists/bookings/${id}/complete`);
      load();
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
      setApps((prev) => prev.map((r) => (r.artist.id === editing.artistId ? { ...r, note: saved.note } : r)));
      setEditing(null);
    } catch (err) {
      setNoteError(errorMessage(err));
    } finally {
      setNoteBusy(false);
    }
  };

  return (
    <>
      <TopNav />
      <main className="max-w-4xl mx-auto px-6 py-8 space-y-6">
        <h1 className="text-2xl font-black tracking-wide">DJ APPLICATIONS</h1>
        {error && <p className="text-red-400 text-sm">{error}</p>}
        <div className="border border-line rounded-xl">
          {apps.map((a) => {
            // Confirming promises money: the budget is a ceiling, not a warning.
            const overBudget = a.event.budget > 0 && a.event.committed + a.performanceFee > a.event.budget;
            return (
            <div key={a.id} className="border-t border-line px-4 py-3 text-sm flex flex-wrap justify-between gap-2">
              <div className="flex-1 min-w-64">
                <p className="font-bold">
                  <Link
                    href={`/artists/${a.artist.id}`}
                    className="underline decoration-line hover:text-neon"
                    title="Full profile and booking history"
                  >
                    {a.artist.stageName}
                  </Link>{" "}
                  <span className="text-neutral-500 font-normal">· {a.slot ?? "slot TBA"} · R{a.performanceFee.toLocaleString()}</span>
                </p>
                <p className="text-neutral-500 text-xs">{a.event.title} · {new Date(a.event.date).toLocaleDateString()} · {a.artist.user.email}</p>
                {!a.slot && (
                  <p className="text-neutral-500 text-xs">set {new Date(a.startAt).toLocaleString()} – {new Date(a.endAt).toLocaleTimeString()}</p>
                )}
                {a.status === "cancelled" && a.declineReason && (
                  <p className="text-xs text-neutral-500">declined — told the DJ: {a.declineReason}</p>
                )}
                {overBudget && a.status === "pending" && (
                  <p className="text-xs text-red-400">
                    confirming this would go R{(a.event.committed + a.performanceFee - a.event.budget).toLocaleString()} over the R{a.event.budget.toLocaleString()} budget; raise it on Events
                  </p>
                )}

                {editing?.artistId === a.artist.id ? (
                  <div className="mt-2 max-w-md space-y-1">
                    <textarea
                      autoFocus
                      value={editing.body}
                      onChange={(e) => setEditing({ ...editing, body: e.target.value })}
                      rows={2}
                      maxLength={2000}
                      placeholder="How did the last set go? Only you can see this."
                      className="w-full bg-bg border border-line rounded-lg px-2 py-1 text-xs"
                    />
                    <div className="flex flex-wrap items-center gap-2 text-xs">
                      <button
                        onClick={saveNote}
                        disabled={noteBusy}
                        className="bg-neon text-bg font-black rounded-lg px-2 py-0.5 tracking-widest disabled:opacity-50"
                      >
                        {noteBusy ? "SAVING…" : "SAVE"}
                      </button>
                      <button onClick={() => setEditing(null)} className="text-neutral-500 hover:text-neon">CANCEL</button>
                      {!editing.body.trim() && <span className="text-neutral-500">An empty note clears it.</span>}
                      {noteError && <span className="text-red-400">{noteError}</span>}
                    </div>
                  </div>
                ) : (
                  <div className="mt-1 flex flex-wrap items-baseline gap-2 max-w-md">
                    {a.note && (
                      <p className="text-yellow-400/90 text-xs">
                        <span className="uppercase tracking-widest text-[10px] text-neutral-500">your note</span>{" "}
                        {a.note.body}
                      </p>
                    )}
                    <button
                      onClick={() => openNote(a)}
                      className="text-[10px] uppercase tracking-widest text-neutral-500 hover:text-neon"
                    >
                      {a.note ? "edit note" : "add note"}
                    </button>
                  </div>
                )}
              </div>
              <div className="flex flex-wrap items-center justify-end gap-2">
                <span className={a.status === "confirmed" || a.status === "completed" ? "text-neon" : a.status === "pending" ? "text-yellow-400" : "text-neutral-500"}>{a.status}</span>
                {a.status === "pending" && (
                  <>
                    <button
                      onClick={() => decide(a.id, true)}
                      disabled={overBudget}
                      title={overBudget ? "This confirmation would put the night over its budget" : undefined}
                      className="bg-neon text-bg font-black rounded-lg px-3 py-1 text-xs tracking-widest disabled:opacity-40"
                    >
                      CONFIRM
                    </button>
                    <input
                      value={reasons[a.id] ?? ""}
                      onChange={(e) => setReasons({ ...reasons, [a.id]: e.target.value })}
                      maxLength={500}
                      placeholder="Reason (optional)"
                      aria-label="Reason for declining this DJ"
                      className="bg-bg border border-line rounded-lg px-2 py-1 text-xs w-36"
                    />
                    <button onClick={() => decide(a.id, false)} className="border border-red-500 text-red-400 rounded-lg px-3 py-1 text-xs font-bold">DECLINE</button>
                  </>
                )}
                {(a.status === "pending" || a.status === "confirmed") && !!a.event.extendableSlots?.length && (
                  <div className="flex items-center gap-1">
                    <select
                      value={moveChoices[a.id] ?? ""}
                      onChange={(e) => setMoveChoices({ ...moveChoices, [a.id]: e.target.value })}
                      aria-label={`Move ${a.artist.stageName} to another slot`}
                      className="bg-bg border border-line rounded-lg px-2 py-1 text-xs max-w-[13rem]"
                    >
                      <option value="">Change slot…</option>
                      {a.event.extendableSlots.map((slot) => (
                        <option key={slot.id} value={slot.id}>
                          {slot.label} · R{slot.fee.toLocaleString()}
                        </option>
                      ))}
                    </select>
                    <button
                      onClick={() => move(a)}
                      disabled={!moveChoices[a.id] || moving === a.id}
                      className="border border-line text-neutral-300 rounded-lg px-2 py-1 text-xs font-bold tracking-widest disabled:opacity-40"
                      title="Move this booking to the chosen slot and use that slot's fee"
                    >
                      {moving === a.id ? "MOVING…" : "MOVE"}
                    </button>
                  </div>
                )}
                {a.status === "confirmed" && (
                  <div className="flex flex-col items-end gap-1">
                    {!!a.event.extendableSlots?.length && (
                      <div className="flex items-center gap-1">
                        <select
                          value={extendChoices[a.id] ?? ""}
                          onChange={(e) => setExtendChoices({ ...extendChoices, [a.id]: e.target.value })}
                          aria-label={`Add ${a.artist.stageName} to another slot`}
                          className="bg-bg border border-line rounded-lg px-2 py-1 text-xs max-w-[13rem]"
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
                          className="border border-neon text-neon rounded-lg px-2 py-1 text-xs font-bold tracking-widest disabled:opacity-40"
                          title="The DJ cannot apply again; this is the promoter's explicit extension"
                        >
                          {extending === a.id ? "ADDING…" : "EXTEND"}
                        </button>
                      </div>
                    )}
                    {new Date(a.endAt).getTime() <= Date.now() ? (
                      <button onClick={() => complete(a.id)} className="border border-neon text-neon rounded-lg px-3 py-1 text-xs font-bold tracking-widest" title="Lets the DJ invoice the venue">
                        GIG PLAYED
                      </button>
                    ) : (
                      <span className="text-neutral-500 text-xs">confirm after the set</span>
                    )}
                  </div>
                )}
              </div>
            </div>
            );
          })}
          {!apps.length && <p className="px-4 py-6 text-center text-neutral-500 text-sm">No applications yet.</p>}
        </div>
      </main>
    </>
  );
}
