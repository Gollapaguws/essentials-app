"use client";

import { useEffect, useState } from "react";
import { useResource } from "@/hooks/useResource";
import { TopNav } from "@/components/TopNav";
import { Stat } from "@/components/Stat";
import { api } from "@essentials/api-client";
import { errorMessage } from "@/lib/errors";
import { useAuth } from "@/components/AuthProvider";

interface Venue {
  id: string;
  name: string;
  address: string | null;
  lat: number;
  lng: number;
  capacity: number;
  _count: { events: number };
}
interface PendingEvent { id: string; title: string; date: string; venue: { name: string }; promoter: { name: string | null }; capacity: number }
interface DoorLog { id: string; result: string; qrToken: string; createdAt: string }
interface Analytics {
  totals: { events: number; rsvps: number; checkedIn: number };
  perEvent: { name: string; rsvps: number; checkedIn: number; status: string }[];
}

interface RevenueNight {
  id: string; title: string; date: string; status: string;
  promoterPct: number; venuePct: number;
  djFees: number; invoiced: number; paid: number; owed: number;
  unbilledGigs: number; unbilledFees: number;
}
interface Revenue {
  nights: RevenueNight[];
  totals: { nights: number; djFees: number; invoiced: number; paid: number; owed: number; unbilledGigs: number };
}

const field = "bg-bg border border-line rounded-lg px-3 py-2 text-sm outline-none focus:border-neon";

