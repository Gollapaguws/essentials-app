"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { API_URL, api } from "@essentials/api-client";
import { errorMessage } from "@/lib/errors";
import { useResource } from "@/hooks/useResource";

interface DoorProfile {
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

interface OpenGig {
  id: string;
  title: string;
  date: string;
  doorFee: number;
  venue: { name: string; address: string | null };
  _count: { doorBookings: number };
}

interface DoorInvoiceRef {
  id: string;
  number: string;
  status: string;
  total: number;
}

interface MyShift {
  id: string;
  status: string;
  appliedAt: string | null;
  completedAt: string | null;
  declineReason: string | null;
  fee: number;
  travelFee: number;
  amount: number;
  event: { id: string; title: string; date: string; venue: { name: string } };
  invoice: DoorInvoiceRef | null;
}

const field = "bg-bg border border-line rounded-lg px-3 py-2 text-sm outline-none focus:border-neon";

const STATUS: Record<string, string> = {
  pending: "text-yellow-400",
  confirmed: "text-neon",
  completed: "text-neon",
  cancelled: "text-neutral-500",
};

/**
 * Door host console: the profile the invoice and travel need, nights open to
 * apply for, and the shift/invoice history. Rendered inside the Door page.
 */
export function DoorGigs() {
  const profileSource = useResource<DoorProfile | null>("/door-gigs/profile");
  const openSource = useResource<OpenGig[]>("/door-gigs/open");
  const mineSource = useResource<MyShift[]>("/door-gigs/mine");
  const open = openSource.data ?? [];
  const shifts = mineSource.data ?? [];

  const [form, setForm] = useState({
    homeAddress: "",
    homeLat: null as number | null,
    homeLng: null as number | null,
    bankAccountHolder: "",
    bankName: "",
    bankAccountNumber: "",
    bankBranchCode: "",
    bankAccountType: "",
  });
  const [busy, setBusy] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [locating, setLocating] = useState(false);
  const [geoError, setGeoError] = useState<string | null>(null);

  useEffect(() => {
    const p = profileSource.data;
    if (!p) return;
    setForm({
      homeAddress: p.homeAddress ?? "",
      homeLat: p.homeLat,
      homeLng: p.homeLng,
      bankAccountHolder: p.bankAccountHolder ?? "",
      bankName: p.bankName ?? "",
      bankAccountNumber: p.bankAccountNumber ?? "",
      bankBranchCode: p.bankBranchCode ?? "",
      bankAccountType: p.bankAccountType ?? "",
    });
  }, [profileSource.data]);

  const saveProfile = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setNotice(null);
    if ((form.homeLat != null || form.homeLng != null) && !form.homeAddress.trim()) {
      setError("Add your address before using your current location.");
      return;
    }
    setBusy("profile");
    try {
      const saved = await api.post<DoorProfile>("/door-gigs/profile", {
        homeAddress: form.homeAddress.trim(),
        ...(form.homeLat != null && form.homeLng != null
          ? { homeLat: form.homeLat, homeLng: form.homeLng }
          : {}),
        bankAccountHolder: form.bankAccountHolder.trim(),
        bankName: form.bankName.trim(),
        bankAccountNumber: form.bankAccountNumber.trim(),
        bankBranchCode: form.bankBranchCode.trim(),
        bankAccountType: form.bankAccountType.trim(),
      });
      profileSource.setData(saved);
      setNotice("Door profile saved.");
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(null);
    }
  };

