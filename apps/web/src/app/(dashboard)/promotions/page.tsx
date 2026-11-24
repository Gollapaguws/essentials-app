"use client";

import { useEffect, useState } from "react";
import { TopNav } from "@/components/TopNav";
import { api } from "@essentials/api-client";
import { errorMessage } from "@/lib/errors";
import { useResource } from "@/hooks/useResource";

interface Promo { id: string; code: string; kind: string; discountPct: number; maxUses: number; uses: number; active: boolean; _count: { redemptions: number } }
interface EventRow { id: string; title: string }

/** Phase 2 promotions engine (promoter side): create codes, track redemptions. */
export default function Promotions() {
  // One page of nights, sized like the Events screen; codes are read per night.
  const eventsSource = useResource<EventRow[]>("/events/manage/list?limit=200");
  const events = eventsSource.data ?? [];
  const [eventId, setEventId] = useState("");
  const promosSource = useResource<Promo[]>(eventId ? `/promotions/event/${eventId}` : null);
  const promos = promosSource.data ?? [];
  const [form, setForm] = useState({ code: "", kind: "discount", discountPct: 15, maxUses: 50 });
  const [error, setError] = useState<string | null>(null);

  // Default to the newest night once the list arrives, without clobbering a choice.
  useEffect(() => {
    if (!eventId && events[0]) setEventId(events[0].id);
  }, [events, eventId]);

  const create = async (e2: React.FormEvent) => {
    e2.preventDefault();
    setError(null);
    try {
      await api.post("/promotions", { ...form, eventId });
      setForm({ code: "", kind: "discount", discountPct: 15, maxUses: 50 });
      promosSource.reload();
    } catch (err) { setError(errorMessage(err)); }
  };
  const loadError = error ?? eventsSource.error ?? promosSource.error;

  return (
    <>
      <TopNav />
      <main className="max-w-6xl mx-auto px-6 py-8 space-y-8">
        <h1 className="text-2xl font-black tracking-wide">PROMOTIONS</h1>
        {loadError && (
          <p role="alert" className="text-red-400 text-sm">
            {loadError}
          </p>
        )}
        <form onSubmit={create} className="grid md:grid-cols-6 gap-3 items-end border border-line bg-surface rounded-xl p-4">
          <select className="bg-bg border border-line rounded-lg px-3 py-2" value={eventId} onChange={(e) => setEventId(e.target.value)}>
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