/** Phase 2 venue portal: location, approval workflow, door ops, analytics. */
export default function VenuePortal() {
  const venuesSource = useResource<Venue[]>("/venues/mine");
  const venues = venuesSource.data ?? [];
  const [venueId, setVenueId] = useState<string>("");
  // One resource per per-venue panel; `null` keeps them idle until a venue is picked.
  const pendingSource = useResource<PendingEvent[]>(venueId ? "/venues/events/pending" : null);
  const logsSource = useResource<DoorLog[]>(venueId ? `/venues/${venueId}/door-logs` : null);
  const analyticsSource = useResource<Analytics>(venueId ? `/venues/${venueId}/analytics` : null);
  const revenueSource = useResource<Revenue>(venueId ? `/venues/${venueId}/revenue` : null);
  const pending = pendingSource.data ?? [];
  const logs = logsSource.data ?? [];
  const analytics = analyticsSource.data;
  const revenue = revenueSource.data;
  const [details, setDetails] = useState({ name: "", address: "", lat: "", lng: "" });
  const [busyDetails, setBusyDetails] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [busyCreate, setBusyCreate] = useState(false);
  const [newVenue, setNewVenue] = useState({ name: "", address: "", capacity: "200", lat: "", lng: "" });
  const { me } = useAuth();
  // A promoter owns the venue's details and its event approvals; door scans and
  // revenue splits stay the venue manager's view.
  const showOps = me?.user.role !== "promoter";

  const selected = venues.find((v) => v.id === venueId) ?? null;
  const hasLocation = Boolean(selected && (selected.lat !== 0 || selected.lng !== 0));

  const loadVenue = (id: string) => {
    setVenueId(id);
    setError(null);
    // Same venue again (e.g. after an approval) has to re-read; a different one
    // re-fetches by itself because each path changes.
    pendingSource.reload();
    logsSource.reload();
    analyticsSource.reload();
    revenueSource.reload();
  };

  const refreshVenues = (keepId?: string) => {
    venuesSource.reload();
    if (keepId) loadVenue(keepId);
  };

  // Default to the first venue once the list lands, without overriding a choice.
  useEffect(() => {
    if (!venueId && venues[0]) setVenueId(venues[0].id);
  }, [venues, venueId]);

  // Keep the form in sync with whichever venue is selected.
  useEffect(() => {
    if (!selected) return;
    setDetails({
      name: selected.name,
      address: selected.address ?? "",
      lat: String(selected.lat),
      lng: String(selected.lng),
    });
  }, [selected?.id, selected?.name, selected?.address, selected?.lat, selected?.lng]);

  const decide = async (id: string, approve: boolean) => {
    await api.post(`/venues/events/${id}/decision`, { approve });
    loadVenue(venueId);
  };

  const saveDetails = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setNotice(null);
    const lat = Number(details.lat);
    const lng = Number(details.lng);
    if (details.lat.trim() === "" || details.lng.trim() === "" || !Number.isFinite(lat) || !Number.isFinite(lng)) {
      setError("Latitude and longitude are both required — DJ route planning measures between venue locations.");
      return;
    }
    if (Math.abs(lat) > 90 || Math.abs(lng) > 180) {
      setError("Latitude must be between -90 and 90, longitude between -180 and 180.");
      return;
    }
    setBusyDetails(true);
    try {
      await api.patch<Venue>(`/venues/${venueId}`, {
        name: details.name.trim(),
        address: details.address.trim(),
        lat,
        lng,
      });
      await refreshVenues(venueId);
      setNotice("Venue details saved.");
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusyDetails(false);
    }
  };

  const createVenue = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setNotice(null);

    const name = newVenue.name.trim();
    if (!name) {
      setError("Give the venue a name.");
      return;
    }
    const capacity = Number(newVenue.capacity);
    if (!Number.isInteger(capacity) || capacity < 1) {
      setError("Capacity must be a whole number of at least 1.");
      return;
    }
    const lat = newVenue.lat.trim();
    const lng = newVenue.lng.trim();
    if ((lat === "") !== (lng === "")) {
      setError("Enter latitude and longitude together, or leave both blank until you have them.");
      return;
    }

    const payload: { name: string; capacity: number; address?: string; lat?: number; lng?: number } = {
      name,
      capacity,
    };
    if (newVenue.address.trim()) payload.address = newVenue.address.trim();
    if (lat !== "") {
      const latNum = Number(lat);
      const lngNum = Number(lng);
      if (!Number.isFinite(latNum) || !Number.isFinite(lngNum) || Math.abs(latNum) > 90 || Math.abs(lngNum) > 180) {
        setError("Latitude must be between -90 and 90, longitude between -180 and 180.");
        return;
      }
      payload.lat = latNum;
      payload.lng = lngNum;
    }

    setBusyCreate(true);
    try {
      const created = await api.post<Venue>("/venues", payload);
      await refreshVenues(created.id);
      loadVenue(created.id);
      setCreating(false);
      setNewVenue({ name: "", address: "", capacity: "200", lat: "", lng: "" });
      setNotice(`${created.name} added. It is yours to manage from here.`);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusyCreate(false);
    }
  };

  const useMyLocation = () => {
    setError(null);
    if (typeof navigator === "undefined" || !navigator.geolocation) {
      setError("This browser cannot read your location — enter the coordinates manually.");
      return;
    }
    navigator.geolocation.getCurrentPosition(
      (pos) => setDetails((d) => ({
        ...d,
        lat: pos.coords.latitude.toFixed(5),
        lng: pos.coords.longitude.toFixed(5),
      })),
      () => setError("Could not read your location. Enter the coordinates manually."),
      { enableHighAccuracy: true, timeout: 10_000 },
    );
  };

  return (
    <>
      <TopNav />
      <main className="max-w-6xl mx-auto px-6 py-8 space-y-8">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h1 className="text-2xl font-black tracking-wide">VENUE PORTAL</h1>
          {selected && !creating && (
            <button
              onClick={() => { setCreating(true); setError(null); setNotice(null); }}
              className="border border-line rounded-lg px-4 py-2 text-sm font-bold text-fg hover:border-neon hover:text-neon"
            >
              ADD VENUE
            </button>
          )}
        </div>
        {notice && <p className="text-neon text-sm">{notice}</p>}
        {(error ?? venuesSource.error ?? pendingSource.error) && (
          <p role="alert" className="text-alert text-sm">
            {error ?? venuesSource.error ?? pendingSource.error}
          </p>
        )}

        {/* A promoter books nights into rooms that may not exist in the app yet. */}
        {(creating || !selected) && (
          <section className="border border-line bg-surface rounded-xl p-4">
            <h2 className="font-bold text-neon uppercase text-sm tracking-wider mb-3">Add a venue</h2>
            <form onSubmit={createVenue} className="grid grid-cols-2 md:grid-cols-4 gap-3 items-end">
              <label className="text-xs text-muted col-span-2 md:col-span-1">
                Venue name
                <input
                  required
                  className={`${field} w-full mt-1`}
                  placeholder="The Vault"
                  value={newVenue.name}
                  onChange={(e) => setNewVenue({ ...newVenue, name: e.target.value })}
                />
              </label>
              <label className="text-xs text-muted col-span-2">
                Address
                <input
                  className={`${field} w-full mt-1`}
                  placeholder="24 Fox Street, Johannesburg"
                  value={newVenue.address}
                  onChange={(e) => setNewVenue({ ...newVenue, address: e.target.value })}
                />
              </label>
              <label className="text-xs text-muted col-span-2 md:col-span-1">
                Capacity
                <input
                  required
                  type="number"
                  min={1}
                  className={`${field} w-full mt-1`}
                  value={newVenue.capacity}
                  onChange={(e) => setNewVenue({ ...newVenue, capacity: e.target.value })}
                />
              </label>
              <label className="text-xs text-muted">
                Latitude
                <input
                  className={`${field} w-full mt-1`}
                  inputMode="decimal"
                  placeholder="-26.20410"
                  value={newVenue.lat}
                  onChange={(e) => setNewVenue({ ...newVenue, lat: e.target.value })}
                />
              </label>
              <label className="text-xs text-muted">
                Longitude
                <input
                  className={`${field} w-full mt-1`}
                  inputMode="decimal"
                  placeholder="28.04730"
                  value={newVenue.lng}
                  onChange={(e) => setNewVenue({ ...newVenue, lng: e.target.value })}
                />
              </label>
              <div className="col-span-2 md:col-span-4 flex flex-wrap items-center gap-3">
                <button
                  disabled={busyCreate}
                  className="bg-neon text-bg font-black rounded-lg px-4 py-2 tracking-widest text-sm disabled:opacity-50"
                >
                  {busyCreate ? "CREATING…" : "CREATE VENUE"}
                </button>
                {selected && (
                  <button
                    type="button"
                    onClick={() => { setCreating(false); setError(null); }}
                    className="text-xs text-muted underline hover:text-neon"
                  >
                    Cancel
                  </button>
                )}
                <span className="text-xs text-muted">
                  Add coordinates now if you have them — DJ route planning measures between venues.
                </span>
              </div>
            </form>
          </section>
        )}

        {venues.length > 1 && (
          <select className={field} value={venueId} onChange={(e) => loadVenue(e.target.value)}>
            {venues.map((v) => <option key={v.id} value={v.id}>{v.name}</option>)}
          </select>
        )}

        {/* Venue details + location */}
        <section className="border border-line bg-surface rounded-xl p-4">
          <h2 className="font-bold text-neon uppercase text-sm tracking-wider mb-3">Venue details &amp; location</h2>
          {!selected ? (
            <p className="text-muted text-sm">You have no venues yet. Add the first one above and you can run events there.</p>
          ) : (
            <>
              {!hasLocation && (
                <p className="text-warn text-sm mb-3">
                  This venue has no location yet, so DJ route planning between gigs is wrong. Set the
                  coordinates below.
                </p>
              )}
              <form onSubmit={saveDetails} className="grid grid-cols-2 md:grid-cols-4 gap-3 items-end">
                <label className="text-xs text-muted col-span-2 md:col-span-1">
                  Venue name
                  <input
                    className={`${field} w-full mt-1`}
                    value={details.name}
                    onChange={(e) => setDetails({ ...details, name: e.target.value })}
                  />
                </label>
                <label className="text-xs text-muted col-span-2">
                  Address
                  <input
                    className={`${field} w-full mt-1`}
                    placeholder="24 Fox Street, Johannesburg"
                    value={details.address}
                    onChange={(e) => setDetails({ ...details, address: e.target.value })}
                  />
                </label>
                <label className="text-xs text-muted">
                  Latitude
                  <input
                    className={`${field} w-full mt-1`}
                    inputMode="decimal"
                    placeholder="-26.20410"
                    value={details.lat}
                    onChange={(e) => setDetails({ ...details, lat: e.target.value })}
                  />
                </label>
                <label className="text-xs text-muted">
                  Longitude
                  <input
                    className={`${field} w-full mt-1`}
                    inputMode="decimal"
                    placeholder="28.04730"
                    value={details.lng}
                    onChange={(e) => setDetails({ ...details, lng: e.target.value })}
                  />
                </label>
                <div className="col-span-2 md:col-span-4 flex flex-wrap items-center gap-3">
                  <button
                    disabled={busyDetails}
                    className="bg-neon text-bg font-black rounded-lg px-4 py-2 tracking-widest text-sm disabled:opacity-50"
                  >
                    {busyDetails ? "SAVING…" : "SAVE VENUE"}
                  </button>
                  <button
                    type="button"
                    onClick={useMyLocation}
                    className="border border-line rounded-lg px-4 py-2 text-sm font-bold text-fg hover:border-neon hover:text-neon"
                  >
                    USE MY LOCATION
                  </button>
                  {hasLocation && (
                    <a
                      href={`https://www.google.com/maps/search/?api=1&query=${selected.lat},${selected.lng}`}
                      target="_blank"
                      rel="noreferrer"
                      className="text-xs text-muted underline hover:text-neon"
                    >
                      Check on the map
                    </a>
                  )}
                </div>
              </form>
            </>
          )}
        </section>

        {/* Approval workflow */}
        <section className="border border-line bg-surface rounded-xl p-4">
          <h2 className="font-bold text-neon uppercase text-sm tracking-wider mb-3">Pending event approvals</h2>
          {pending.map((e) => (
            <div key={e.id} className="flex flex-wrap items-center justify-between border-t border-line py-3 gap-2">
              <div>
                <p className="font-bold">{e.title} <span className="text-muted text-sm">by {e.promoter.name}</span></p>
                <p className="text-muted text-sm">{e.venue.name} · {new Date(e.date).toLocaleDateString()} · cap {e.capacity}</p>
              </div>
              <div className="flex gap-2">
                <button onClick={() => decide(e.id, true)} className="bg-neon text-bg font-black px-4 py-2 rounded-lg text-sm">APPROVE</button>
                <button onClick={() => decide(e.id, false)} className="border border-red-500 text-alert px-4 py-2 rounded-lg text-sm font-bold">REJECT</button>
              </div>
            </div>
          ))}
          {!pending.length && <p className="text-muted text-sm">Nothing pending.</p>}
        </section>

        {/* Analytics */}
        {showOps && analytics && (
          <section className="space-y-4">
            <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
              <Stat label="Events" value={analytics.totals.events} />
              <Stat label="RSVPs" value={analytics.totals.rsvps} />
              <Stat label="Checked in" value={analytics.totals.checkedIn} />
            </div>
            <div className="border border-line rounded-xl overflow-x-auto">
              <table className="w-full text-sm min-w-[640px]">
                <thead className="bg-surface text-muted uppercase text-xs">
                  <tr>
                    <th className="text-left px-4 py-3">Event</th><th className="text-left px-4 py-3">Status</th>
                    <th className="text-left px-4 py-3">RSVPs</th><th className="text-left px-4 py-3">Door</th>
                  </tr>
                </thead>
                <tbody>
                  {analytics.perEvent.map((e) => (
                    <tr key={e.name} className="border-t border-line">
                      <td className="px-4 py-3 font-bold">{e.name}</td>
                      <td className="px-4 py-3">{e.status}</td>
                      <td className="px-4 py-3">{e.rsvps}</td>
                      <td className="px-4 py-3">{e.checkedIn}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        )}

        {/* DJ money the venue owes */}
        {showOps && revenue && revenue.nights.length > 0 && (
          <section className="border border-line bg-surface rounded-xl p-4 space-y-3">
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <h2 className="font-bold text-neon uppercase text-sm tracking-wider">DJ fees &amp; invoices</h2>
              <p className="text-xs text-muted">
                R{revenue.totals.paid.toLocaleString()} paid ·{" "}
                <span className={revenue.totals.owed > 0 ? "text-warn" : "text-neon"}>
                  R{revenue.totals.owed.toLocaleString()} owed
                </span>
                {revenue.totals.unbilledGigs > 0 && ` · ${revenue.totals.unbilledGigs} played gig${revenue.totals.unbilledGigs === 1 ? "" : "s"} not invoiced yet`}
              </p>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-sm min-w-[720px]">
                <thead className="text-muted uppercase text-[10px] tracking-widest">
                  <tr>
                    <th className="text-left py-2">Night</th>
                    <th className="text-right py-2">Split</th>
                    <th className="text-right py-2">DJ fees</th>
                    <th className="text-right py-2">Invoiced</th>
                    <th className="text-right py-2">Paid</th>
                    <th className="text-right py-2">Owed</th>
                  </tr>
                </thead>
                <tbody>
                  {revenue.nights.map((n) => (
                    <tr key={n.id} className="border-t border-line">
                      <td className="py-2">
                        <span className="font-bold">{n.title}</span>
                        <span className="text-muted text-xs"> · {new Date(n.date).toLocaleDateString()}</span>
                      </td>
                      <td className="py-2 text-right text-muted text-xs tabular-nums">
                        {n.venuePct}% venue / {n.promoterPct}% promoter
                      </td>
                      <td className="py-2 text-right tabular-nums">R{n.djFees.toLocaleString()}</td>
                      <td className="py-2 text-right tabular-nums text-muted">R{n.invoiced.toLocaleString()}</td>
                      <td className="py-2 text-right tabular-nums text-neon">R{n.paid.toLocaleString()}</td>
                      <td className={`py-2 text-right tabular-nums ${n.owed > 0 ? "text-warn" : "text-muted"}`}>
                        R{n.owed.toLocaleString()}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {revenue.totals.unbilledGigs > 0 && (
              <p className="text-xs text-muted">
                A played gig only turns into a bill once its DJ invoices it. The split above is the one the night was
                booked on; the venue&apos;s share of door and table takings is settled separately.
              </p>
            )}
          </section>
        )}

        {/* Door ops */}
        {showOps && (
        <section className="border border-line bg-surface rounded-xl p-4">
          <h2 className="font-bold text-neon uppercase text-sm tracking-wider mb-3">Door scan monitor (last 100)</h2>
          <div className="max-h-64 overflow-y-auto">
            {logs.map((l) => (
              <div key={l.id} className="flex justify-between border-t border-line py-2 text-sm">
                <span className="font-mono text-xs text-muted truncate max-w-[60%]">{l.qrToken}</span>
                <span className={l.result === "ok" ? "text-neon" : "text-alert"}>{l.result}</span>
                <span className="text-muted">{new Date(l.createdAt).toLocaleTimeString()}</span>
              </div>
            ))}
            {!logs.length && <p className="text-muted text-sm">No scans yet.</p>}
          </div>
        </section>
        )}
      </main>
    </>
  );
}
