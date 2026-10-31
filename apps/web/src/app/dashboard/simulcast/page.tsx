"use client";

import { useEffect, useState } from "react";
import { TopNav } from "@/components/TopNav";
import { api } from "@essentials/api-client";

interface Target { id: string; platform: string; label: string | null; url: string; enabled: boolean; live: boolean }
interface LiveStatus { live: boolean; rtspUrl: string; simulcast: Record<string, boolean> }

const PLATFORMS: { key: string; label: string; hint: string }[] = [
  { key: "youtube", label: "YouTube Live", hint: "YouTube Studio → Go live → stream key. URL: rtmp://a.rtmp.youtube.com/live2/<key>" },
  { key: "facebook", label: "Facebook Live", hint: "Live producer → stream key. URL: rtmps://live-api-s.facebook.com:443/rtmp/<key>" },
  { key: "tiktok", label: "TikTok Live", hint: "TikTok LIVE Studio → server URL + key (full rtmp:// URL)" },
  { key: "mixcloud", label: "Mixcloud Live", hint: "Mixcloud broadcaster → rtmp://rtmp.mixcloud.com/live/<key>" },
  { key: "instagram", label: "Instagram Live", hint: "No official RTMP — use an Instagram RTMP relay service URL" },
  { key: "custom", label: "Custom RTMP", hint: "Any rtmp:// or rtmps:// push URL" },
];

const labelFor = (k: string) => PLATFORMS.find((p) => p.key === k)?.label ?? k;

/** Admin: simulcast targets — GO LIVE pushes to every enabled platform. */
export default function Simulcast() {
  const [targets, setTargets] = useState<Target[]>([]);
  const [status, setStatus] = useState<LiveStatus | null>(null);
  const [form, setForm] = useState({ platform: "youtube", url: "", label: "" });
  const [error, setError] = useState<string | null>(null);

  const load = () => {
    api.get<Target[]>("/live/targets").then(setTargets).catch((e) => setError(e.message));
    api.get<LiveStatus>("/live/status").then(setStatus).catch(() => {});
  };
  useEffect(() => { load(); const id = setInterval(() => api.get<LiveStatus>("/live/status").then(setStatus).catch(() => {}), 5000); return () => clearInterval(id); }, []);

  const add = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    try { await api.post("/live/targets", form); setForm({ ...form, url: "", label: "" }); load(); }
    catch (err: any) { setError(err.message); }
  };

  const toggle = async (id: string) => {
    try { await api.post(`/live/targets/${id}/toggle`); load(); } catch (err: any) { setError(err.message); }
  };

  const remove = async (id: string) => {
    try { await api.del(`/live/targets/${id}`); load(); } catch (err: any) { setError(err.message); }
  };

  const input = "w-full bg-bg border border-line rounded-lg px-3 py-2";

  return (
    <>
      <TopNav />
      <main className="max-w-4xl mx-auto px-6 py-8 space-y-8">
        <h1 className="text-2xl font-black tracking-wide">MULTI-PLATFORM STREAMING</h1>
        <p className="text-neutral-500 text-sm">
          When you GO LIVE on the front page, the stream is automatically pushed to every enabled
          platform below. Stream keys stay on the server and are never shown again.
          {status?.live && <span className="text-neon font-bold"> ● BROADCAST IS LIVE — pushing to {Object.values(status.simulcast ?? {}).filter(Boolean).length} platform(s)</span>}
        </p>
        {error && <p className="text-red-400 text-sm">{error}</p>}

        <form onSubmit={add} className="border border-line bg-surface rounded-xl p-4 space-y-3">
          <div className="grid md:grid-cols-3 gap-3">
            <div>
              <span className="text-xs text-neutral-400 uppercase tracking-wider">Platform</span>
              <select className={`${input} mt-1`} value={form.platform} onChange={(e) => setForm({ ...form, platform: e.target.value })}>
                {PLATFORMS.map((p) => <option key={p.key} value={p.key}>{p.label}</option>)}
              </select>
            </div>
            <div className="md:col-span-2">
              <span className="text-xs text-neutral-400 uppercase tracking-wider">Full RTMP(S) push URL (incl. stream key)</span>
              <input required className={`${input} mt-1 font-mono text-xs`} placeholder="rtmp://a.rtmp.youtube.com/live2/xxxx-xxxx-…" value={form.url}
                onChange={(e) => setForm({ ...form, url: e.target.value })} />
            </div>
          </div>
          <div className="grid md:grid-cols-3 gap-3 items-end">
            <div>
              <span className="text-xs text-neutral-400 uppercase tracking-wider">Label (optional)</span>
              <input className={`${input} mt-1`} placeholder="Main channel" value={form.label} onChange={(e) => setForm({ ...form, label: e.target.value })} />
            </div>
            <button className="bg-neon text-bg font-black rounded-lg py-2 tracking-widest md:col-span-2">ADD TARGET</button>
          </div>
          <p className="text-neutral-500 text-xs">{PLATFORMS.find((p) => p.key === form.platform)?.hint}</p>
        </form>

        <div className="border border-line rounded-xl overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-surface text-neutral-400 uppercase text-xs">
              <tr>
                <th className="text-left px-4 py-3">Platform</th>
                <th className="text-left px-4 py-3">Push URL</th>
                <th className="text-left px-4 py-3">Enabled</th>
                <th className="text-left px-4 py-3">Live</th>
                <th className="text-left px-4 py-3"></th>
              </tr>
            </thead>
            <tbody>
              {targets.map((t) => (
                <tr key={t.id} className="border-t border-line">
                  <td className="px-4 py-3 font-bold">{labelFor(t.platform)}{t.label ? <span className="text-neutral-500 font-normal"> · {t.label}</span> : null}</td>
                  <td className="px-4 py-3 font-mono text-xs text-neutral-400">{t.url}</td>
                  <td className="px-4 py-3">
                    <button onClick={() => toggle(t.id)} className={t.enabled ? "text-neon font-bold" : "text-neutral-500"}>{t.enabled ? "ON" : "OFF"}</button>
                  </td>
                  <td className="px-4 py-3">{t.live ? <span className="text-red-400 font-bold">● LIVE</span> : "—"}</td>
                  <td className="px-4 py-3"><button onClick={() => remove(t.id)} className="text-red-400 underline text-xs">Delete</button></td>
                </tr>
              ))}
              {!targets.length && <tr><td colSpan={5} className="px-4 py-6 text-center text-neutral-500">No targets yet — add YouTube, TikTok, Mixcloud, Facebook or a custom RTMP.</td></tr>}
            </tbody>
          </table>
        </div>
      </main>
    </>
  );
}
