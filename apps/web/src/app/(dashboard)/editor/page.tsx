"use client";

import { useEffect, useState } from "react";
import { TopNav } from "@/components/TopNav";
import { api } from "@essentials/api-client";
import { errorMessage } from "@/lib/errors";

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "https://essentialsedm.com/api";
const MAX_UPLOAD = 120 * 1024 * 1024;

interface FrontPageEvent { title: string; displayDate: string; city: string; venue: string; doors: string; price: string; status?: string }
interface Visual { src: string; label: string }
interface FrontPage {
  tagline?: string; heroPitch?: string; ctaLabel?: string; city?: string;
  quote?: string; manifestoP1?: string; manifestoP2?: string;
  events?: FrontPageEvent[];
  footerLeft?: string; footerRight?: string;
  heroSlides?: string[];
  visuals?: Visual[];
  idleLoop?: string;
  lineupPublishAt?: string;
}

interface SiteStats {
  days: { day: string; views: number; uniqueVisitors: number }[];
  paths: { path: string; views: number }[];
  events: Record<"install_banner_dismiss" | "install_prompt_open" | "app_install", number>;
}

const emptyEvent: FrontPageEvent = { title: "", displayDate: "", city: "", venue: "", doors: "22:00", price: "R150", status: "ANNOUNCED" };

function SiteMetric({ label, value }: { label: string; value: number }) {
  return (
    <div className="border border-line rounded-lg px-4 py-3">
      <div className="text-2xl font-black tabular-nums">{value.toLocaleString()}</div>
      <div className="text-[10px] uppercase tracking-widest text-neutral-500">{label}</div>
    </div>
  );
}

