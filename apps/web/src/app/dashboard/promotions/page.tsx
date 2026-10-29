"use client";

import { useEffect, useState } from "react";
import { TopNav } from "@/components/TopNav";
import { api } from "@essentials/api-client";

interface Promo { id: string; code: string; kind: string; discountPct: number; maxUses: number; uses: number; active: boolean; _count: { redemptions: number } }
interface EventRow { id: string; title: string }

/** Phase 2 promotions engine (promoter side): create codes, track redemptions. */
export default function Promotions() {
  const [events, setEvents] = useState<EventRow[]>([]);
  const [eventId, setEventId] = useState("");
  const [promos, setPromos] = useState<Promo[]>([]);
  const [form, setForm] = useState({ code: "", kind: "discount", discountPct: 15, maxUses: 50 });
  const [error, setError] = useState<string | null>(null);

  const load = (id: string) => {
    setEventId(id);
    if (id) api.get<Promo[]>(`/promotions/event/${id}`).then(setPromos).catch(() => setPromos([]));
  };
  useEffect(() => {
    api.get<EventRow[]>("/events/manage/list").then((e) => { setEvents(e); if (e[0]) load(e[0].id); }).catch((e) => setError(e.message));
  }, []);

  const create = async (e2: React.FormEvent) => {
    e2.preventDefault();
    try {
      await api.post("/promotions", { ...form, eventId });
      setForm({ code: "", kind: "discount", discountPct: 15, maxUses: 50 });
      load(eventId);
    } catch (err: any) { setError(err.message); }
  };

  return (
    <>
      <TopNav />
      <main className="max-w-6xl mx-auto px-6 py-8 space-y-8">
        <h1 className="text-2xl font-black tracking-wide">PROMOTIONS</h1>
        {error && <p className="text-red-400 text-sm">{error}</p>}
        <form onSubmit={create} className="grid md:grid-cols-6 gap-3 items-end border border-line bg-surface rounded-xl p-4">
          <select className="bg-bg border border-line rounded-lg px-3 py-2" value={eventId} onChange={(e) => load(e.target.value)}>
            {events.map((e) => <option key={e.id} value={e.id}>{e.title}</option>)}
          </select>
          <input required className="bg-bg border border-line rounded-lg px-3 py-2 uppercase" placeholder="CODE" value={form.code} onChange={(e) => setForm({ ...form, code: e.target.value.toUpperCase() })} />
          <select className="bg-bg border border-line rounded-lg px-3 py-2" value={form.kind} onChange={(e) => setForm({ ...form, kind: e.target.value })}>
            <option value="discount">discount</option>
            <option value="free_entry">free_entry</option>
            <option value="bottle_upgrade">bottle_upgrade</option>
          </select>
          <input type="number" min={0} max={100} className="bg-bg border border-line rounded-lg px-3 py-2" placeholder="% off" value={form.discountPct} onChange={(e) => setForm({ ...form, discountPct: +e.target.value })} />
          <input type="number" min={1} className="bg-bg border border-line rounded-lg px-3 py-2" placeholder="Max uses" value={form.maxUses} onChange={(e) => setForm({ ...form, maxUses: +e.target.value })} />
          <button className="bg-neon text-bg font-black rounded-lg py-2 tracking-widest">CREATE</button>
        </form>
        <div className="border border-line rounded-xl overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-surface text-neutral-400 uppercase text-xs">
              <tr><th className="text-left px-4 py-3">Code</th><th className="text-left px-4 py-3">Kind</th><th className="text-left px-4 py-3">% off</th><th className="text-left px-4 py-3">Used</th></tr>
            </thead>
            <tbody>
              {promos.map((p) => (
                <tr key={p.id} className="border-t border-line">
                  <td className="px-4 py-3 font-mono font-bold text-neon">{p.code}</td>
                  <td className="px-4 py-3">{p.kind}</td>
                  <td className="px-4 py-3">{p.discountPct}%</td>
                  <td className="px-4 py-3">{p.uses}/{p.maxUses}</td>
                </tr>
              ))}
              {!promos.length && <tr><td colSpan={4} className="px-4 py-6 text-center text-neutral-500">No promo codes for this event.</td></tr>}
            </tbody>
          </table>
        </div>
      </main>
    </>
  );
}