  /** Name the spot we just read, so USE MY LOCATION alone fills the address. */
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
            ? "Location permission was refused. Allow it in your browser, or type the address."
            : "Could not read your location. Type the address instead.",
        );
        setLocating(false);
      },
      { enableHighAccuracy: true, timeout: 10_000 },
    );
  };

  const apply = async (eventId: string) => {
    setBusy(eventId);
    setError(null);
    setNotice(null);
    try {
      await api.post("/door-gigs/apply", { eventId });
      setNotice("Application sent — the promoter will confirm you.");
      openSource.reload();
      mineSource.reload();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(null);
    }
  };

  const withdraw = async (id: string) => {
    setBusy(id);
    setError(null);
    setNotice(null);
    try {
      await api.post(`/door-gigs/bookings/${id}/withdraw`);
      mineSource.reload();
      openSource.reload();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(null);
    }
  };

  const invoice = async (shift: MyShift) => {
    setBusy(shift.id);
    setError(null);
    setNotice(null);
    try {
      const inv = await api.post<{ number: string }>("/door-gigs/invoices/generate", {
        bookingId: shift.id,
      });
      setNotice(`Invoice ${inv.number} raised for ${shift.event.venue.name}.`);
      mineSource.reload();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(null);
    }
  };

  const bankComplete = Boolean(
    form.bankAccountHolder.trim() &&
      form.bankName.trim() &&
      form.bankAccountNumber.trim() &&
      form.bankBranchCode.trim(),
  );
  const hasHomeBase = Boolean(profileSource.data?.homeAddress && profileSource.data?.homeLat != null);

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-end justify-between gap-2">
        <div>
          <h2 className="text-lg font-black tracking-widest">DOOR GIGS</h2>
          <p className="text-neutral-500 text-xs mt-1">
            Apply for nights with a door fee. After the promoter confirms the shift was worked, invoice
            the venue for the fee plus travel.
          </p>
        </div>
        <Link href="/statements" className="text-neon text-xs underline">
          Statements →
        </Link>
      </div>

      {notice && <p className="text-neon text-sm">{notice}</p>}
      {(error ?? openSource.error ?? mineSource.error) && (
        <p role="alert" className="text-red-400 text-sm">
          {error ?? openSource.error ?? mineSource.error}
        </p>
      )}

      <section className="border border-line rounded-xl p-4 space-y-3">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h3 className="text-sm font-bold uppercase tracking-wider">Door profile</h3>
          <span className="text-[10px] uppercase tracking-widest text-neutral-500">
            {hasHomeBase && bankComplete ? "ready to invoice" : "needed before you can invoice"}
          </span>
        </div>
        <form onSubmit={saveProfile} className="space-y-3">
          <div className="space-y-1">
            <span className="text-xs text-neutral-400">Home address (travel is calculated from here)</span>
            <div className="flex flex-wrap gap-2">
              <input
                className={`${field} flex-1 min-w-48`}
                placeholder="Street, suburb, city"
                value={form.homeAddress}
                onChange={(e) =>
                  setForm({ ...form, homeAddress: e.target.value, homeLat: null, homeLng: null })
                }
              />
              <button
                type="button"
                onClick={useMyLocation}
                disabled={locating}
                className="border border-line rounded-lg px-3 py-2 text-[10px] font-bold tracking-widest text-neutral-300 disabled:opacity-40"
              >
                {locating ? "LOCATING…" : "USE MY LOCATION"}
              </button>
            </div>
            {form.homeLat != null && form.homeLng != null && (
              <p className="text-[10px] text-neon">
                Location captured — travel from this point is used on the invoice.
              </p>
            )}
            {geoError && <p className="text-[10px] text-yellow-400">{geoError}</p>}
          </div>

          <div className="grid gap-2 md:grid-cols-2">
            <label className="text-xs text-neutral-400 space-y-1">
              <span>Account holder</span>
              <input
                className={`${field} w-full`}
                value={form.bankAccountHolder}
                onChange={(e) => setForm({ ...form, bankAccountHolder: e.target.value })}
              />
            </label>
            <label className="text-xs text-neutral-400 space-y-1">
              <span>Bank</span>
              <input
                className={`${field} w-full`}
                value={form.bankName}
                onChange={(e) => setForm({ ...form, bankName: e.target.value })}
              />
            </label>
            <label className="text-xs text-neutral-400 space-y-1">
              <span>Account number</span>
              <input
                className={`${field} w-full`}
                value={form.bankAccountNumber}
                onChange={(e) => setForm({ ...form, bankAccountNumber: e.target.value })}
              />
            </label>
            <label className="text-xs text-neutral-400 space-y-1">
              <span>Branch code</span>
              <input
                className={`${field} w-full`}
                value={form.bankBranchCode}
                onChange={(e) => setForm({ ...form, bankBranchCode: e.target.value })}
              />
            </label>
            <label className="text-xs text-neutral-400 space-y-1 md:col-span-2">
              <span>Account type (optional)</span>
              <input
                className={`${field} w-full`}
                value={form.bankAccountType}
                onChange={(e) => setForm({ ...form, bankAccountType: e.target.value })}
              />
            </label>
          </div>

          <p className="text-[11px] text-neutral-600">
            Travel is paid at R{(profileSource.data?.travelRatePerKm ?? 4.95).toFixed(2)}/km, return
            from this address to the venue. Bank details only appear on your invoices.
          </p>
          <button
            disabled={busy === "profile"}
            className="bg-neon text-bg font-black rounded-lg px-4 py-2 text-xs tracking-widest disabled:opacity-50"
          >
            {busy === "profile" ? "SAVING…" : "SAVE DOOR PROFILE"}
          </button>
        </form>
      </section>

      <section className="space-y-2">
        <h3 className="text-sm font-bold uppercase tracking-wider">Open door shifts</h3>
        {!open.length && (
          <p className="text-neutral-500 text-sm">
            No open shifts right now. Approved nights with a door fee appear here.
          </p>
        )}
        {open.map((event) => (
          <div
            key={event.id}
            className="border border-line rounded-xl px-4 py-3 flex flex-wrap items-center justify-between gap-2"
          >
            <div>
              <p className="font-bold">{event.title}</p>
              <p className="text-neutral-500 text-xs">
                {event.venue.name} · {new Date(event.date).toLocaleDateString()} · R
                {event.doorFee.toLocaleString()} door fee
              </p>
            </div>
            <button
              onClick={() => apply(event.id)}
              disabled={busy === event.id}
              className="bg-neon text-bg font-black rounded-lg px-4 py-2 text-xs tracking-widest disabled:opacity-40"
            >
              {busy === event.id ? "SENDING…" : "APPLY"}
            </button>
          </div>
        ))}
      </section>

      <section className="space-y-2">
        <h3 className="text-sm font-bold uppercase tracking-wider">My door shifts</h3>
        {!shifts.length && (
          <p className="text-neutral-500 text-sm">
            No door shifts yet. Apply for one above; it appears here once you have.
          </p>
        )}
        {shifts.map((shift) => (
          <div key={shift.id} className="border border-line rounded-xl px-4 py-3 space-y-2">
            <div className="flex flex-wrap items-start justify-between gap-2">
              <div>
                <p className="font-bold">{shift.event.title}</p>
                <p className="text-neutral-500 text-xs">
                  {shift.event.venue.name} · {new Date(shift.event.date).toLocaleDateString()}
                </p>
              </div>
              <div className="text-right">
                <span className={`text-xs font-bold uppercase tracking-widest ${STATUS[shift.status] ?? "text-neutral-400"}`}>
                  {shift.status}
                </span>
                <p className="text-xs text-neutral-400">
                  R{shift.fee.toLocaleString()} fee
                  {shift.travelFee > 0 ? ` + R${shift.travelFee.toLocaleString()} travel` : ""}
                </p>
              </div>
            </div>

            {shift.declineReason && (
              <p className="text-xs text-neutral-500">Declined: {shift.declineReason}</p>
            )}

            <div className="flex flex-wrap items-center gap-2">
              {shift.status === "pending" && (
                <button
                  onClick={() => withdraw(shift.id)}
                  disabled={busy === shift.id}
                  className="border border-red-500/60 text-red-400 rounded-lg px-3 py-1 text-[10px] font-bold tracking-widest disabled:opacity-40"
                >
                  {busy === shift.id ? "CANCELLING…" : "WITHDRAW"}
                </button>
              )}
              {shift.status === "confirmed" && (
                <span className="text-[10px] uppercase tracking-wider text-neutral-600">
                  the promoter confirms after the night
                </span>
              )}
              {shift.status === "completed" && !shift.invoice && (
                <button
                  onClick={() => invoice(shift)}
                  disabled={busy === shift.id}
                  className="bg-neon text-bg font-black rounded-lg px-3 py-1 text-[10px] tracking-widest disabled:opacity-40"
                >
                  {busy === shift.id ? "SENDING…" : "INVOICE VENUE"}
                </button>
              )}
              {shift.invoice && (
                <>
                  <span className="text-xs text-neutral-400">
                    {shift.invoice.number} · {shift.invoice.status} · R
                    {shift.invoice.total.toLocaleString()}
                  </span>
                  <a
                    href={`${API_URL}/door-gigs/invoices/${shift.invoice.id}/print`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-neon text-xs underline underline-offset-2"
                  >
                    Print/PDF
                  </a>
                </>
              )}
            </div>
          </div>
        ))}
      </section>
    </div>
  );
}
