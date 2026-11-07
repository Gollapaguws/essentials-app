"use client";

import { useCallback, useEffect, useState } from "react";
import { TopNav } from "@/components/TopNav";
import { useAuth } from "@/components/AuthProvider";
import { api } from "@essentials/api-client";
import { errorMessage } from "@/lib/errors";

interface TravelRate {
  travelRatePerKm: number;
  artists: number;
  mixed: boolean;
}

const field = "bg-bg border border-line rounded-lg px-3 py-2 text-sm outline-none focus:border-neon";

/** Admin: the platform rates every DJ and invoice is priced from. */
export default function Settings() {
  const { me } = useAuth();
  const isAdmin = me?.user.role === "admin";

  const [rate, setRate] = useState<TravelRate | null>(null);
  const [draft, setDraft] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const load = useCallback(async () => {
    setError(null);
    try {
      const current = await api.get<TravelRate>("/artists/travel-rate");
      setRate(current);
      setDraft(String(current.travelRatePerKm));
    } catch (e) {
      setError(errorMessage(e) ?? "Could not load the travel rate.");
    }
  }, []);

  useEffect(() => {
    if (isAdmin) void load();
  }, [isAdmin, load]);

  const value = Number(draft);
  const changed = rate !== null && value !== rate.travelRatePerKm;
  const valid = Number.isFinite(value) && value > 0 && changed;

  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!valid) return;
    setSaving(true);
    setError(null);
    setNotice(null);
    try {
      const saved = await api.patch<TravelRate>("/artists/travel-rate", { travelRatePerKm: value });
      setRate(saved);
      setDraft(String(saved.travelRatePerKm));
      setNotice(
        saved.artists
          ? `Every DJ now travels at R${saved.travelRatePerKm.toFixed(2)}/km — ${saved.artists} profile${saved.artists === 1 ? "" : "s"} updated.`
          : `Standard rate set to R${saved.travelRatePerKm.toFixed(2)}/km. It applies to the next DJ profile created.`,
      );
    } catch (err) {
      setError(errorMessage(err) ?? "Could not save the travel rate.");
    } finally {
      setSaving(false);
    }
  };

  if (me && !isAdmin) {
    return (
      <>
        <TopNav />
        <main className="max-w-4xl mx-auto px-6 py-10">
          <p className="text-neutral-400 text-sm">Only admins can change platform settings.</p>
        </main>
      </>
    );
  }

  return (
    <>
      <TopNav />
      <main className="max-w-4xl mx-auto px-6 py-8 space-y-6">
        <div>
          <h1 className="text-2xl font-black tracking-wide">PLATFORM SETTINGS</h1>
          <p className="text-neutral-500 text-xs mt-1">
            Rates that apply to every DJ on the platform — nobody else can change them.
          </p>
        </div>

        {notice && <p className="text-neon text-sm">{notice}</p>}
        {error && <p className="text-red-400 text-sm">{error}</p>}

        <section className="border border-line rounded-xl p-5 space-y-5">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <h2 className="text-sm font-bold text-neon uppercase tracking-wider">Standard travel rate</h2>
              <p className="text-neutral-500 text-xs mt-1 max-w-xl">
                Charged per kilometre of travel on a DJ&apos;s route plan and on invoices for billable
                travel. It is not editable by a DJ or a promoter — this is the only place it changes.
              </p>
            </div>
            <div className="text-right">
              <p className="text-2xl font-black tracking-wide">
                R{(rate?.travelRatePerKm ?? (Number.isFinite(value) ? value : 4.95)).toFixed(2)}
                <span className="text-neutral-500 text-sm font-normal"> /km</span>
              </p>
              <p className="text-neutral-600 text-[11px] mt-0.5">
                {rate ? `${rate.artists} DJ profile${rate.artists === 1 ? "" : "s"} on this rate` : "loading…"}
              </p>
            </div>
          </div>

          {rate?.mixed && (
            <p className="text-yellow-400/90 text-xs border border-yellow-500/40 rounded-lg px-3 py-2">
              Some DJs are still on a different rate. Saving a new rate here sets it on every profile.
            </p>
          )}

          <form onSubmit={save} className="flex flex-wrap items-end gap-3">
            <label className="text-xs text-neutral-400">
              Rand per kilometre
              <input
                type="number"
                step="0.01"
                min={0.01}
                required
                className={`${field} mt-1 w-40`}
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
              />
            </label>
            <button
              disabled={!valid || saving}
              className="bg-neon text-bg font-black rounded-lg px-4 py-2 text-xs tracking-widest disabled:opacity-40"
            >
              {saving ? "SAVING…" : "SAVE RATE"}
            </button>
            <p className="text-neutral-600 text-[11px] pb-2">
              Changing it reprices future travel on every DJ&apos;s route plan. Invoices already sent
              keep the amount they were billed at.
            </p>
          </form>
        </section>
      </main>
    </>
  );
}
