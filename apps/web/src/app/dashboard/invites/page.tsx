"use client";

import { useEffect, useState } from "react";
import { TopNav } from "@/components/TopNav";
import { api } from "@essentials/api-client";

interface Invite {
  id: string; code: string; role: string; maxUses: number; uses: number;
  revoked: boolean; expiresAt: string | null; createdAt: string; link: string;
}

const ROLE_LABEL: Record<string, string> = {
  guest: "Guest (app)",
  promoter: "Promoter (dashboard)",
  artist: "Artist (dashboard)",
  venue_manager: "Venue manager (dashboard)",
};

/** Admin: generate and manage per-role invite links. */
export default function Invites() {
  const [invites, setInvites] = useState<Invite[]>([]);
  const [form, setForm] = useState({ role: "guest", maxUses: 1, expiresInDays: 30 });
  const [copied, setCopied] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = () => api.get<Invite[]>("/invites").then(setInvites).catch((e) => setError(e.message));
  useEffect(() => { load(); }, []);

  const create = async () => {
    try { await api.post("/invites", form); load(); } catch (err: any) { setError(err.message); }
  };

  const revoke = async (id: string) => {
    await api.del(`/invites/${id}`).catch((e: any) => setError(e.message));
    load();
  };

  const copy = async (link: string) => {
    await navigator.clipboard.writeText(link);
    setCopied(link);
    setTimeout(() => setCopied(null), 1500);
  };

  const input = "bg-bg border border-line rounded-lg px-3 py-2";

  return (
    <>
      <TopNav />
      <main className="max-w-6xl mx-auto px-6 py-8 space-y-8">
        <h1 className="text-2xl font-black tracking-wide">INVITE LINKS</h1>
        {error && <p className="text-red-400 text-sm">{error}</p>}

        <div className="grid md:grid-cols-4 gap-3 items-end border border-line bg-surface rounded-xl p-4">
          <div>
            <span className="text-xs text-neutral-400 uppercase tracking-wider">Role</span>
            <select className={`${input} w-full mt-1`} value={form.role} onChange={(e) => setForm({ ...form, role: e.target.value })}>
              {Object.entries(ROLE_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
            </select>
          </div>
          <div>
            <span className="text-xs text-neutral-400 uppercase tracking-wider">Max uses</span>
            <input type="number" min={1} max={1000} className={`${input} w-full mt-1`} value={form.maxUses}
              onChange={(e) => setForm({ ...form, maxUses: +e.target.value })} />
          </div>
          <div>
            <span className="text-xs text-neutral-400 uppercase tracking-wider">Expires (days, blank = never)</span>
            <input type="number" min={1} max={365} className={`${input} w-full mt-1`} value={form.expiresInDays || ""}
              onChange={(e) => setForm({ ...form, expiresInDays: +e.target.value || 0 })} />
          </div>
          <button onClick={create} className="bg-neon text-bg font-black rounded-lg py-2 tracking-widest">GENERATE LINK</button>
        </div>

        <div className="border border-line rounded-xl overflow-x-auto">
          <table className="w-full text-sm min-w-[720px]">
            <thead className="bg-surface text-neutral-400 uppercase text-xs">
              <tr>
                <th className="text-left px-4 py-3">Role</th>
                <th className="text-left px-4 py-3">Link</th>
                <th className="text-left px-4 py-3">Uses</th>
                <th className="text-left px-4 py-3">Expires</th>
                <th className="text-left px-4 py-3">Status</th>
                <th className="text-left px-4 py-3"></th>
              </tr>
            </thead>
            <tbody>
              {invites.map((i) => (
                <tr key={i.id} className="border-t border-line">
                  <td className="px-4 py-3 font-bold">{ROLE_LABEL[i.role] ?? i.role}</td>
                  <td className="px-4 py-3">
                    <button onClick={() => copy(i.link)} className="font-mono text-xs text-neon underline" title={i.link}>
                      {copied === i.link ? "COPIED ✓" : `${i.link.slice(0, 42)}…`}
                    </button>
                  </td>
                  <td className="px-4 py-3">{i.uses}/{i.maxUses}</td>
                  <td className="px-4 py-3">{i.expiresAt ? new Date(i.expiresAt).toLocaleDateString() : "never"}</td>
                  <td className="px-4 py-3">
                    <span className={i.revoked ? "text-red-400" : i.uses >= i.maxUses ? "text-neutral-500" : "text-neon"}>
                      {i.revoked ? "revoked" : i.uses >= i.maxUses ? "used up" : "active"}
                    </span>
                  </td>
                  <td className="px-4 py-3">
                    {!i.revoked && <button onClick={() => revoke(i.id)} className="text-red-400 underline text-xs">revoke</button>}
                  </td>
                </tr>
              ))}
              {!invites.length && <tr><td colSpan={6} className="px-4 py-6 text-center text-neutral-500">No invite links yet.</td></tr>}
            </tbody>
          </table>
        </div>
      </main>
    </>
  );
}
