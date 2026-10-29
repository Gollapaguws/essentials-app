"use client";

import { useEffect, useState } from "react";
import { TopNav } from "@/components/TopNav";
import { api } from "@essentials/api-client";

interface EventRow {
  id: string; title: string; date: string; status: string; capacity: number;
  venue: { name: string };
  _count: { guestLists: number; tableBookings: number };
}

/** Event manager: CRUD, capacity caps, live guest lists. */
export default function EventManager() {
  const [events, setEvents] = useState<EventRow[]>([]);
  const [form, setForm] = useState({ title: "", venueId: "", date: "", capacity: 100 });
  const [error, setError] = useState<string | null>(null);

  const load = () => api.get<EventRow[]>("/events/manage/list").then(setEvents).catch((e) => setError(e.message));
  useEffect(() => { load(); }, []);

  const create = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      await api.post("/events", { ...form, date: new Date(form.date).toISOString() });
      setForm({ title: "", venueId: "", date: "", capacity: 100 });
      load();
    } catch (err: any) {
      setError(err.message);
    }
  };

  return (
    <>
      <TopNav />
      <main className="max-w-6xl mx-auto px-6 py-8 space-y-8">
        <h1 className="text-2xl font-black tracking-wide">EVENT MANAGER</h1>
        {error && <p className="text-red-400 text-sm">{error}</p>}

        <form onSubmit={create} className="grid md:grid-cols-5 gap-3 items-end border border-line bg-surface rounded-xl p-4">
          <input required className="bg-bg border border-line rounded-lg px-3 py-2" placeholder="Event title" value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} />
          <input required className="bg-bg border border-line rounded-lg px-3 py-2" placeholder="Venue ID" value={form.venueId} onChange={(e) => setForm({ ...form, venueId: e.target.value })} />
          <input required type="datetime-local" className="bg-bg border border-line rounded-lg px-3 py-2" value={form.date} onChange={(e) => setForm({ ...form, date: e.target.value })} />
          <input required type="number" min={1} className="bg-bg border border-line rounded-lg px-3 py-2" placeholder="Capacity" value={form.capacity} onChange={(e) => setForm({ ...form, capacity: +e.target.value })} />
          <button className="bg-neon text-bg font-black rounded-lg py-2 tracking-widest">CREATE (pending approval)</button>
        </form>

        <div className="border border-line rounded-xl overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-surface text-neutral-400 uppercase text-xs">
              <tr>
                <th className="text-left px-4 py-3">Event</th>
                <th className="text-left px-4 py-3">Venue</th>
                <th className="text-left px-4 py-3">Date</th>
                <th className="text-left px-4 py-3">Status</th>
                <th className="text-left px-4 py-3">Guests</th>
                <th className="text-left px-4 py-3">Tables</th>
              </tr>
            </thead>
            <tbody>
              {events.map((e) => (
                <tr key={e.id} className="border-t border-line">
                  <td className="px-4 py-3 font-bold">{e.title}</td>
                  <td className="px-4 py-3 text-neutral-400">{e.venue.name}</td>
                  <td className="px-4 py-3">{new Date(e.date).toLocaleDateString()}</td>
                  <td className="px-4 py-3"><span className={e.status === "approved" || e.status === "live" ? "text-neon" : "text-neutral-400"}>{e.status}</span></td>
                  <td className="px-4 py-3">{e._count.guestLists}/{e.capacity}</td>
                  <td className="px-4 py-3">{e._count.tableBookings}</td>
                </tr>
              ))}
              {!events.length && (
                <tr><td colSpan={6} className="px-4 py-6 text-center text-neutral-500">No events yet. Seed the demo data to see one.</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </main>
    </>
  );
}
