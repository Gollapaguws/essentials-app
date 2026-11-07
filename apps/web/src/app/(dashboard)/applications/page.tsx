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

interface Application {
  id: string; slot?: string | null; status: string; appliedAt?: string;
  startAt: string; endAt: string; performanceFee: number;
  artist: { id: string; stageName: string; user: { name: string | null; email: string } };
  event: { title: string; date: string };
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

  const load = () => api.get<Application[]>("/artists/applications").then(setApps).catch((e) => setError(errorMessage(e)));
  useEffect(() => { load(); }, []);

  const decide = async (id: string, confirm: boolean) => {
    setError(null);
    try {
      await api.post(`/artists/applications/${id}/decide`, { confirm });
      load();
    } catch (err) { setError(errorMessage(err)); }
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
          {apps.map((a) => (
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
                <p className="text-neutral-500 text-xs">set {new Date(a.startAt).toLocaleString()} – {new Date(a.endAt).toLocaleTimeString()}</p>

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
              <div className="flex items-center gap-3">
                <span className={a.status === "confirmed" || a.status === "completed" ? "text-neon" : a.status === "pending" ? "text-yellow-400" : "text-neutral-500"}>{a.status}</span>
                {a.status === "pending" && (
                  <>
                    <button onClick={() => decide(a.id, true)} className="bg-neon text-bg font-black rounded-lg px-3 py-1 text-xs tracking-widest">CONFIRM</button>
                    <button onClick={() => decide(a.id, false)} className="border border-red-500 text-red-400 rounded-lg px-3 py-1 text-xs font-bold">DECLINE</button>
                  </>
                )}
                {a.status === "confirmed" && (
                  new Date(a.endAt).getTime() <= Date.now() ? (
                    <button onClick={() => complete(a.id)} className="border border-neon text-neon rounded-lg px-3 py-1 text-xs font-bold tracking-widest" title="Lets the DJ invoice the venue">
                      GIG PLAYED
                    </button>
                  ) : (
                    <span className="text-neutral-500 text-xs">confirm after the set</span>
                  )
                )}
              </div>
            </div>
          ))}
          {!apps.length && <p className="px-4 py-6 text-center text-neutral-500 text-sm">No applications yet.</p>}
        </div>
      </main>
    </>
  );
}
