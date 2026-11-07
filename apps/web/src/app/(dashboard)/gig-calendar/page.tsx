"use client";

import { useEffect, useState } from "react";
import { TopNav } from "@/components/TopNav";
import { api } from "@essentials/api-client";
import { errorMessage } from "@/lib/errors";

interface OpenSlot {
  id: string;
  label: string;
  startsAt: string;
  endsAt: string;
  fee: number;
  taken: boolean;
}

interface OpenGig {
  id: string;
  title: string;
  date: string;
  genres: string[];
  venue: { name: string };
  /** Empty on events planned before slots existed — those fall back to the old three. */
  slots: OpenSlot[];
}

interface Gig {
  id: string;
  slot?: string | null;
  status: string;
  startAt: string;
  performanceFee: number;
  event: { title: string; date: string; venue?: { name: string } };
  invoice?: { id: string; number: string; status: string } | null;
}

const LEGACY_SLOTS = [
  { key: "day", label: "DAY (14:00–20:00)" },
  { key: "evening", label: "EVENING (20:00–00:00)" },
  { key: "late-night", label: "LATE-NIGHT (00:00–06:00)" },
];

const statusClass = (status: string) =>
  status === "confirmed" || status === "completed" ? "text-neon" : status === "pending" ? "text-yellow-400" : "text-neutral-500";

/** DJ flow: open events → choose a slot (time + fee) → apply → promoter confirms → invoice. */
export default function GigCalendar() {
  const [open, setOpen] = useState<OpenGig[]>([]);
  const [gigs, setGigs] = useState<Gig[]>([]);
  // "slot:<id>" for real slots, "legacy:<key>" for pre-slot events.
  const [picked, setPicked] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);

  const load = () => {
    api.get<OpenGig[]>("/artists/gig-calendar").then(setOpen).catch(() => {});
    api.get<Gig[]>("/artists/gigs").then(setGigs).catch(() => {});
  };
  useEffect(() => { load(); }, []);

  const apply = async (eventId: string) => {
    const choice = picked[eventId];
    if (!choice) return;
    setError(null);
    setMsg(null);
    try {
      if (choice.startsWith("slot:")) {
        await api.post("/artists/gig-calendar/apply", { slotId: choice.slice(5) });
      } else {
        await api.post("/artists/gig-calendar/apply", { eventId, slot: choice.replace("legacy:", "") });
      }
      setMsg("Application sent — the promoter will confirm.");
      load();
    } catch (err) {
      setError(errorMessage(err));
    }
  };

  // Only a gig the promoter has confirmed as played can be invoiced.
  const invoice = async (gig: Gig) => {
    setError(null);
    setMsg(null);
    try {
      const inv = await api.post<{ number: string }>("/invoices/generate", { bookingIds: [gig.id] });
      setMsg(`Invoice ${inv.number} sent to the venue.`);
      load();
    } catch (err) {
      setError(errorMessage(err));
    }
  };

  return (
    <>
      <TopNav />
      <main className="max-w-4xl mx-auto px-6 py-8 space-y-8">
        <h1 className="text-2xl font-black tracking-wide">DJ GIG CALENDAR</h1>
        {msg && <p className="text-neon text-sm">{msg}</p>}
        {error && <p className="text-red-400 text-sm">{error}</p>}

        <section className="border border-line bg-surface rounded-xl p-4">
          <h2 className="font-bold text-neon uppercase text-sm tracking-wider mb-3">Open events — pick a slot</h2>
          {open.map((g) => (
            <div key={g.id} className="border-t border-line py-3 space-y-2">
              <p className="font-bold">{g.title} <span className="text-neutral-500 text-sm">@ {g.venue.name} · {new Date(g.date).toDateString()}</span></p>
              <div className="flex flex-wrap gap-2 items-center">
                {g.slots.length ? (
                  g.slots.map((s) => {
                    const value = `slot:${s.id}`;
                    const selected = picked[g.id] === value;
                    return (
                      <button
                        key={s.id}
                        disabled={s.taken}
                        onClick={() => setPicked({ ...picked, [g.id]: value })}
                        className={`text-xs rounded-lg px-3 py-2 border ${s.taken ? "border-line text-neutral-600 line-through" : selected ? "border-neon text-neon" : "border-line text-neutral-400"}`}
                        title={s.taken ? "Another DJ holds this slot" : `Pays R${s.fee.toLocaleString()}`}
                      >
                        {s.label} · R{s.fee.toLocaleString()}
                      </button>
                    );
                  })
                ) : (
                  LEGACY_SLOTS.map((s) => {
                    const value = `legacy:${s.key}`;
                    return (
                      <button
                        key={s.key}
                        onClick={() => setPicked({ ...picked, [g.id]: value })}
                        className={`text-xs rounded-lg px-3 py-2 border ${picked[g.id] === value ? "border-neon text-neon" : "border-line text-neutral-400"}`}
                      >
                        {s.label}
                      </button>
                    );
                  })
                )}
                <button
                  onClick={() => apply(g.id)}
                  disabled={!picked[g.id]}
                  className="bg-neon text-bg font-black rounded-lg px-4 py-2 text-xs tracking-widest disabled:opacity-40"
                >
                  APPLY
                </button>
              </div>
            </div>
          ))}
          {!open.length && <p className="text-neutral-500 text-sm">No open events right now — you'll get a DJ call when new dates drop.</p>}
        </section>

        <section className="border border-line bg-surface rounded-xl p-4">
          <h2 className="font-bold text-neon uppercase text-sm tracking-wider mb-3">My applications & gigs</h2>
          {gigs.map((g) => (
            <div key={g.id} className="border-t border-line py-3 text-sm flex flex-wrap justify-between gap-2">
              <div>
                <p className="font-bold">
                  {g.event.title}{" "}
                  <span className="text-neutral-500">
                    · {g.slot ?? "slot TBA"} · {new Date(g.startAt).toDateString()}
                    {g.event.venue?.name ? ` · ${g.event.venue.name}` : ""}
                  </span>
                </p>
                <p className="text-neutral-500">fee R{g.performanceFee.toLocaleString()}</p>
              </div>
              <div className="flex items-center gap-3">
                <span className={statusClass(g.status)}>{g.status}</span>
                {g.status === "completed" && !g.invoice && (
                  <button
                    onClick={() => invoice(g)}
                    className="bg-neon text-bg font-black rounded-lg px-3 py-1 text-xs tracking-widest"
                    title="Invoice the venue for the agreed fee"
                  >
                    INVOICE VENUE
                  </button>
                )}
                {g.invoice && <span className="text-neutral-500 text-xs">invoiced {g.invoice.number}</span>}
              </div>
            </div>
          ))}
          {!gigs.length && <p className="text-neutral-500 text-sm">No applications yet.</p>}
        </section>
      </main>
    </>
  );
}
