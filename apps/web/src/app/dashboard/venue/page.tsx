"use client";

import { useEffect, useState } from "react";
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
  _count: { events: number; tables: number };
}
interface PendingEvent { id: string; title: string; date: string; venue: { name: string }; promoter: { name: string | null }; capacity: number }
interface VenueTable { id: string; tableNumber: string; capacity: number; minSpend: number }
interface DoorLog { id: string; result: string; qrToken: string; createdAt: string }
interface Analytics {
  totals: { events: number; rsvps: number; checkedIn: number; tableRevenue: number; venueRevenue: number };
  perEvent: { name: string; rsvps: number; checkedIn: number; tableRevenue: number; venueRevenue: number; promoterRevenue: number; status: string }[];
}

const field = "bg-bg border border-line rounded-lg px-3 py-2 text-sm outline-none focus:border-neon";

/** Phase 2 venue portal: location, approval workflow, tables, door ops, analytics. */
export default function VenuePortal() {
  const [venues, setVenues] = useState<Venue[]>([]);
  const [venueId, setVenueId] = useState<string>("");
  const [pending, setPending] = useState<PendingEvent[]>([]);
  const [tables, setTables] = useState<VenueTable[]>([]);
  const [logs, setLogs] = useState<DoorLog[]>([]);
  const [analytics, setAnalytics] = useState<Analytics | null>(null);
  const [details, setDetails] = useState({ name: "", address: "", lat: "", lng: "" });
  const [tableForm, setTableForm] = useState({ tableNumber: "", capacity: 6, minSpend: 5000 });
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
    api.get<PendingEvent[]>("/venues/events/pending").then(setPending).catch((e) => setError(errorMessage(e)));
    api.get<VenueTable[]>(`/venues/${id}/tables`).then(setTables).catch(() => {});
    api.get<DoorLog[]>(`/venues/${id}/door-logs`).then(setLogs).catch(() => {});
    api.get<Analytics>(`/venues/${id}/analytics`).then(setAnalytics).catch(() => {});
  };

  const refreshVenues = async (keepId?: string) => {
    const list = await api.get<Venue[]>("/venues/mine");
    setVenues(list);
    const next = keepId ?? venueId;
    if (!next || !list.some((v) => v.id === next)) {
      if (list[0]) loadVenue(list[0].id);
    }
  };

  useEffect(() => {
    api.get<Venue[]>("/venues/mine").then((v) => {
      setVenues(v);
      if (v[0]) loadVenue(v[0].id);
    }).catch((e) => setError(errorMessage(e)));
  }, []);

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

  const saveTable = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      await api.post(`/venues/${venueId}/tables`, tableForm);
      setTableForm({ tableNumber: "", capacity: 6, minSpend: 5000 });
      loadVenue(venueId);
    } catch (err) { setError(errorMessage(err)); }
  };

  const removeTable = async (tableNumber: string) => {
    await api.del(`/venues/${venueId}/tables/${tableNumber}`).catch((e) => setError(errorMessage(e)));
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
              className="border border-line rounded-lg px-4 py-2 text-sm font-bold text-neutral-300 hover:border-neon hover:text-neon"
            >
              ADD VENUE
            </button>
          )}
        </div>
        {notice && <p className="text-neon text-sm">{notice}</p>}
        {error && <p className="text-red-400 text-sm">{error}</p>}

        {/* A promoter books nights into rooms that may not exist in the app yet. */}
        {(creating || !selected) && (
          <section className="border border-line bg-surface rounded-xl p-4">
            <h2 className="font-bold text-neon uppercase text-sm tracking-wider mb-3">Add a venue</h2>
            <form onSubmit={createVenue} className="grid grid-cols-2 md:grid-cols-4 gap-3 items-end">
              <label className="text-xs text-neutral-500 col-span-2 md:col-span-1">
                Venue name
                <input
                  required
                  className={`${field} w-full mt-1`}
                  placeholder="The Vault"
                  value={newVenue.name}
                  onChange={(e) => setNewVenue({ ...newVenue, name: e.target.value })}
                />
              </label>
              <label className="text-xs text-neutral-500 col-span-2">
                Address
                <input
                  className={`${field} w-full mt-1`}
                  placeholder="24 Fox Street, Johannesburg"
                  value={newVenue.address}
                  onChange={(e) => setNewVenue({ ...newVenue, address: e.target.value })}
                />
              </label>
              <label className="text-xs text-neutral-500 col-span-2 md:col-span-1">
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
              <label className="text-xs text-neutral-500">
                Latitude
                <input
                  className={`${field} w-full mt-1`}
                  inputMode="decimal"
                  placeholder="-26.20410"
                  value={newVenue.lat}
                  onChange={(e) => setNewVenue({ ...newVenue, lat: e.target.value })}
                />
              </label>
              <label className="text-xs text-neutral-500">
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
                    className="text-xs text-neutral-500 underline hover:text-neon"
                  >
                    Cancel
                  </button>
                )}
                <span className="text-xs text-neutral-500">
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
            <p className="text-neutral-500 text-sm">You have no venues yet. Add the first one above and you can run events there.</p>
          ) : (
            <>
              {!hasLocation && (
                <p className="text-yellow-400 text-sm mb-3">
                  This venue has no location yet, so DJ route planning between gigs is wrong. Set the
                  coordinates below.
                </p>
              )}
              <form onSubmit={saveDetails} className="grid grid-cols-2 md:grid-cols-4 gap-3 items-end">
                <label className="text-xs text-neutral-500 col-span-2 md:col-span-1">
                  Venue name
                  <input
                    className={`${field} w-full mt-1`}
                    value={details.name}
                    onChange={(e) => setDetails({ ...details, name: e.target.value })}
                  />
                </label>
                <label className="text-xs text-neutral-500 col-span-2">
                  Address
                  <input
                    className={`${field} w-full mt-1`}
                    placeholder="24 Fox Street, Johannesburg"
                    value={details.address}
                    onChange={(e) => setDetails({ ...details, address: e.target.value })}
                  />
                </label>
                <label className="text-xs text-neutral-500">
                  Latitude
                  <input
                    className={`${field} w-full mt-1`}
                    inputMode="decimal"
                    placeholder="-26.20410"
                    value={details.lat}
                    onChange={(e) => setDetails({ ...details, lat: e.target.value })}
                  />
                </label>
                <label className="text-xs text-neutral-500">
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
                    className="border border-line rounded-lg px-4 py-2 text-sm font-bold text-neutral-300 hover:border-neon hover:text-neon"
                  >
                    USE MY LOCATION
                  </button>
                  {hasLocation && (
                    <a
                      href={`https://www.google.com/maps/search/?api=1&query=${selected.lat},${selected.lng}`}
                      target="_blank"
                      rel="noreferrer"
                      className="text-xs text-neutral-500 underline hover:text-neon"
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
                <p className="font-bold">{e.title} <span className="text-neutral-500 text-sm">by {e.promoter.name}</span></p>
                <p className="text-neutral-500 text-sm">{e.venue.name} · {new Date(e.date).toLocaleDateString()} · cap {e.capacity}</p>
              </div>
              <div className="flex gap-2">
                <button onClick={() => decide(e.id, true)} className="bg-neon text-bg font-black px-4 py-2 rounded-lg text-sm">APPROVE</button>
                <button onClick={() => decide(e.id, false)} className="border border-red-500 text-red-400 px-4 py-2 rounded-lg text-sm font-bold">REJECT</button>
              </div>
            </div>
          ))}
          {!pending.length && <p className="text-neutral-500 text-sm">Nothing pending.</p>}
        </section>

        {/* Analytics + revenue splits */}
        {showOps && analytics && (
          <section className="space-y-4">
            <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
              <Stat label="Events" value={analytics.totals.events} />
              <Stat label="RSVPs" value={analytics.totals.rsvps} />
              <Stat label="Checked in" value={analytics.totals.checkedIn} />
              <Stat label="Table revenue" value={`R${analytics.totals.tableRevenue.toLocaleString()}`} />
              <Stat label="Venue take" value={`R${analytics.totals.venueRevenue.toLocaleString()}`} />
            </div>
            <div className="border border-line rounded-xl overflow-x-auto">
              <table className="w-full text-sm min-w-[640px]">
                <thead className="bg-surface text-neutral-400 uppercase text-xs">
                  <tr>
                    <th className="text-left px-4 py-3">Event</th><th className="text-left px-4 py-3">Status</th>
                    <th className="text-left px-4 py-3">RSVPs</th><th className="text-left px-4 py-3">Door</th>
                    <th className="text-left px-4 py-3">Table rev</th><th className="text-left px-4 py-3">Venue</th><th className="text-left px-4 py-3">Promoter</th>
                  </tr>
                </thead>
                <tbody>
                  {analytics.perEvent.map((e) => (
                    <tr key={e.name} className="border-t border-line">
                      <td className="px-4 py-3 font-bold">{e.name}</td>
                      <td className="px-4 py-3">{e.status}</td>
                      <td className="px-4 py-3">{e.rsvps}</td>
                      <td className="px-4 py-3">{e.checkedIn}</td>
                      <td className="px-4 py-3">R{e.tableRevenue.toLocaleString()}</td>
                      <td className="px-4 py-3 text-neon">R{e.venueRevenue.toLocaleString()}</td>
                      <td className="px-4 py-3">R{e.promoterRevenue.toLocaleString()}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        )}

        {/* Table inventory */}
        {showOps && (
        <section className="border border-line bg-surface rounded-xl p-4">
          <h2 className="font-bold text-neon uppercase text-sm tracking-wider mb-3">Table inventory</h2>
          <form onSubmit={saveTable} className="grid grid-cols-2 md:grid-cols-4 gap-3 items-end">
            <input required className={field} placeholder="Table # (T4)" value={tableForm.tableNumber} onChange={(e) => setTableForm({ ...tableForm, tableNumber: e.target.value })} />
            <input type="number" min={1} className={field} placeholder="Capacity" value={tableForm.capacity} onChange={(e) => setTableForm({ ...tableForm, capacity: +e.target.value })} />
            <input type="number" min={0} className={field} placeholder="Min spend" value={tableForm.minSpend} onChange={(e) => setTableForm({ ...tableForm, minSpend: +e.target.value })} />
            <button className="bg-neon text-bg font-black rounded-lg py-2 tracking-widest">SAVE</button>
          </form>
          <div className="mt-4 flex flex-wrap gap-2">
            {tables.map((t) => (
              <span key={t.id} className="border border-line rounded-lg px-3 py-2 text-sm">
                <strong>{t.tableNumber}</strong> · {t.capacity}p · R{t.minSpend.toLocaleString()}
                <button onClick={() => removeTable(t.tableNumber)} className="text-red-400 ml-2 font-bold">×</button>
              </span>
            ))}
            {!tables.length && <p className="text-neutral-500 text-sm">No tables yet.</p>}
          </div>
        </section>
        )}

        {/* Door ops */}
        {showOps && (
        <section className="border border-line bg-surface rounded-xl p-4">
          <h2 className="font-bold text-neon uppercase text-sm tracking-wider mb-3">Door scan monitor (last 100)</h2>
          <div className="max-h-64 overflow-y-auto">
            {logs.map((l) => (
              <div key={l.id} className="flex justify-between border-t border-line py-2 text-sm">
                <span className="font-mono text-xs text-neutral-400 truncate max-w-[60%]">{l.qrToken}</span>
                <span className={l.result === "ok" ? "text-neon" : "text-red-400"}>{l.result}</span>
                <span className="text-neutral-500">{new Date(l.createdAt).toLocaleTimeString()}</span>
              </div>
            ))}
            {!logs.length && <p className="text-neutral-500 text-sm">No scans yet.</p>}
          </div>
        </section>
        )}
      </main>
    </>
  );
}
