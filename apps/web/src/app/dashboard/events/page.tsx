"use client";

import { useEffect, useState } from "react";
import { TopNav } from "@/components/TopNav";
import { api } from "@essentials/api-client";
import { errorMessage } from "@/lib/errors";
import { useAuth } from "@/components/AuthProvider";

interface EventRow {
  id: string; title: string; date: string; status: string; capacity: number;
  venue: { name: string };
  _count: { guestLists: number; tableBookings: number };
}

interface VenueOption {
  id: string;
  name: string;
  address: string | null;
  lat: number;
  lng: number;
  capacity: number;
  hasLocation: boolean;
  managerId: string | null;
}

const field = "bg-bg border border-line rounded-lg px-3 py-2";

/** Event manager: pick a venue from the list, CRUD, capacity caps, live guest lists. */
export default function EventManager() {
  const [events, setEvents] = useState<EventRow[]>([]);
  const [venues, setVenues] = useState<VenueOption[]>([]);
  const [form, setForm] = useState({ title: "", venueId: "", date: "", capacity: 100 });
  const [error, setError] = useState<string | null>(null);
  const { me } = useAuth();

  const selectedVenue = venues.find((v) => v.id === form.venueId) ?? null;
  // Managing the venue means there is nobody else to approve the night: the API
  // approves it on creation and calls the DJ roster straight away.
  const venueIsMine = !!selectedVenue?.managerId && selectedVenue.managerId === me?.user.sub;

  const load = () => api.get<EventRow[]>("/events/manage/list").then(setEvents).catch((e) => setError(errorMessage(e)));
  useEffect(() => {
    load();
    api.get<VenueOption[]>("/venues/options").then(setVenues).catch((e) => setError(errorMessage(e)));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const pickVenue = (venueId: string) => {
    const venue = venues.find((v) => v.id === venueId) ?? null;
    // Never start above the venue's own cap: the API rejects it.
    setForm((f) => ({
      ...f,
      venueId,
      capacity: venue ? Math.min(f.capacity || venue.capacity, venue.capacity) : f.capacity,
    }));
  };

  const cancel = async (event: EventRow) => {
    const label = `${event.title} (${new Date(event.date).toLocaleDateString()})`;
    if (!window.confirm(`Cancel ${label}?\n\nGuest lists, door scans and table bookings stay; the night just drops off the guest feed and reminders.`)) return;
    setError(null);
    try {
      await api.post(`/events/${event.id}/cancel`);
      load();
    } catch (err) {
      setError(errorMessage(err));
    }
  };

  const reopen = async (event: EventRow) => {
    setError(null);
    try {
      await api.post(`/events/${event.id}/reopen`);
      load();
    } catch (err) {
      setError(errorMessage(err));
    }
  };

  const remove = async (event: EventRow) => {
    const label = `${event.title} (${new Date(event.date).toLocaleDateString()})`;
    if (!window.confirm(`Delete ${label}?\n\nIts guest list, table bookings, chat and promotions go with it. This cannot be undone.`)) return;
    setError(null);
    try {
      await api.del(`/events/${event.id}`);
      load();
    } catch (err) {
      setError(errorMessage(err));
    }
  };

  const create = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    try {
      await api.post("/events", { ...form, date: new Date(form.date).toISOString() });
      setForm({ title: "", venueId: "", date: "", capacity: 100 });
      load();
    } catch (err) {
      setError(errorMessage(err));
    }
  };

  return (
    <>
      <TopNav />
      <main className="max-w-6xl mx-auto px-6 py-8 space-y-8">
        <h1 className="text-2xl font-black tracking-wide">EVENT MANAGER</h1>
        {error && <p className="text-red-400 text-sm">{error}</p>}

        <form onSubmit={create} className="space-y-3 border border-line bg-surface rounded-xl p-4">
          <div className="grid md:grid-cols-4 gap-3 items-end">
            <input required className={field} placeholder="Event title" value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} />
            <select required className={field} value={form.venueId} onChange={(e) => pickVenue(e.target.value)}>
              <option value="">Pick a venue</option>
              {venues.map((v) => (
                <option key={v.id} value={v.id}>
                  {v.name}
                  {v.hasLocation ? "" : " (no location)"}
                </option>
              ))}
            </select>
            <input required type="datetime-local" className={field} value={form.date} onChange={(e) => setForm({ ...form, date: e.target.value })} />
            <input required type="number" min={1} className={field} placeholder="Capacity" value={form.capacity} onChange={(e) => setForm({ ...form, capacity: +e.target.value })} />
          </div>

          {selectedVenue && (
            <p className="text-xs text-neutral-500">
              {selectedVenue.name}
              {selectedVenue.address ? ` | ${selectedVenue.address}` : ""}
              {` | capacity ${selectedVenue.capacity}`}
            </p>
          )}
          {selectedVenue && !selectedVenue.hasLocation && (
            <p className="text-yellow-400 text-xs">
              {selectedVenue.name} has no coordinates yet. The event can still be created, but DJ route
              planning between gigs will be wrong until its manager sets the location in the venue portal.
            </p>
          )}
          {!venues.length && (
            <p className="text-yellow-400 text-xs">
              No venues exist yet. Add one in the Venue Portal first, then pick it here.
            </p>
          )}

          {venueIsMine && (
            <p className="text-neon text-xs">
              {selectedVenue.name} is yours, so the event is approved immediately: it goes on the front page and
              every DJ gets the call.
            </p>
          )}

          <button className="bg-neon text-bg font-black rounded-lg px-4 py-2 tracking-widest">
            {venueIsMine ? "CREATE & GO LIVE" : "CREATE (pending approval)"}
          </button>
        </form>

        <div className="border border-line rounded-xl overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-surface text-neutral-400 uppercase text-xs">
              <tr>
                <th className="text-left px-4 py-3">Event</th>
                <th className="text-left px-4 py-3">Venue</th>
                <th className="text-left px-4 py-3">Date</th>
                <th className="text-left px-4 py-3">Status</th>
                <th className="text-left px-4 py-3">Guests</th>
                <th className="text-left px-4 py-3">Actions</th>
              </tr>
            </thead>
            <tbody>
              {events.map((e) => (
                <tr key={e.id} className={`border-t border-line${e.status === "cancelled" ? " opacity-50" : ""}`}>
                  <td className="px-4 py-3 font-bold">{e.title}</td>
                  <td className="px-4 py-3 text-neutral-400">{e.venue.name}</td>
                  <td className="px-4 py-3">{new Date(e.date).toLocaleDateString()}</td>
                  <td className="px-4 py-3"><span className={e.status === "approved" || e.status === "live" ? "text-neon" : "text-neutral-400"}>{e.status}</span></td>
                  <td className="px-4 py-3">{e._count.guestLists}/{e.capacity}</td>
                  <td className="px-4 py-3 space-x-2">
                    <button onClick={async () => { await api.post(`/events/${e.id}/clone`); load(); }} className="text-neon underline text-xs">Clone</button>
                    <a href={`${process.env.NEXT_PUBLIC_API_URL}/events/${e.id}/guest-list.csv`} className="text-neutral-300 underline text-xs">CSV</a>
                    {e.status === "cancelled" ? (
                      <button onClick={() => reopen(e)} className="text-neutral-300 underline text-xs">Reopen</button>
                    ) : (
                      <button onClick={() => cancel(e)} className="text-yellow-400 underline text-xs">Cancel</button>
                    )}
                    <button onClick={() => remove(e)} className="text-red-400 underline text-xs">Delete</button>
                  </td>
                </tr>
              ))}
              {!events.length && (
                <tr><td colSpan={6} className="px-4 py-6 text-center text-neutral-500">No events yet. Seed the demo data to see one.</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </main>
    </>
  );
}
