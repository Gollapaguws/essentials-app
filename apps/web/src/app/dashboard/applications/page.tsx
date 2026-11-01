"use client";

import { useEffect, useState } from "react";
import { TopNav } from "@/components/TopNav";
import { api } from "@essentials/api-client";

interface Application {
  id: string; slot?: string | null; status: string; appliedAt?: string;
  artist: { stageName: string; user: { name: string | null; email: string } };
  event: { title: string; date: string };
}

/** Promoter: review DJ applications — confirm or decline. */
export default function Applications() {
  const [apps, setApps] = useState<Application[]>([]);
  const [msg, setMsg] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = () => api.get<Application[]>("/artists/applications").then(setApps).catch((e) => setError(e.message));
  useEffect(() => { load(); }, []);

  const decide = async (id: string, confirm: boolean) => {
    setError(null);
    try {
      await api.post(`/artists/applications/${id}/decide`, { confirm });
      load();
    } catch (err: any) { setError(err.message); }
  };

  return (
    <>
      <TopNav />
      <main className="max-w-4xl mx-auto px-6 py-8 space-y-6">
        <h1 className="text-2xl font-black tracking-wide">DJ APPLICATIONS</h1>
        {msg && <p className="text-neon text-sm">{msg}</p>}
        {error && <p className="text-red-400 text-sm">{error}</p>}
        <div className="border border-line rounded-xl">
          {apps.map((a) => (
            <div key={a.id} className="border-t border-line px-4 py-3 text-sm flex flex-wrap justify-between gap-2">
              <div>
                <p className="font-bold">{a.artist.stageName} <span className="text-neutral-500 font-normal">· {a.slot ?? "slot TBA"}</span></p>
                <p className="text-neutral-500 text-xs">{a.event.title} · {new Date(a.event.date).toLocaleDateString()} · {a.artist.user.email}</p>
              </div>
              <div className="flex items-center gap-3">
                <span className={a.status === "confirmed" ? "text-neon" : a.status === "pending" ? "text-yellow-400" : "text-neutral-500"}>{a.status}</span>
                {a.status === "pending" && (
                  <>
                    <button onClick={() => decide(a.id, true)} className="bg-neon text-bg font-black rounded-lg px-3 py-1 text-xs tracking-widest">CONFIRM</button>
                    <button onClick={() => decide(a.id, false)} className="border border-red-500 text-red-400 rounded-lg px-3 py-1 text-xs font-bold">DECLINE</button>
                  </>
                )}
              </div>
            </div>
          ))}
          {!apps.length && <p className="px-4 py-6 text-center text-neutral-500 text-sm">No applications yet.</p>}
        </div>
      </main>
    </>
  );
}
