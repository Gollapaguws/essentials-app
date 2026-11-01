"use client";

import { useEffect, useState } from "react";
import { TopNav } from "@/components/TopNav";
import { api } from "@essentials/api-client";

interface OpenGig { id: string; title: string; date: string; genres: string[]; venue: { name: string } }
interface Gig { id: string; slot?: string | null; status: string; startAt: string; performanceFee: number; event: { title: string; date: string } }
interface Application { id: string; artist: { stageName: string; user: { name: string | null; email: string } }; slot?: string | null; status: string; event: { title: string; date: string } }

const SLOTS = [
  { key: "day", label: "DAY (14:00–20:00)" },
  { key: "evening", label: "EVENING (20:00–00:00)" },
  { key: "late-night", label: "LATE-NIGHT (00:00–06:00)" },
];

/** DJ flow: open events → choose slot → apply → promoter confirms. */
export default function GigCalendar() {
  const [open, setOpen] = useState<OpenGig[]>([]);
  const [gigs, setGigs] = useState<Gig[]>([]);
  const [applications, setApplications] = useState<Application[]>([]);
  const [slotSel, setSlotSel] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);

  const load = () => {
    api.get<OpenGig[]>("/artists/gig-calendar").then(setOpen).catch(() => {});
    api.get<Gig[]>("/artists/gigs").then(setGigs).catch(() => {});
  };
  useEffect(() => { load(); }, []);

  const apply = async (eventId: string) => {
    const slot = slotSel[eventId] ?? "evening";
    setError(null); setMsg(null);
    try {
      await api.post("/artists/gig-calendar/apply", { eventId, slot });
      setMsg("Application sent — the promoter will confirm.");
      load();
    } catch (err: any) { setError(err.message); }
  };

  return (
    <>
      <TopNav />
      <main className="max-w-4xl mx-auto px-6 py-8 space-y-8">
        <h1 className="text-2xl font-black tracking-wide">DJ GIG CALENDAR</h1>
        {msg && <p className="text-neon text-sm">{msg}</p>}
        {error && <p className="text-red-400 text-sm">{error}</p>}

        <section className="border border-line bg-surface rounded-xl p-4">
          <h2 className="font-bold text-neon uppercase text-sm tracking-wider mb-3">Open events — apply for a slot</h2>
          {open.map((g) => (
            <div key={g.id} className="border-t border-line py-3 space-y-2">
              <p className="font-bold">{g.title} <span className="text-neutral-500 text-sm">@ {g.venue.name} · {new Date(g.date).toDateString()}</span></p>
              <div className="flex flex-wrap gap-2 items-center">
                {SLOTS.map((s) => (
                  <button key={s.key} onClick={() => setSlotSel({ ...slotSel, [g.id]: s.key })}
                    className={`text-xs rounded-lg px-3 py-2 border ${slotSel[g.id] === s.key ? "border-neon text-neon" : "border-line text-neutral-400"}`}>
                    {s.label}
                  </button>
                ))}
                <button onClick={() => apply(g.id)} className="bg-neon text-bg font-black rounded-lg px-4 py-2 text-xs tracking-widest">APPLY</button>
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
                <p className="font-bold">{g.event.title} <span className="text-neutral-500">· {g.slot ?? "slot TBA"} · {new Date(g.startAt).toDateString()}</span></p>
                <p className="text-neutral-500">fee {g.performanceFee}</p>
              </div>
              <span className={g.status === "confirmed" ? "text-neon" : g.status === "pending" ? "text-yellow-400" : "text-neutral-500"}>{g.status}</span>
            </div>
          ))}
          {!gigs.length && <p className="text-neutral-500 text-sm">No applications yet.</p>}
        </section>
      </main>
    </>
  );
}
