"use client";

import { useEffect, useState } from "react";
import { TopNav } from "@/components/TopNav";
import { Stat } from "@/components/Stat";
import { api } from "@essentials/api-client";

interface Venue { id: string; name: string; capacity: number; _count: { events: number; tables: number } }
interface PendingEvent { id: string; title: string; date: string; venue: { name: string }; promoter: { name: string | null }; capacity: number }
interface VenueTable { id: string; tableNumber: string; capacity: number; minSpend: number }
interface DoorLog { id: string; result: string; qrToken: string; createdAt: string }
interface Analytics {
  totals: { events: number; rsvps: number; checkedIn: number; tableRevenue: number; venueRevenue: number };
  perEvent: { name: string; rsvps: number; checkedIn: number; tableRevenue: number; venueRevenue: number; promoterRevenue: number; status: string }[];
}

/** Phase 2 venue portal: approval workflow, table inventory, door ops, analytics, revenue splits. */
export default function VenuePortal() {
  const [venues, setVenues] = useState<Venue[]>([]);
  const [venueId, setVenueId] = useState<string>("");
  const [pending, setPending] = useState<PendingEvent[]>([]);
  const [tables, setTables] = useState<VenueTable[]>([]);
  const [logs, setLogs] = useState<DoorLog[]>([]);
  const [analytics, setAnalytics] = useState<Analytics | null>(null);
  const [tableForm, setTableForm] = useState({ tableNumber: "", capacity: 6, minSpend: 5000 });
  const [error, setError] = useState<string | null>(null);

  const loadVenue = (id: string) => {
    setVenueId(id);
    api.get<PendingEvent[]>("/venues/events/pending").then(setPending).catch((e) => setError(e.message));
    api.get<VenueTable[]>(`/venues/${id}/tables`).then(setTables).catch(() => {});
    api.get<DoorLog[]>(`/venues/${id}/door-logs`).then(setLogs).catch(() => {});
    api.get<Analytics>(`/venues/${id}/analytics`).then(setAnalytics).catch(() => {});
  };
  useEffect(() => {
    api.get<Venue[]>("/venues/mine").then((v) => { setVenues(v); if (v[0]) loadVenue(v[0].id); }).catch((e) => setError(e.message));
  }, []);

  const decide = async (id: string, approve: boolean) => {
    await api.post(`/venues/events/${id}/decision`, { approve });
    loadVenue(venueId);
  };

  const saveTable = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      await api.post(`/venues/${venueId}/tables`, tableForm);
      setTableForm({ tableNumber: "", capacity: 6, minSpend: 5000 });
      loadVenue(venueId);
    } catch (err: any) { setError(err.message); }
  };

  const removeTable = async (tableNumber: string) => {
    await api.del(`/venues/${venueId}/tables/${tableNumber}`).catch((e: any) => setError(e.message));
    loadVenue(venueId);
  };

  return (
    <>
      <TopNav />
      <main className="max-w-6xl mx-auto px-6 py-8 space-y-8">
        <h1 className="text-2xl font-black tracking-wide">VENUE PORTAL</h1>
        {error && <p className="text-red-400 text-sm">{error}</p>}
        {venues.length > 1 && (
          <select className="bg-bg border border-line rounded-lg px-3 py-2" value={venueId} onChange={(e) => loadVenue(e.target.value)}>
            {venues.map((v) => <option key={v.id} value={v.id}>{v.name}</option>)}
          </select>
        )}

        {/* Approval workflow */}
        <section className="border border-line bg-surface rounded-xl p-4">
          <h2 className="font-bold text-neon uppercase text-sm tracking-wider mb-3">Pending event approvals</h2>
          {pending.map((e) => (
            <div key={e.id} className="flex flex-wrap items-center justify-between border-t border-line py-3 gap-2">
              <div>
                <p className="font-bold">{e.title} <span className="text-neutral-500 text-sm">by {e.promoter.name}</span></p>
                <p className="text-neutral-500 text-sm">{e.venue.name} · {new Date(e.date).toLocaleDateString()} · cap {e.capacity}</p>
              </div>
              <div className="flex gap-2">
                <button onClick={() => decide(e.id, true)} className="bg-neon text-bg font-black px-4 py-2 rounded-lg text-sm">APPROVE</button>
                <button onClick={() => decide(e.id, false)} className="border border-red-500 text-red-400 px-4 py-2 rounded-lg text-sm font-bold">REJECT</button>
              </div>
            </div>
          ))}
          {!pending.length && <p className="text-neutral-500 text-sm">Nothing pending.</p>}
        </section>

        {/* Analytics + revenue splits */}
        {analytics && (
          <section className="space-y-4">
            <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
              <Stat label="Events" value={analytics.totals.events} />
              <Stat label="RSVPs" value={analytics.totals.rsvps} />
              <Stat label="Checked in" value={analytics.totals.checkedIn} />
              <Stat label="Table revenue" value={`R${analytics.totals.tableRevenue.toLocaleString()}`} />
              <Stat label="Venue take" value={`R${analytics.totals.venueRevenue.toLocaleString()}`} />
            </div>
            <div className="border border-line rounded-xl overflow-x-auto">
              <table className="w-full text-sm min-w-[640px]">
                <thead className="bg-surface text-neutral-400 uppercase text-xs">
                  <tr>
                    <th className="text-left px-4 py-3">Event</th><th className="text-left px-4 py-3">Status</th>
                    <th className="text-left px-4 py-3">RSVPs</th><th className="text-left px-4 py-3">Door</th>
                    <th className="text-left px-4 py-3">Table rev</th><th className="text-left px-4 py-3">Venue</th><th className="text-left px-4 py-3">Promoter</th>
                  </tr>
                </thead>
                <tbody>
                  {analytics.perEvent.map((e) => (
                    <tr key={e.name} className="border-t border-line">
                      <td className="px-4 py-3 font-bold">{e.name}</td>
                      <td className="px-4 py-3">{e.status}</td>
                      <td className="px-4 py-3">{e.rsvps}</td>
                      <td className="px-4 py-3">{e.checkedIn}</td>
                      <td className="px-4 py-3">R{e.tableRevenue.toLocaleString()}</td>
                      <td className="px-4 py-3 text-neon">R{e.venueRevenue.toLocaleString()}</td>
                      <td className="px-4 py-3">R{e.promoterRevenue.toLocaleString()}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        )}

        {/* Table inventory */}
        <section className="border border-line bg-surface rounded-xl p-4">
          <h2 className="font-bold text-neon uppercase text-sm tracking-wider mb-3">Table inventory</h2>
          <form onSubmit={saveTable} className="grid grid-cols-2 md:grid-cols-4 gap-3 items-end">
            <input required className="bg-bg border border-line rounded-lg px-3 py-2" placeholder="Table # (T4)" value={tableForm.tableNumber} onChange={(e) => setTableForm({ ...tableForm, tableNumber: e.target.value })} />
            <input type="number" min={1} className="bg-bg border border-line rounded-lg px-3 py-2" placeholder="Capacity" value={tableForm.capacity} onChange={(e) => setTableForm({ ...tableForm, capacity: +e.target.value })} />
            <input type="number" min={0} className="bg-bg border border-line rounded-lg px-3 py-2" placeholder="Min spend" value={tableForm.minSpend} onChange={(e) => setTableForm({ ...tableForm, minSpend: +e.target.value })} />
            <button className="bg-neon text-bg font-black rounded-lg py-2 tracking-widest">SAVE</button>
          </form>
          <div className="mt-4 flex flex-wrap gap-2">
            {tables.map((t) => (
              <span key={t.id} className="border border-line rounded-lg px-3 py-2 text-sm">
                <strong>{t.tableNumber}</strong> · {t.capacity}p · R{t.minSpend.toLocaleString()}
                <button onClick={() => removeTable(t.tableNumber)} className="text-red-400 ml-2 font-bold">×</button>
              </span>
            ))}
            {!tables.length && <p className="text-neutral-500 text-sm">No tables yet.</p>}
          </div>
        </section>

        {/* Door ops */}
        <section className="border border-line bg-surface rounded-xl p-4">
          <h2 className="font-bold text-neon uppercase text-sm tracking-wider mb-3">Door scan monitor (last 100)</h2>
          <div className="max-h-64 overflow-y-auto">
            {logs.map((l) => (
              <div key={l.id} className="flex justify-between border-t border-line py-2 text-sm">
                <span className="font-mono text-xs text-neutral-400 truncate max-w-[60%]">{l.qrToken}</span>
                <span className={l.result === "ok" ? "text-neon" : "text-red-400"}>{l.result}</span>
                <span className="text-neutral-500">{new Date(l.createdAt).toLocaleTimeString()}</span>
              </div>
            ))}
            {!logs.length && <p className="text-neutral-500 text-sm">No scans yet.</p>}
          </div>
        </section>
      </main>
    </>
  );
}
