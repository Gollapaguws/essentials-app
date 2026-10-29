"use client";

import { useEffect, useState } from "react";
import { TopNav } from "@/components/TopNav";
import { Stat } from "@/components/Stat";
import { api } from "@essentials/api-client";

interface Profile { stageName: string; vehicleConsumptionLPer100km: number; travelRatePerKm: number }
interface Gig { id: string; startAt: string; endAt: string; status: string; setupBufferMin: number; teardownBufferMin: number; performanceFee: number; travelFee: number; event: { title: string; venue: { name: string } } }
interface Plan { legs: { distanceKm: number; durationMinutes: number; estimatedFuelCost: number; isConflict: boolean; conflictReason?: string; mapsUrl: string }[]; totals: { distanceKm: number; fuelCost: number; travelFee: number }; conflicts: number }
interface Invoice { id: string; number: string; status: string; total: number; items: { label: string; amount: number }[] }

/** Phase 3 artist portal: profile, gig calendar, collision alerts, fuel/travel costing, invoices. */
export default function ArtistPortal() {
  const [profile, setProfile] = useState<Profile | null>(null);
  const [gigs, setGigs] = useState<Gig[]>([]);
  const [plan, setPlan] = useState<Plan | null>(null);
  const [invoices, setInvoices] = useState<Invoice[]>([]);
  const [planDate, setPlanDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [form, setForm] = useState<Profile>({ stageName: "", vehicleConsumptionLPer100km: 8, travelRatePerKm: 2.5 });
  const [error, setError] = useState<string | null>(null);

  const loadAll = () => {
    api.get<Profile | null>("/artists/me").then((p) => { setProfile(p); if (p) setForm(p); }).catch(() => {});
    api.get<Gig[]>("/artists/gigs").then(setGigs).catch(() => {});
    api.get<Invoice[]>("/invoices").then(setInvoices).catch(() => {});
  };
  useEffect(() => { loadAll(); }, []);

  const saveProfile = async (e: React.FormEvent) => {
    e.preventDefault();
    try { await api.post("/artists/me", form); loadAll(); } catch (err: any) { setError(err.message); }
  };

  const runPlan = async (save = false) => {
    try {
      const p = save
        ? await api.post<Plan>("/artists/route-plan/save", { date: planDate })
        : await api.get<Plan>(`/artists/route-plan?date=${planDate}`);
      setPlan(p);
    } catch (err: any) { setError(err.message); }
  };

  const generateInvoice = async () => {
    try { await api.post("/invoices/generate", {}); loadAll(); } catch (err: any) { setError(err.message); }
  };

  const paymentLink = async (invoiceId: string, provider: "payfast" | "stripe") => {
    try {
      const r = await api.post<{ url: string; reference: string }>(`/invoices/${invoiceId}/payment-link`, { provider });
      alert(`Payment link (${provider}): ${r.url}`);
    } catch (err: any) { setError(err.message); }
  };

  return (
    <>
      <TopNav />
      <main className="max-w-6xl mx-auto px-6 py-8 space-y-8">
        <h1 className="text-2xl font-black tracking-wide">ARTIST PORTAL</h1>
        {error && <p className="text-red-400 text-sm">{error}</p>}
        {!profile && <p className="text-neutral-500 text-sm">Set up your profile below to unlock gigs, routing and invoices.</p>}

        {/* Profile */}
        <form onSubmit={saveProfile} className="grid md:grid-cols-4 gap-3 items-end border border-line bg-surface rounded-xl p-4">
          <input required className="bg-bg border border-line rounded-lg px-3 py-2" placeholder="Stage name" value={form.stageName} onChange={(e) => setForm({ ...form, stageName: e.target.value })} />
          <label className="text-xs text-neutral-400">Vehicle L/100km<input type="number" step="0.1" min={1} className="w-full bg-bg border border-line rounded-lg px-3 py-2 mt-1" value={form.vehicleConsumptionLPer100km} onChange={(e) => setForm({ ...form, vehicleConsumptionLPer100km: +e.target.value })} /></label>
          <label className="text-xs text-neutral-400">Travel rate /km<input type="number" step="0.1" min={0} className="w-full bg-bg border border-line rounded-lg px-3 py-2 mt-1" value={form.travelRatePerKm} onChange={(e) => setForm({ ...form, travelRatePerKm: +e.target.value })} /></label>
          <button className="bg-neon text-bg font-black rounded-lg py-2 tracking-widest">SAVE PROFILE</button>
        </form>

        {/* Gig calendar */}
        <section className="border border-line bg-surface rounded-xl p-4">
          <h2 className="font-bold text-neon uppercase text-sm tracking-wider mb-3">Gig calendar</h2>
          {gigs.map((g) => (
            <div key={g.id} className="border-t border-line py-3 flex flex-wrap justify-between gap-2 text-sm">
              <div>
                <p className="font-bold">{g.event.title} <span className="text-neutral-500">@ {g.event.venue.name}</span></p>
                <p className="text-neutral-500">{new Date(g.startAt).toLocaleString()} → {new Date(g.endAt).toLocaleTimeString()} · fee R{g.performanceFee.toLocaleString()}</p>
              </div>
              <span className={g.status === "confirmed" ? "text-neon" : "text-neutral-400"}>{g.status}</span>
            </div>
          ))}
          {!gigs.length && <p className="text-neutral-500 text-sm">No bookings yet — promoters book you from the event lineup.</p>}
        </section>

        {/* Routing */}
        <section className="border border-line bg-surface rounded-xl p-4">
          <h2 className="font-bold text-neon uppercase text-sm tracking-wider mb-3">Multi-gig routing &amp; collision alerts</h2>
          <div className="flex flex-wrap gap-3 items-end">
            <label className="text-xs text-neutral-400">Plan date<input type="date" className="block bg-bg border border-line rounded-lg px-3 py-2 mt-1" value={planDate} onChange={(e) => setPlanDate(e.target.value)} /></label>
            <button onClick={() => runPlan(false)} className="bg-neon text-bg font-black rounded-lg px-4 py-2 text-sm tracking-widest">CALCULATE</button>
            <button onClick={() => runPlan(true)} className="border border-neon text-neon font-bold rounded-lg px-4 py-2 text-sm">SAVE TO BOOKING</button>
          </div>
          {plan && (
            <>
              <div className="grid grid-cols-3 gap-4 mt-4">
                <Stat label="Distance" value={`${plan.totals.distanceKm} km`} />
                <Stat label="Fuel cost" value={`R${plan.totals.fuelCost}`} />
                <Stat label="Billable travel fee" value={`R${plan.totals.travelFee}`} />
              </div>
              {plan.legs.map((l, i) => (
                <div key={i} className={`mt-3 border rounded-lg p-3 text-sm ${l.isConflict ? "border-red-500 bg-red-500/10" : "border-line"}`}>
                  <p className="font-bold">{l.distanceKm} km · ~{l.durationMinutes} min drive{plan.conflicts > 0 && <span className="text-red-400"> · ⚠ SCHEDULE COLLISION</span>}</p>
                  {l.conflictReason && <p className="text-red-400 text-xs mt-1">{l.conflictReason}</p>}
                  <a href={l.mapsUrl} target="_blank" className="text-neon text-xs underline">Open in Google Maps →</a>
                </div>
              ))}
              {!plan.legs.length && <p className="text-neutral-500 text-sm mt-3">No back-to-back gigs on this date.</p>}
            </>
          )}
        </section>

        {/* Invoices */}
        <section className="border border-line bg-surface rounded-xl p-4">
          <div className="flex justify-between items-center mb-3">
            <h2 className="font-bold text-neon uppercase text-sm tracking-wider">Invoices</h2>
            <button onClick={generateInvoice} className="bg-neon text-bg font-black rounded-lg px-4 py-2 text-sm tracking-widest">GENERATE FROM CONFIRMED GIGS</button>
          </div>
          {invoices.map((inv) => (
            <div key={inv.id} className="border-t border-line py-3 text-sm flex flex-wrap justify-between gap-2">
              <div>
                <p className="font-bold font-mono">{inv.number} <span className="text-neutral-500">· {inv.status} · R{inv.total.toLocaleString()}</span></p>
                <p className="text-neutral-500 text-xs">{inv.items.length} items</p>
              </div>
              <div className="flex gap-2">
                <a href={`${process.env.NEXT_PUBLIC_API_URL}/invoices/${inv.id}/print`} target="_blank" className="text-neon underline text-sm">Print/PDF</a>
                <button onClick={() => paymentLink(inv.id, "payfast")} className="border border-line rounded-lg px-3 text-xs">PayFast link</button>
                <button onClick={() => paymentLink(inv.id, "stripe")} className="border border-line rounded-lg px-3 text-xs">Stripe link</button>
              </div>
            </div>
          ))}
          {!invoices.length && <p className="text-neutral-500 text-sm">No invoices yet.</p>}
        </section>
      </main>
    </>
  );
}
