"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { TopNav } from "@/components/TopNav";
import { api } from "@essentials/api-client";
import { errorMessage } from "@/lib/errors";

interface Profile {
  stageName: string;
  bio: string | null;
  imageUrl: string | null;
  vehicleConsumptionLPer100km: number;
  travelRatePerKm: number;
}

interface Gig { id: string; status: string; performanceFee: number }
interface Invoice { id: string; status: string; total: number }

const BIO_MAX = 2000;
const field = "w-full bg-bg border border-line rounded-lg px-3 py-2 text-sm outline-none focus:border-neon";
const label = "text-xs font-bold tracking-widest text-neutral-400 uppercase";

/** DJ profile, detailed: the public-facing card plus the travel costs routing invoices use. */
export default function ArtistProfilePage() {
  const [profile, setProfile] = useState<Profile | null>(null);
  const [gigs, setGigs] = useState<Gig[]>([]);
  const [invoices, setInvoices] = useState<Invoice[]>([]);
  const [form, setForm] = useState<Profile>({
    stageName: "",
    bio: "",
    imageUrl: "",
    vehicleConsumptionLPer100km: 8,
    // Displayed only: the travel rate is the admin-set platform standard.
    travelRatePerKm: 4.95,
  });
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);

  const uploadPhoto = async (file: File) => {
    setError(null);
    setSaved(null);
    if (!file.type.startsWith("image/")) {
      setError("Choose an image file (JPG, PNG, WebP or AVIF).");
      return;
    }
    if (file.size > 5 * 1024 * 1024) {
      setError("Photos must be 5 MB or smaller.");
      return;
    }
    setUploading(true);
    try {
      const { url } = await api.upload<{ ok: boolean; url: string }>("/artists/me/image", file);
      setForm((f) => ({ ...f, imageUrl: url }));
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setUploading(false);
    }
  };

  const load = () => {
    api
      .get<Profile | null>("/artists/me")
      .then((p) => {
        setProfile(p);
        if (p) setForm({ ...p, bio: p.bio ?? "", imageUrl: p.imageUrl ?? "" });
      })
      .catch((e) => setError(errorMessage(e)));
    api.get<Gig[]>("/artists/gigs").then(setGigs).catch(() => {});
    api.get<Invoice[]>("/invoices").then(setInvoices).catch(() => {});
  };
  useEffect(() => {
    load();
  }, []);

  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setSaved(null);
    if (!form.stageName.trim()) {
      setError("A stage name is required.");
      return;
    }
    try {
      const body = {
        stageName: form.stageName.trim(),
        bio: form.bio ?? "",
        imageUrl: (form.imageUrl ?? "").trim(),
        vehicleConsumptionLPer100km: form.vehicleConsumptionLPer100km,
      };
      await api.post<Profile>("/artists/me", body);
      setSaved("Profile saved.");
      load();
    } catch (err) {
      setError(errorMessage(err));
    }
  };

  const confirmed = gigs.filter((g) => g.status === "confirmed").length;
  const owed = invoices.reduce((sum, i) => sum + i.total, 0);
  const bio = form.bio ?? "";

  return (
    <>
      <TopNav />
      <main className="max-w-5xl mx-auto px-6 py-8 space-y-8">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <h1 className="text-2xl font-black tracking-wide">MY PROFILE</h1>
            <p className="text-neutral-500 text-xs mt-1">
              What promoters and venues see, plus the travel costs your invoices are built from.
            </p>
          </div>
          <Link href="/artist" className="text-xs tracking-widest text-neutral-400 hover:text-neon">
            ← ARTIST PORTAL
          </Link>
        </div>

        {error && <p className="text-red-400 text-sm">{error}</p>}
        {saved && <p className="text-neon text-sm">{saved}</p>}

        <div className="grid md:grid-cols-3 gap-6 items-start">
          <form onSubmit={save} className="md:col-span-2 bg-surface border border-line rounded-xl p-5 space-y-4">
            <div>
              <label className={label} htmlFor="stageName">Stage name</label>
              <input
                id="stageName"
                required
                maxLength={80}
                className={`${field} mt-1`}
                placeholder="Nandi B"
                value={form.stageName}
                onChange={(e) => setForm({ ...form, stageName: e.target.value })}
              />
            </div>

            <div>
              <span className={label}>Profile photo</span>
              <div className="mt-1 flex gap-3 items-center">
                <div className="w-16 h-16 shrink-0 rounded-lg border border-line overflow-hidden bg-bg grid place-items-center">
                  {form.imageUrl ? (
                    <img src={form.imageUrl} alt={form.stageName || "DJ"} className="w-full h-full object-cover" />
                  ) : (
                    <span className="text-[10px] text-neutral-600 text-center leading-tight">NO IMAGE</span>
                  )}
                </div>
                <div className="flex flex-col items-start gap-1.5">
                  <label className={`border border-line rounded-lg px-3 py-2 text-xs font-bold tracking-widest cursor-pointer hover:border-neon hover:text-neon ${uploading ? "opacity-50 pointer-events-none" : ""}`}>
                    {uploading ? "UPLOADING…" : form.imageUrl ? "CHANGE PHOTO" : "UPLOAD PHOTO"}
                    <input
                      type="file"
                      accept="image/jpeg,image/png,image/webp,image/avif"
                      className="hidden"
                      disabled={uploading}
                      onChange={(e) => {
                        const file = e.target.files?.[0];
                        if (file) void uploadPhoto(file);
                        e.target.value = "";
                      }}
                    />
                  </label>
                  {form.imageUrl && !uploading && (
                    <button
                      type="button"
                      onClick={() => setForm({ ...form, imageUrl: "" })}
                      className="text-[11px] text-neutral-500 hover:text-red-400"
                    >
                      Remove photo
                    </button>
                  )}
                </div>
              </div>
              <p className="text-[11px] text-neutral-600 mt-1">
                Square photo, up to 5 MB. Saved with the rest of your profile.
              </p>
            </div>

            <div>
              <div className="flex items-end justify-between">
                <label className={label} htmlFor="bio">Bio</label>
                <span className={`text-[11px] ${bio.length > BIO_MAX ? "text-red-400" : "text-neutral-600"}`}>
                  {bio.length}/{BIO_MAX}
                </span>
              </div>
              <textarea
                id="bio"
                rows={7}
                maxLength={BIO_MAX}
                className={`${field} mt-1 leading-relaxed`}
                placeholder="What you play, where you've played, what you bring to a room."
                value={bio}
                onChange={(e) => setForm({ ...form, bio: e.target.value })}
              />
              <p className="text-[11px] text-neutral-600 mt-1">
                Plain text. Leave it empty to hide the bio from your profile.
              </p>
            </div>

            <div className="grid sm:grid-cols-2 gap-4">
              <div>
                <label className={label} htmlFor="consumption">Vehicle L/100km</label>
                <input
                  id="consumption"
                  type="number"
                  step="0.1"
                  min={1}
                  className={`${field} mt-1`}
                  value={form.vehicleConsumptionLPer100km}
                  onChange={(e) => setForm({ ...form, vehicleConsumptionLPer100km: +e.target.value })}
                />
              </div>
              <div>
                <label className={label} htmlFor="rate">Travel rate /km</label>
                <input
                  id="rate"
                  type="number"
                  disabled
                  className={`${field} mt-1 opacity-60`}
                  value={profile?.travelRatePerKm ?? form.travelRatePerKm}
                  readOnly
                />
                <p className="text-[11px] text-neutral-500 mt-1">Standard rate set by ESSENTIALS — not editable.</p>
              </div>
            </div>

            <button className="bg-neon text-bg font-black rounded-lg px-4 py-2 text-sm tracking-widest">
              SAVE PROFILE
            </button>
          </form>

          <div className="space-y-4">
            <section className="bg-surface border border-line rounded-xl p-5">
              <p className="text-[11px] font-bold tracking-widest text-neutral-500 uppercase mb-3">Preview</p>
              {form.imageUrl ? (
                <img
                  src={form.imageUrl}
                  alt={form.stageName || "DJ"}
                  className="w-full aspect-square object-cover rounded-lg border border-line mb-3"
                />
              ) : (
                <div className="w-full aspect-square rounded-lg border border-dashed border-line grid place-items-center text-neutral-600 text-xs mb-3">
                  No image yet
                </div>
              )}
              <p className="text-lg font-black text-neon">{form.stageName.trim() || "Your stage name"}</p>
              <p className="text-sm text-neutral-300 mt-2 whitespace-pre-wrap">
                {bio.trim() || "No bio yet — promoters only see your stage name."}
              </p>
            </section>

            <section className="bg-surface border border-line rounded-xl p-5 space-y-2 text-sm">
              <p className="text-[11px] font-bold tracking-widest text-neutral-500 uppercase">Activity</p>
              <p className="flex justify-between"><span className="text-neutral-500">Gigs</span><span>{gigs.length}</span></p>
              <p className="flex justify-between"><span className="text-neutral-500">Confirmed</span><span className="text-neon">{confirmed}</span></p>
              <p className="flex justify-between"><span className="text-neutral-500">Invoiced</span><span>R{owed.toLocaleString()}</span></p>
              {profile && (
                <p className="flex justify-between">
                  <span className="text-neutral-500">Profile</span>
                  <span className={profile.bio && profile.imageUrl ? "text-neon" : "text-yellow-400"}>
                    {!profile.bio ? "bio missing" : !profile.imageUrl ? "image missing" : "complete"}
                  </span>
                </p>
              )}
            </section>
          </div>
        </div>
      </main>
    </>
  );
}
