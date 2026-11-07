"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { TopNav } from "@/components/TopNav";
import { api } from "@essentials/api-client";
import { errorMessage } from "@/lib/errors";

interface Booking {
  id: string;
  slot: string | null;
  status: string;
  startAt: string;
  endAt: string;
  appliedAt: string | null;
  performanceFee: number;
  travelFee: number;
  event: { id: string; title: string; date: string; status: string; venue: { name: string } };
}

interface ArtistNote {
  id: string;
  body: string;
  updatedAt: string;
}

interface ArtistDetail {
  id: string;
  stageName: string;
  bio: string | null;
  imageUrl: string | null;
  travelRatePerKm: number;
  vehicleConsumptionLPer100km: number | null;
  user: { name: string | null; email: string };
  confirmedGigs: number;
  bookings: Booking[];
  note: ArtistNote | null;
}

const statusClass = (status: string) =>
  status === "confirmed" ? "text-neon" : status === "pending" ? "text-yellow-400" : "text-neutral-500";

/** Promoter: one DJ in full, with the booking history an application is judged against. */
export default function ArtistDetailPage() {
  const { id } = useParams<{ id: string }>();
  const [artist, setArtist] = useState<ArtistDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState("");
  const [noteState, setNoteState] = useState<"idle" | "saving" | "saved">("idle");
  const [noteError, setNoteError] = useState<string | null>(null);

  useEffect(() => {
    if (!id) return;
    api
      .get<ArtistDetail>(`/artists/${id}`)
      .then((a) => {
        setArtist(a);
        setNote(a.note?.body ?? "");
      })
      .catch((e) => setError(errorMessage(e)));
  }, [id]);

  // An empty body clears the note server-side, so the same button both saves and resets.
  const saveNote = async () => {
    setNoteState("saving");
    setNoteError(null);
    try {
      await api.patch(`/artists/${id}/note`, { body: note });
      setNoteState("saved");
    } catch (e) {
      setNoteError(errorMessage(e));
      setNoteState("idle");
    }
  };

  return (
    <>
      <TopNav />
      <main className="max-w-4xl mx-auto px-6 py-8 space-y-6">
        <Link href="/applications" className="text-xs text-neutral-500 hover:text-neon">
          ← Back to applications
        </Link>
        {error && <p className="text-red-400 text-sm">{error}</p>}

        {artist && (
          <>
            <section className="border border-line bg-surface rounded-xl p-5 flex flex-wrap gap-5 items-start">
              <div className="w-20 h-20 rounded-full bg-bg border border-line overflow-hidden shrink-0">
                {artist.imageUrl && (
                  <img src={artist.imageUrl} alt={artist.stageName} className="w-full h-full object-cover" />
                )}
              </div>
              <div className="flex-1 min-w-56 space-y-1">
                <h1 className="text-2xl font-black tracking-wide">{artist.stageName}</h1>
                <p className="text-neutral-400 text-sm">
                  {artist.user.name ?? "—"} · {artist.user.email}
                </p>
                <p className="text-sm">
                  Travel: R{artist.travelRatePerKm.toLocaleString()}/km
                  {artist.vehicleConsumptionLPer100km
                    ? ` · ${artist.vehicleConsumptionLPer100km} L/100km`
                    : ""}
                  {" · "}
                  <span className="text-neon">{artist.confirmedGigs} confirmed</span>
                </p>
              </div>
              {artist.bio && <p className="text-neutral-400 text-sm w-full whitespace-pre-line">{artist.bio}</p>}
            </section>

            <section className="border border-line bg-surface rounded-xl p-5 space-y-3">
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <h2 className="font-bold text-neon uppercase text-sm tracking-wider">Private note</h2>
                <span className="text-neutral-500 text-xs">
                  Only you can see this — it appears when this DJ applies again.
                </span>
              </div>
              <textarea
                value={note}
                onChange={(e) => {
                  setNote(e.target.value);
                  setNoteState("idle");
                }}
                rows={3}
                maxLength={2000}
                placeholder="How did the last set go? Anything to remember before booking them again."
                className="w-full bg-bg border border-line rounded-lg px-3 py-2 text-sm"
              />
              <div className="flex flex-wrap items-center gap-3 text-xs">
                <button
                  onClick={saveNote}
                  disabled={noteState === "saving"}
                  className="bg-neon text-bg font-black rounded-lg px-3 py-1 tracking-widest disabled:opacity-50"
                >
                  {noteState === "saving" ? "SAVING…" : "SAVE NOTE"}
                </button>
                {noteState === "saved" && <span className="text-neon">Saved</span>}
                {!note.trim() && <span className="text-neutral-500">Saving an empty note clears it.</span>}
                {noteError && <span className="text-red-400">{noteError}</span>}
              </div>
            </section>

            <section className="space-y-3">
              <h2 className="font-bold text-neon uppercase text-sm tracking-wider">Booking history</h2>
              <div className="border border-line rounded-xl overflow-x-auto">
                <table className="w-full text-sm min-w-[640px]">
                  <thead className="bg-surface text-neutral-400 uppercase text-xs">
                    <tr>
                      <th className="text-left px-4 py-3">Date</th>
                      <th className="text-left px-4 py-3">Event</th>
                      <th className="text-left px-4 py-3">Venue</th>
                      <th className="text-left px-4 py-3">Slot</th>
                      <th className="text-left px-4 py-3">Fee</th>
                      <th className="text-left px-4 py-3">Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {artist.bookings.map((b) => (
                      <tr key={b.id} className="border-t border-line">
                        <td className="px-4 py-3">{new Date(b.startAt).toLocaleDateString()}</td>
                        <td className="px-4 py-3">
                          <p className="font-bold">{b.event.title}</p>
                          <p className="text-neutral-500 text-xs">{b.event.status}</p>
                        </td>
                        <td className="px-4 py-3">{b.event.venue.name}</td>
                        <td className="px-4 py-3">{b.slot ?? "TBA"}</td>
                        <td className="px-4 py-3">
                          R{(b.performanceFee + b.travelFee).toLocaleString()}
                          {b.travelFee > 0 && (
                            <span className="text-neutral-500 text-xs"> (travel R{b.travelFee.toLocaleString()})</span>
                          )}
                        </td>
                        <td className={`px-4 py-3 ${statusClass(b.status)}`}>{b.status}</td>
                      </tr>
                    ))}
                    {!artist.bookings.length && (
                      <tr>
                        <td colSpan={6} className="px-4 py-6 text-center text-neutral-500">
                          No bookings yet.
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            </section>
          </>
        )}
      </main>
    </>
  );
}