/** Admin editor for the essentialsedm.com front page. Saves to /api/site/content (admin-only). */
export default function FrontPageEditor() {
  const [c, setC] = useState<FrontPage>({});
  const [stats, setStats] = useState<SiteStats | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api.get<FrontPage>("/site/content").then(setC).catch((e) => setError(errorMessage(e)));
    api.get<SiteStats>("/site/stats").then(setStats).catch(() => {});
  }, []);

  const set = (patch: Partial<FrontPage>) => setC((p) => ({ ...p, ...patch }));
  const uploadMedia = async (file: File, cb: (url: string) => void) => {
    setError(null);
    if (file.size > MAX_UPLOAD) {
      setError(`"${file.name}" is ${(file.size / 1024 / 1024).toFixed(1)} MB — the upload limit is 120 MB.`);
      return;
    }
    const fd = new FormData();
    fd.append("file", file);
    try {
      const res = await fetch(`${API_URL}/site/media`, {
        method: "POST",
        // Admin upload: the httpOnly session cookie authenticates it.
        credentials: "include",
        body: fd,
      });
      const raw = await res.text();
      // nginx rejects oversized bodies with an HTML page, so never assume JSON.
      let data: { url?: string; message?: string | string[] } = {};
      try { data = raw ? JSON.parse(raw) : {}; } catch { /* keep the status message below */ }
      if (!res.ok) {
        const detail = Array.isArray(data.message) ? data.message.join(", ") : data.message;
        throw new Error(detail ?? (res.status === 413
          ? "Upload is too large — the limit is 120 MB."
          : `Upload failed (${res.status}).`));
      }
      if (!data.url) throw new Error("Upload failed — no file URL returned.");
      cb(data.url);
    } catch (err) { setError(errorMessage(err)); }
  };

  const setEvent = (i: number, patch: Partial<FrontPageEvent>) =>
    setC((p) => ({ ...p, events: (p.events ?? []).map((e, j) => (j === i ? { ...e, ...patch } : e)) }));

  const save = async () => {
    setError(null); setMsg(null);
    try {
      await api.post("/site/content", c);
      setMsg("Saved â€” the front page updates on next load.");
    } catch (err) {
      setError(errorMessage(err));
    }
  };

  const input = "w-full bg-bg border border-line rounded-lg px-3 py-2";
  const label = "text-xs text-neutral-400 uppercase tracking-wider";
  const pageViews = stats?.days.reduce((total, day) => total + day.views, 0) ?? 0;
  const uniqueVisitors = stats?.days.reduce((total, day) => total + day.uniqueVisitors, 0) ?? 0;
  // The API returns newest first; the chart reads left to right in time.
  const dailyViews = stats ? [...stats.days].reverse() : [];
  const peakViews = Math.max(1, ...dailyViews.map((day) => day.views));

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

        {stats && (
          <section className="border border-line bg-surface rounded-xl p-4 space-y-4">
            <div>
              <h2 className="font-bold text-neon uppercase text-sm tracking-wider">Front page analytics</h2>
              <p className="text-xs text-neutral-500 mt-1">
                Last 30 days · anonymous daily counts, no cookies. Visitors are counted per day.
                Android/Chrome installs report automatically; iOS installs cannot be measured.
              </p>
            </div>
            <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
              <SiteMetric label="Page views" value={pageViews} />
              <SiteMetric label="Unique visitors" value={uniqueVisitors} />
              <SiteMetric label="Banner dismissals" value={stats.events.install_banner_dismiss} />
              <SiteMetric label="Install prompt opens" value={stats.events.install_prompt_open} />
              <SiteMetric label="App installs" value={stats.events.app_install} />
            </div>
            <div className="grid md:grid-cols-3 gap-4">
              <div className="md:col-span-2">
                <h3 className="text-[10px] uppercase tracking-widest text-neutral-500 mb-2">Views per day</h3>
                {dailyViews.length ? (
                  <div className="flex h-28 items-end gap-1" role="img" aria-label={`Daily page views for the last ${dailyViews.length} days with traffic`}>
                    {dailyViews.map((day) => (
                      <div
                        key={day.day}
                        className="flex-1 rounded-t bg-neon/60 hover:bg-neon"
                        style={{ height: `${Math.max(3, (day.views / peakViews) * 100)}%` }}
                        title={`${day.day}: ${day.views.toLocaleString()} views · ${day.uniqueVisitors.toLocaleString()} visitors`}
                      />
                    ))}
                  </div>
                ) : (
                  <p className="text-xs text-neutral-500">No traffic recorded yet.</p>
                )}
              </div>
              <div>
                <h3 className="text-[10px] uppercase tracking-widest text-neutral-500 mb-2">Top pages</h3>
                {stats.paths.length ? (
                  <ul className="space-y-1.5">
                    {stats.paths.map((page) => (
                      <li key={page.path} className="flex items-baseline justify-between gap-3 text-xs">
                        <span className="truncate font-mono text-neutral-300" title={page.path}>{page.path}</span>
                        <span className="tabular-nums text-neutral-500">{page.views.toLocaleString()}</span>
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="text-xs text-neutral-500">No pages recorded yet.</p>
                )}
              </div>
            </div>
          </section>
        )}

        <section className="border border-line bg-surface rounded-xl p-4 space-y-4">
          <h2 className="font-bold text-neon uppercase text-sm tracking-wider">Hero</h2>
          <div><span className={label}>Tagline</span>
            <textarea className={`${input} mt-1 h-20`} value={c.tagline ?? ""} onChange={(e) => set({ tagline: e.target.value })} /></div>
          <div><span className={label}>Hero pitch (optional — replaces the tagline when set)</span>
            <textarea className={`${input} mt-1 h-32`} value={c.heroPitch ?? ""} onChange={(e) => set({ heroPitch: e.target.value })} /></div>
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
                  className="text-red-400 font-bold px-2">Ã—</button>
              </div>
            </div>
          ))}
          {!(c.events ?? []).length && <p className="text-neutral-500 text-sm">No events â€” the front page shows "DATES TBA".</p>}
        </section>

        <section className="border border-line bg-surface rounded-xl p-4 space-y-4">
          <h2 className="font-bold text-neon uppercase text-sm tracking-wider">Hero slides (images)</h2>
          {(c.heroSlides ?? []).map((src, i) => (
            <div key={i} className="flex items-center gap-2">
              <img src={src} alt="" className="w-16 h-10 object-cover rounded" />
              <input className={`${input} flex-1`} value={src} onChange={(ev) => set({ heroSlides: (c.heroSlides ?? []).map((s, j) => (j === i ? ev.target.value : s)) })} />
              <button onClick={() => set({ heroSlides: (c.heroSlides ?? []).filter((_, j) => j !== i) })} className="text-red-400 font-bold px-2">×</button>
            </div>
          ))}
          <div className="flex gap-2">
            <input type="file" accept="image/*" className="text-xs" onChange={(ev) => { const f = ev.target.files?.[0]; if (f) uploadMedia(f, (url) => set({ heroSlides: [...(c.heroSlides ?? []), url] })); }} />
          </div>
          <h2 className="font-bold text-neon uppercase text-sm tracking-wider pt-2">Vault visuals</h2>
          {(c.visuals ?? []).map((v, i) => (
            <div key={i} className="flex items-center gap-2">
              <img src={v.src} alt="" className="w-16 h-10 object-cover rounded" />
              <input className={`${input} flex-1`} placeholder="URL" value={v.src} onChange={(ev) => set({ visuals: (c.visuals ?? []).map((x, j) => (j === i ? { ...x, src: ev.target.value } : x)) })} />
              <input className={`${input} w-48`} placeholder="Label" value={v.label} onChange={(ev) => set({ visuals: (c.visuals ?? []).map((x, j) => (j === i ? { ...x, label: ev.target.value } : x)) })} />
              <button onClick={() => set({ visuals: (c.visuals ?? []).filter((_, j) => j !== i) })} className="text-red-400 font-bold px-2">×</button>
            </div>
          ))}
          <div className="flex gap-2 items-center">
            <input type="file" accept="image/*" className="text-xs" onChange={(ev) => { const f = ev.target.files?.[0]; if (f) uploadMedia(f, (url) => set({ visuals: [...(c.visuals ?? []), { src: url, label: "NEW VISUAL" }] })); }} />
          </div>
          <div><span className={label}>Publish lineup at (scheduled drop, blank = live)</span>
            <input type="datetime-local" className={`${input} mt-1`} value={c.lineupPublishAt ?? ""} onChange={(e) => set({ lineupPublishAt: e.target.value })} /></div>
        </section>

        <section className="border border-line bg-surface rounded-xl p-4 space-y-3">
          <h2 className="font-bold text-neon uppercase text-sm tracking-wider">Room loop</h2>
          <p className="text-neutral-500 text-xs">
            Video looped in the front-page room box while nothing is live. MP4 or WebM,
            up to 120 MB. Leave it empty to show the standby slate.
          </p>
          {c.idleLoop ? (
            <div className="flex items-center gap-2">
              <video src={c.idleLoop} muted loop autoPlay playsInline className="w-32 aspect-video object-cover rounded" />
              <input className={`${input} flex-1 font-mono text-xs`} value={c.idleLoop}
                onChange={(ev) => set({ idleLoop: ev.target.value })} />
              <button onClick={() => set({ idleLoop: "" })} className="text-red-400 font-bold px-2">×</button>
            </div>
          ) : (
            <p className="text-neutral-500 text-sm">No loop — the standby slate shows instead.</p>
          )}
          <input type="file" accept="video/mp4,video/webm,video/quicktime" className="text-xs"
            onChange={(ev) => { const f = ev.target.files?.[0]; if (f) uploadMedia(f, (url) => set({ idleLoop: url })); }} />
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
