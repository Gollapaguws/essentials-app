"use client";

import { useEffect, useState } from "react";
import { TopNav } from "@/components/TopNav";
import { api } from "@essentials/api-client";

interface FrontPageEvent { title: string; displayDate: string; city: string; venue: string; doors: string; price: string; status?: string }
interface FrontPage {
  tagline?: string; ctaLabel?: string; city?: string;
  quote?: string; manifestoP1?: string; manifestoP2?: string;
  events?: FrontPageEvent[];
  footerLeft?: string; footerRight?: string;
}

const emptyEvent: FrontPageEvent = { title: "", displayDate: "", city: "JOHANNESBURG", venue: "", doors: "22:00", price: "R150", status: "ANNOUNCED" };

/** Admin editor for the essentialsedm.com front page. Saves to /api/site/content (admin-only). */
export default function FrontPageEditor() {
  const [c, setC] = useState<FrontPage>({});
  const [msg, setMsg] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api.get<FrontPage>("/site/content").then(setC).catch((e) => setError(e.message));
  }, []);

  const set = (patch: Partial<FrontPage>) => setC((p) => ({ ...p, ...patch }));
  const setEvent = (i: number, patch: Partial<FrontPageEvent>) =>
    setC((p) => ({ ...p, events: (p.events ?? []).map((e, j) => (j === i ? { ...e, ...patch } : e)) }));

  const save = async () => {
    setError(null); setMsg(null);
    try {
      await api.post("/site/content", c);
      setMsg("Saved — the front page updates on next load.");
    } catch (err: any) {
      setError(err.message);
    }
  };

  const input = "w-full bg-bg border border-line rounded-lg px-3 py-2";
  const label = "text-xs text-neutral-400 uppercase tracking-wider";

  return (
    <>
      <TopNav />
      <main className="max-w-6xl mx-auto px-6 py-8 space-y-8">
        <div className="flex justify-between items-center">
          <h1 className="text-2xl font-black tracking-wide">FRONT PAGE EDITOR</h1>
          <button onClick={save} className="bg-neon text-bg font-black rounded-lg px-6 py-2 tracking-widest">SAVE</button>
        </div>
        {msg && <p className="text-neon text-sm">{msg}</p>}
        {error && <p className="text-red-400 text-sm">{error}</p>}

        <section className="border border-line bg-surface rounded-xl p-4 space-y-4">
          <h2 className="font-bold text-neon uppercase text-sm tracking-wider">Hero</h2>
          <div><span className={label}>Tagline</span>
            <textarea className={`${input} mt-1 h-20`} value={c.tagline ?? ""} onChange={(e) => set({ tagline: e.target.value })} /></div>
          <div className="grid md:grid-cols-3 gap-3">
            <div><span className={label}>CTA label</span>
              <input className={`${input} mt-1`} value={c.ctaLabel ?? ""} onChange={(e) => set({ ctaLabel: e.target.value })} /></div>
            <div><span className={label}>City strip</span>
              <input className={`${input} mt-1`} value={c.city ?? ""} onChange={(e) => set({ city: e.target.value })} /></div>
          </div>
        </section>

        <section className="border border-line bg-surface rounded-xl p-4 space-y-4">
          <h2 className="font-bold text-neon uppercase text-sm tracking-wider">Manifesto (The Collective)</h2>
          <div><span className={label}>Quote (line breaks render as new lines)</span>
            <textarea className={`${input} mt-1 h-16`} value={c.quote ?? ""} onChange={(e) => set({ quote: e.target.value })} /></div>
          <div><span className={label}>Paragraph 1</span>
            <textarea className={`${input} mt-1 h-24`} value={c.manifestoP1 ?? ""} onChange={(e) => set({ manifestoP1: e.target.value })} /></div>
          <div><span className={label}>Paragraph 2</span>
            <textarea className={`${input} mt-1 h-20`} value={c.manifestoP2 ?? ""} onChange={(e) => set({ manifestoP2: e.target.value })} /></div>
        </section>

        <section className="border border-line bg-surface rounded-xl p-4 space-y-4">
          <div className="flex justify-between items-center">
            <h2 className="font-bold text-neon uppercase text-sm tracking-wider">Lineup events</h2>
            <button onClick={() => set({ events: [...(c.events ?? []), { ...emptyEvent }] })}
              className="border border-neon text-neon font-bold rounded-lg px-4 py-1 text-sm">+ ADD EVENT</button>
          </div>
          {(c.events ?? []).map((e, i) => (
            <div key={i} className="border border-line rounded-lg p-3 grid md:grid-cols-7 gap-2">
              <input className={input} placeholder="Title" value={e.title} onChange={(ev) => setEvent(i, { title: ev.target.value })} />
              <input className={input} placeholder="Date shown" value={e.displayDate} onChange={(ev) => setEvent(i, { displayDate: ev.target.value })} />
              <input className={input} placeholder="City" value={e.city} onChange={(ev) => setEvent(i, { city: ev.target.value })} />
              <input className={input} placeholder="Venue" value={e.venue} onChange={(ev) => setEvent(i, { venue: ev.target.value })} />
              <input className={input} placeholder="Doors" value={e.doors} onChange={(ev) => setEvent(i, { doors: ev.target.value })} />
              <input className={input} placeholder="Price" value={e.price} onChange={(ev) => setEvent(i, { price: ev.target.value })} />
              <div className="flex gap-2">
                <select className={input} value={e.status} onChange={(ev) => setEvent(i, { status: ev.target.value })}>
                  {["ANNOUNCED", "SELLING FAST", "SOLD OUT", "FREE"].map((s) => <option key={s}>{s}</option>)}
                </select>
                <button onClick={() => set({ events: (c.events ?? []).filter((_, j) => j !== i) })}
                  className="text-red-400 font-bold px-2">×</button>
              </div>
            </div>
          ))}
          {!(c.events ?? []).length && <p className="text-neutral-500 text-sm">No events — the front page shows "DATES TBA".</p>}
        </section>

        <section className="border border-line bg-surface rounded-xl p-4 grid md:grid-cols-2 gap-3">
          <div><span className={label}>Footer left</span>
            <input className={`${input} mt-1`} value={c.footerLeft ?? ""} onChange={(e) => set({ footerLeft: e.target.value })} /></div>
          <div><span className={label}>Footer right</span>
            <input className={`${input} mt-1`} value={c.footerRight ?? ""} onChange={(e) => set({ footerRight: e.target.value })} /></div>
        </section>
      </main>
    </>
  );
}
