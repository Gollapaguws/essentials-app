"use client";

import { useEffect, useState } from "react";
import { TopNav } from "@/components/TopNav";
import { api } from "@essentials/api-client";

interface Campaign {
  id: string; name: string; flow: string; status: string; subject: string; sentCount: number;
  segment?: { name: string } | null;
  _count: { emailJobs: number };
}
interface Attribution {
  guestListJoins: number;
  tableBookings: number;
  tableRevenue: number;
  campaign: { name: string; sentCount: number };
}

const FLOWS = ["welcome_series", "weekly_drop", "reminder_24h", "reminder_1h", "winback", "one_off"];

/** Email engine v1: flows, segments, sends, one-click unsubscribe, campaign attribution. */
export default function EmailEngine() {
  const [campaigns, setCampaigns] = useState<Campaign[]>([]);
  const [segments, setSegments] = useState<{ id: string; name: string }[]>([]);
  const [attr, setAttr] = useState<Attribution | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [form, setForm] = useState({ name: "", flow: "weekly_drop", subject: "", segmentId: "" });

  const load = () => {
    api.get<Campaign[]>("/email/campaigns").then(setCampaigns).catch((e) => setError(e.message));
    api.get<{ id: string; name: string }[]>("/email/segments").then(setSegments).catch(() => {});
  };
  useEffect(() => { load(); }, []);

  const send = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      await api.post("/email/campaigns", { ...form, segmentId: form.segmentId || undefined });
      setForm({ name: "", flow: "weekly_drop", subject: "", segmentId: "" });
      load();
    } catch (err: any) { setError(err.message); }
  };

  const showAttribution = async (id: string) => {
    try { setAttr(await api.get<Attribution>(`/email/campaigns/${id}/attribution`)); } catch {}
  };

  return (
    <>
      <TopNav />
      <main className="max-w-6xl mx-auto px-6 py-8 space-y-8">
        <h1 className="text-2xl font-black tracking-wide">EMAIL ENGINE v1</h1>
        <p className="text-neutral-500 text-sm">
          Provider: Resend (swappable — self-hosted listmonk + Postal comes in Phase 2).
          SPF/DKIM/DMARC setup: see <code className="text-neon">docs/email-deliverability.md</code>.
          All bulk sends include one-click unsubscribe + consent records.
        </p>
        {error && <p className="text-red-400 text-sm">{error}</p>}

        <form onSubmit={send} className="grid md:grid-cols-5 gap-3 items-end border border-line bg-surface rounded-xl p-4">
          <input required className="bg-bg border border-line rounded-lg px-3 py-2" placeholder="Campaign name" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
          <select className="bg-bg border border-line rounded-lg px-3 py-2" value={form.flow} onChange={(e) => setForm({ ...form, flow: e.target.value })}>
            {FLOWS.map((f) => <option key={f} value={f}>{f}</option>)}
          </select>
          <input required className="bg-bg border border-line rounded-lg px-3 py-2" placeholder="Subject" value={form.subject} onChange={(e) => setForm({ ...form, subject: e.target.value })} />
          <select className="bg-bg border border-line rounded-lg px-3 py-2" value={form.segmentId} onChange={(e) => setForm({ ...form, segmentId: e.target.value })}>
            <option value="">All consenting guests</option>
            {segments.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
          </select>
          <button className="bg-neon text-bg font-black rounded-lg py-2 tracking-widest">QUEUE SEND</button>
        </form>

        {attr && (
          <div className="border border-neon/40 bg-surface rounded-xl p-4">
            <h2 className="font-bold text-neon">Attribution · {attr.campaign.name}</h2>
            <p className="mt-2 text-sm">
              Guest-list joins: <strong>{attr.guestListJoins}</strong> · Table bookings: <strong>{attr.tableBookings}</strong> ·
              Table revenue: <strong>R{attr.tableRevenue.toLocaleString()}</strong> · Sent: {attr.campaign.sentCount}
            </p>
          </div>
        )}

        <div className="border border-line rounded-xl overflow-x-auto">
          <table className="w-full text-sm min-w-[640px]">
            <thead className="bg-surface text-neutral-400 uppercase text-xs">
              <tr>
                <th className="text-left px-4 py-3">Campaign</th>
                <th className="text-left px-4 py-3">Flow</th>
                <th className="text-left px-4 py-3">Segment</th>
                <th className="text-left px-4 py-3">Status</th>
                <th className="text-left px-4 py-3">Sent</th>
                <th className="text-left px-4 py-3">Attribution</th>
              </tr>
            </thead>
            <tbody>
              {campaigns.map((c) => (
                <tr key={c.id} className="border-t border-line">
                  <td className="px-4 py-3 font-bold">{c.name}</td>
                  <td className="px-4 py-3 text-neutral-400">{c.flow}</td>
                  <td className="px-4 py-3 text-neutral-400">{c.segment?.name ?? "All"}</td>
                  <td className="px-4 py-3">{c.status}</td>
                  <td className="px-4 py-3">{c.sentCount}</td>
                  <td className="px-4 py-3">
                    <button onClick={() => showAttribution(c.id)} className="text-neon underline">View</button>
                  </td>
                </tr>
              ))}
              {!campaigns.length && <tr><td colSpan={6} className="px-4 py-6 text-center text-neutral-500">No campaigns yet.</td></tr>}
            </tbody>
          </table>
        </div>
      </main>
    </>
  );
}
