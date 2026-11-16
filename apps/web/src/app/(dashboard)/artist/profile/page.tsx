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
  homeAddress: string | null;
  homeLat: number | null;
  homeLng: number | null;
  travelRatePerKm: number;
  bankAccountHolder: string | null;
  bankName: string | null;
  bankAccountNumber: string | null;
  bankBranchCode: string | null;
  bankAccountType: string | null;
}

interface ProfileForm {
  stageName: string;
  bio: string;
  imageUrl: string;
  vehicleConsumptionLPer100km: number;
  homeAddress: string;
  homeLat: number | null;
  homeLng: number | null;
  travelRatePerKm: number;
  bankAccountHolder: string;
  bankName: string;
  bankAccountNumber: string;
  bankBranchCode: string;
  bankAccountType: string;
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
  const [form, setForm] = useState<ProfileForm>({
    stageName: "",
    bio: "",
    imageUrl: "",
    vehicleConsumptionLPer100km: 8,
    homeAddress: "",
    homeLat: null,
    homeLng: null,
    // Displayed only: the travel rate is the admin-set platform standard.
    travelRatePerKm: 4.95,
    bankAccountHolder: "",
    bankName: "",
    bankAccountNumber: "",
    bankBranchCode: "",
    bankAccountType: "",
  });
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const [locating, setLocating] = useState(false);
  const [geoError, setGeoError] = useState<string | null>(null);

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
        if (p) {
          setForm({
            stageName: p.stageName,
            bio: p.bio ?? "",
            imageUrl: p.imageUrl ?? "",
            vehicleConsumptionLPer100km: p.vehicleConsumptionLPer100km,
            homeAddress: p.homeAddress ?? "",
            homeLat: p.homeLat,
            homeLng: p.homeLng,
            travelRatePerKm: p.travelRatePerKm,
            bankAccountHolder: p.bankAccountHolder ?? "",
            bankName: p.bankName ?? "",
            bankAccountNumber: p.bankAccountNumber ?? "",
            bankBranchCode: p.bankBranchCode ?? "",
            bankAccountType: p.bankAccountType ?? "",
          });
        }
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
    if ((form.homeLat != null || form.homeLng != null) && !form.homeAddress.trim()) {
      setError("Add your home address before using your current location.");
      return;
    }
    try {
      const body = {
        stageName: form.stageName.trim(),
        bio: form.bio,
        imageUrl: form.imageUrl.trim(),
        vehicleConsumptionLPer100km: form.vehicleConsumptionLPer100km,
        homeAddress: form.homeAddress.trim(),
        ...(form.homeLat != null && form.homeLng != null
          ? { homeLat: form.homeLat, homeLng: form.homeLng }
          : {}),
        bankAccountHolder: form.bankAccountHolder.trim(),
        bankName: form.bankName.trim(),
        bankAccountNumber: form.bankAccountNumber.trim(),
        bankBranchCode: form.bankBranchCode.trim(),
        bankAccountType: form.bankAccountType.trim(),
      };
      await api.post<Profile>("/artists/me", body);
      setSaved("Profile saved.");
      load();
    } catch (err) {
      setError(errorMessage(err));
    }
  };

  /** Name the spot we just read, so USE MY LOCATION alone fills the home base. */
  const describeCoords = async (lat: number, lng: number) => {
    const url = new URL("https://nominatim.openstreetmap.org/reverse");
    url.searchParams.set("format", "jsonv2");
    url.searchParams.set("lat", String(lat));
    url.searchParams.set("lon", String(lng));
    url.searchParams.set("zoom", "18");
    url.searchParams.set("addressdetails", "1");
    const res = await fetch(url, { headers: { Accept: "application/json" } });
    if (!res.ok) return null;
    const data = (await res.json()) as {
      display_name?: string;
      address?: Record<string, string>;
    };
    const a = data.address ?? {};
    const parts = [
      [a.house_number, a.road].filter(Boolean).join(" "),
      a.suburb || a.neighbourhood || a.city_district,
      a.city || a.town || a.village || a.municipality,
      a.postcode,
    ].filter((part) => Boolean(part && part.trim()));
    return parts.length >= 2 ? parts.join(", ") : data.display_name?.trim() || null;
  };

  const useMyLocation = () => {
    setError(null);
    setGeoError(null);
    if (!navigator.geolocation) {
      setGeoError("This browser cannot read your location. Enter the address instead.");
      return;
    }
    setLocating(true);
    navigator.geolocation.getCurrentPosition(
      async (pos) => {
        const { latitude, longitude } = pos.coords;
        setForm((f) => ({ ...f, homeLat: latitude, homeLng: longitude }));
        if (form.homeAddress.trim()) {
          setLocating(false);
          return;
        }
        // Keep the coordinates even if the lookup fails: a typed address saves
        // the point, and the DJ can press the button again after fixing it.
        try {
          const address = await describeCoords(latitude, longitude);
          if (address) {
            setForm((f) => ({ ...f, homeAddress: address, homeLat: latitude, homeLng: longitude }));
          } else {
            setGeoError("Location captured, but we could not name the address. Type it, then press USE MY LOCATION again.");
          }
        } catch {
          setGeoError("Location captured, but we could not name the address. Type it, then press USE MY LOCATION again.");
        } finally {
          setLocating(false);
        }
      },
      (err) => {
        setGeoError(
          err.code === err.PERMISSION_DENIED
            ? "Location permission was refused. Allow it in your browser, or check the address on the map instead."
            : "Could not read your location. Check the address on the map instead.",
        );
        setLocating(false);
      },
      { enableHighAccuracy: true, timeout: 10_000 },
    );
  };

  const confirmed = gigs.filter((g) => g.status === "confirmed").length;
  const owed = invoices.reduce((sum, i) => sum + i.total, 0);
  const bio = form.bio;
  const bankComplete = Boolean(
    form.bankAccountHolder.trim() &&
      form.bankName.trim() &&
      form.bankAccountNumber.trim() &&
      form.bankBranchCode.trim(),
  );

  return (
    <>
      <TopNav />
      <main className="max-w-5xl mx-auto px-6 py-8 space-y-8">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <h1 className="text-2xl font-black tracking-wide">MY PROFILE</h1>
            <p className="text-neutral-500 text-xs mt-1">
              What promoters and venues see, plus the travel costs and bank account your invoices use.
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

            <div className="border-t border-line pt-4 space-y-3">
              <div>
                <p className="text-xs font-bold tracking-widest text-neutral-400 uppercase">Bank account</p>
                <p className="text-[11px] text-neutral-600 mt-1">
                  Printed automatically on every invoice so the venue can pay you. Promoters never see these details.
                </p>
              </div>
              <div className="grid sm:grid-cols-2 gap-4">
                <div className="sm:col-span-2">
                  <label className={label} htmlFor="bankAccountHolder">Account holder</label>
                  <input
                    id="bankAccountHolder"
                    maxLength={120}
                    className={`${field} mt-1`}
                    placeholder="Name on the bank account"
                    value={form.bankAccountHolder}
                    onChange={(e) => setForm({ ...form, bankAccountHolder: e.target.value })}
                  />
                </div>
                <div>
                  <label className={label} htmlFor="bankName">Bank</label>
                  <input
                    id="bankName"
                    maxLength={120}
                    className={`${field} mt-1`}
                    placeholder="Bank name"
                    value={form.bankName}
                    onChange={(e) => setForm({ ...form, bankName: e.target.value })}
                  />
                </div>
                <div>
                  <label className={label} htmlFor="bankAccountType">Account type</label>
                  <input
                    id="bankAccountType"
                    maxLength={40}
                    className={`${field} mt-1`}
                    placeholder="Cheque, savings…"
                    value={form.bankAccountType}
                    onChange={(e) => setForm({ ...form, bankAccountType: e.target.value })}
                  />
                </div>
                <div>
                  <label className={label} htmlFor="bankAccountNumber">Account number</label>
                  <input
                    id="bankAccountNumber"
                    maxLength={34}
                    inputMode="numeric"
                    autoComplete="off"
                    className={`${field} mt-1 font-mono`}
                    placeholder="Account number"
                    value={form.bankAccountNumber}
                    onChange={(e) => setForm({ ...form, bankAccountNumber: e.target.value })}
                  />
                </div>
                <div>
                  <label className={label} htmlFor="bankBranchCode">Branch code</label>
                  <input
                    id="bankBranchCode"
                    maxLength={20}
                    inputMode="numeric"
                    autoComplete="off"
                    className={`${field} mt-1 font-mono`}
                    placeholder="Branch code"
                    value={form.bankBranchCode}
                    onChange={(e) => setForm({ ...form, bankBranchCode: e.target.value })}
                  />
                </div>
              </div>
              <p className={`text-[11px] ${bankComplete ? "text-neutral-600" : "text-yellow-400"}`}>
                {bankComplete
                  ? "Your bank account is ready for invoices."
                  : "Account holder, bank, account number and branch code are needed before you can invoice a venue."}
              </p>
            </div>

            <div className="border-t border-line pt-4 space-y-3">
              <div>
                <p className="text-xs font-bold tracking-widest text-neutral-400 uppercase">Home base</p>
                <p className="text-[11px] text-neutral-600 mt-1">
                  The address invoices calculate return travel from. It is private and never shown to promoters.
                </p>
              </div>
              <div>
                <label className={label} htmlFor="homeAddress">Home address</label>
                <div className="flex gap-2 mt-1">
                  <input
                    id="homeAddress"
                    maxLength={240}
                    className={field}
                    placeholder="Street, suburb, city"
                    value={form.homeAddress}
                    onChange={(e) => {
                      setGeoError(null);
                      setForm({ ...form, homeAddress: e.target.value, homeLat: null, homeLng: null });
                    }}
                  />
                  <button
                    type="button"
                    onClick={useMyLocation}
                    disabled={locating}
                    className="shrink-0 border border-line rounded-lg px-3 text-[10px] font-bold tracking-widest hover:border-neon hover:text-neon disabled:opacity-40"
                  >
                    {locating ? "LOCATING…" : "USE MY LOCATION"}
                  </button>
                </div>
                {geoError && <p className="text-[11px] text-red-400 mt-1">{geoError}</p>}
                <p className="text-[11px] text-neutral-600 mt-1">
                  {form.homeAddress.trim()
                    ? form.homeLat != null && form.homeLng != null
                      ? "Location set. Invoice travel is calculated from here."
                      : "We will look up this address when you save."
                    : "Needed before you can invoice a venue."}{" "}
                  <a
                    href="https://www.openstreetmap.org/copyright"
                    target="_blank"
                    rel="noopener noreferrer"
                    className="underline underline-offset-2 hover:text-neutral-400"
                  >
                    Address search © OpenStreetMap contributors
                  </a>
                </p>
              </div>
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
              <p className="flex justify-between">
                <span className="text-neutral-500">Bank details</span>
                <span className={bankComplete ? "text-neon" : "text-yellow-400"}>
                  {bankComplete ? "ready" : "missing"}
                </span>
              </p>
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
