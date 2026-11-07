"use client";

import { Fragment, useEffect, useState } from "react";
import { TopNav } from "@/components/TopNav";
import { api } from "@essentials/api-client";
import { errorMessage } from "@/lib/errors";
import { useAuth } from "@/components/AuthProvider";
import { DownloadButton } from "@/components/DownloadButton";

interface EventSlotRow {
  id: string;
  label: string;
  fee: number;
  startsAt: string;
  taken: boolean;
  confirmed: boolean;
}

interface EventRow {
  id: string; title: string; date: string; status: string; capacity: number;
  budget: number; djFeePerHour: number;
  slotCount: number | null; slotMinutes: number | null; slotStartMinute: number | null;
  slots: EventSlotRow[];
  committed: number;
  venue: { name: string };
  _count: { guestLists: number };
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

interface SlotForm {
  eventId: string | null;
  budget: number;
  djFeePerHour: number;
  slotCount: number;
  slotMinutes: number;
  slotStart: string;
}

const field = "bg-bg border border-line rounded-lg px-3 py-2";
const EMPTY_SLOTS: SlotForm = { eventId: null, budget: 5000, djFeePerHour: 500, slotCount: 4, slotMinutes: 60, slotStart: "20:00" };

/** What one slot pays: the per-hour rate times its length. Mirrors the API. */
const slotFee = (rate: number, minutes: number) => Math.round((rate * minutes) / 60);

const hhmm = (minutes: number | null) =>
  minutes == null ? "20:00" : `${String(Math.floor(minutes / 60)).padStart(2, "0")}:${String(minutes % 60).padStart(2, "0")}`;

/** Event manager: pick a venue from the list, CRUD, capacity caps, live guest lists. */
export default function EventManager() {
  const [events, setEvents] = useState<EventRow[]>([]);
  const [venues, setVenues] = useState<VenueOption[]>([]);
  const [form, setForm] = useState({
    title: "",
    venueId: "",
    date: "",
    capacity: 100,
    budget: 5000,
    djFeePerHour: 500,
    slotCount: 4,
    slotMinutes: 60,
    slotStart: "20:00",
  });
  // Re-planning an existing night uses the same fields, prefilled from the event.
  const [slots, setSlots] = useState<SlotForm>(EMPTY_SLOTS);
  // Per-slot fee overrides, keyed by slot id, for the expanded plan panel.
  const [slotDrafts, setSlotDrafts] = useState<Record<string, number>>({});
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
    if (!window.confirm(`Cancel ${label}?\n\nGuest lists and door scans stay; the night just drops off the guest feed and reminders.`)) return;
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
    if (!window.confirm(`Delete ${label}?\n\nIts guest list, chat and promotions go with it. This cannot be undone.`)) return;
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
      setForm({ ...form, title: "", venueId: "", date: "" });
      load();
    } catch (err) {
      setError(errorMessage(err));
    }
  };

  const openSlots = (event: EventRow) => {
    setError(null);
    setSlots({
      eventId: event.id,
      budget: event.budget,
      djFeePerHour: event.djFeePerHour || 500,
      slotCount: event.slotCount ?? 4,
      slotMinutes: event.slotMinutes ?? 60,
      slotStart: hhmm(event.slotStartMinute),
    });
  };

  const saveSlots = async () => {
    if (!slots.eventId) return;
    setError(null);
    try {
      const { eventId, ...plan } = slots;
      await api.patch(`/events/${eventId}/slots`, plan);
      setSlots(EMPTY_SLOTS);
      load();
    } catch (err) {
      setError(errorMessage(err));
    }
  };

  const saveSlotFee = async (slotId: string, current: number) => {
    if (!slots.eventId) return;
    setError(null);
    try {
      await api.patch(`/events/${slots.eventId}/slots/${slotId}/fee`, { fee: slotDrafts[slotId] ?? current });
      load();
    } catch (err) {
      setError(errorMessage(err));
    }
  };

  const repeatWeekly = async (event: EventRow) => {
    const raw = window.prompt("Create how many weekly copies? (1–12)", "4");
    if (!raw) return;
    const weeks = Number(raw);
    if (!Number.isInteger(weeks) || weeks < 1 || weeks > 12) return;
    setError(null);
    try {
      await api.post(`/events/${event.id}/repeat`, { weeks });
      load();
    } catch (err) {
      setError(errorMessage(err));
    }
  };

  const planFee = slotFee(form.djFeePerHour, form.slotMinutes);
  const planTotal = planFee * form.slotCount;
  const editFee = slotFee(slots.djFeePerHour, slots.slotMinutes);
  const editTotal = editFee * slots.slotCount;

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

          <div className="grid md:grid-cols-5 gap-3 items-end">
            <label className="text-xs text-neutral-400 space-y-1">
              <span>DJ fee / hour (R)</span>
              <input required type="number" min={1} className={`${field} w-full`} value={form.djFeePerHour} onChange={(e) => setForm({ ...form, djFeePerHour: +e.target.value })} />
            </label>
            <label className="text-xs text-neutral-400 space-y-1">
              <span>Timeslots</span>
              <input required type="number" min={1} max={12} className={`${field} w-full`} value={form.slotCount} onChange={(e) => setForm({ ...form, slotCount: +e.target.value })} />
            </label>
            <label className="text-xs text-neutral-400 space-y-1">
              <span>Slot length (min)</span>
              <input required type="number" min={30} max={480} step={15} className={`${field} w-full`} value={form.slotMinutes} onChange={(e) => setForm({ ...form, slotMinutes: +e.target.value })} />
            </label>
            <label className="text-xs text-neutral-400 space-y-1">
              <span>First slot starts</span>
              <input required type="time" className={`${field} w-full`} value={form.slotStart} onChange={(e) => setForm({ ...form, slotStart: e.target.value })} />
            </label>
            <label className="text-xs text-neutral-400 space-y-1">
              <span>Budget ceiling (R)</span>
              <input type="number" min={0} className={`${field} w-full`} value={form.budget} onChange={(e) => setForm({ ...form, budget: +e.target.value })} />
            </label>
          </div>

          <p className="text-xs text-neutral-500">
            {form.slotCount} × {form.slotMinutes} min from {form.slotStart} ·{" "}
            <span className="text-neutral-300">R{planFee.toLocaleString()} per slot</span> · R{planTotal.toLocaleString()} total
            {form.budget > 0 && (planTotal > form.budget
              ? <span className="text-yellow-400"> — plan is R{(planTotal - form.budget).toLocaleString()} above the R{form.budget.toLocaleString()} budget; you can only confirm DJs up to the budget</span>
              : <span> of R{form.budget.toLocaleString()} budget</span>)}
          </p>

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

        <div className="border border-line rounded-xl overflow-x-auto">
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
              {events.map((e) => {
                const fee = slotFee(e.djFeePerHour, e.slotMinutes ?? 60);
                const allocated = fee * (e.slotCount ?? 0);
                return (
                  <Fragment key={e.id}>
                    <tr className={`border-t border-line${e.status === "cancelled" ? " opacity-50" : ""}`}>
                      <td className="px-4 py-3">
                        <p className="font-bold">{e.title}</p>
                        {e.slotCount ? (
                          <p className="text-neutral-500 text-xs">
                            {e.slotCount} × {e.slotMinutes} min · R{e.djFeePerHour.toLocaleString()}/h ·{" "}
                            <span className="text-neutral-300">R{fee.toLocaleString()}/slot</span> · R{e.committed.toLocaleString()} committed
                            {e.budget > 0 ? ` of R${e.budget.toLocaleString()}` : ""}
                            {e.budget > 0 && allocated > e.budget && (
                              <span className="text-yellow-400"> · plan R{(allocated - e.budget).toLocaleString()} over budget · confirmations stop at R{e.budget.toLocaleString()}</span>
                            )}
                          </p>
                        ) : (
                          <p className="text-neutral-500 text-xs">No slots planned — DJs see the old day/evening/late-night call.</p>
                        )}
                      </td>
                      <td className="px-4 py-3 text-neutral-400">{e.venue.name}</td>
                      <td className="px-4 py-3">{new Date(e.date).toLocaleDateString()}</td>
                      <td className="px-4 py-3"><span className={e.status === "approved" || e.status === "live" ? "text-neon" : "text-neutral-400"}>{e.status}</span></td>
                      <td className="px-4 py-3">{e._count.guestLists}/{e.capacity}</td>
                      <td className="px-4 py-3 space-x-2">
                        <button onClick={() => (slots.eventId === e.id ? setSlots(EMPTY_SLOTS) : openSlots(e))} className="text-neutral-300 underline text-xs">
                          {slots.eventId === e.id ? "Close" : "Slots & budget"}
                        </button>
                        <button onClick={async () => { await api.post(`/events/${e.id}/clone`); load(); }} className="text-neon underline text-xs">Clone</button>
                        <button onClick={() => repeatWeekly(e)} className="text-neutral-300 underline text-xs">Repeat weekly</button>
                        <DownloadButton path={`/events/${e.id}/guest-list.csv`} filename={`guestlist-${e.id}.csv`} label="Guest CSV" />
                        <DownloadButton path={`/events/${e.id}/spend.csv`} filename={`dj-spend-${e.id}.csv`} label="Spend CSV" />
                        {e.status === "cancelled" ? (
                          <button onClick={() => reopen(e)} className="text-neutral-300 underline text-xs">Reopen</button>
                        ) : (
                          <button onClick={() => cancel(e)} className="text-yellow-400 underline text-xs">Cancel</button>
                        )}
                        <button onClick={() => remove(e)} className="text-red-400 underline text-xs">Delete</button>
                      </td>
                    </tr>
                    {slots.eventId === e.id && (
                      <tr className="border-t border-line bg-surface/60">
                        <td colSpan={6} className="px-4 py-3 space-y-2">
                          <div className="grid md:grid-cols-5 gap-2 items-end">
                            <label className="text-xs text-neutral-400 space-y-1">
                              <span>DJ fee / hour (R)</span>
                              <input type="number" min={1} className={`${field} w-full`} value={slots.djFeePerHour} onChange={(ev) => setSlots({ ...slots, djFeePerHour: +ev.target.value })} />
                            </label>
                            <label className="text-xs text-neutral-400 space-y-1">
                              <span>Timeslots</span>
                              <input type="number" min={1} max={12} className={`${field} w-full`} value={slots.slotCount} onChange={(ev) => setSlots({ ...slots, slotCount: +ev.target.value })} />
                            </label>
                            <label className="text-xs text-neutral-400 space-y-1">
                              <span>Slot length (min)</span>
                              <input type="number" min={30} max={480} step={15} className={`${field} w-full`} value={slots.slotMinutes} onChange={(ev) => setSlots({ ...slots, slotMinutes: +ev.target.value })} />
                            </label>
                            <label className="text-xs text-neutral-400 space-y-1">
                              <span>First slot starts</span>
                              <input type="time" className={`${field} w-full`} value={slots.slotStart} onChange={(ev) => setSlots({ ...slots, slotStart: ev.target.value })} />
                            </label>
                            <label className="text-xs text-neutral-400 space-y-1">
                              <span>Budget ceiling (R)</span>
                              <input type="number" min={0} className={`${field} w-full`} value={slots.budget} onChange={(ev) => setSlots({ ...slots, budget: +ev.target.value })} />
                            </label>
                          </div>
                          <p className="text-xs text-neutral-500">
                            {slots.slotCount} × {slots.slotMinutes} min from {slots.slotStart} ·{" "}
                            <span className="text-neutral-300">R{editFee.toLocaleString()} per slot</span> · R{editTotal.toLocaleString()} total
                            {slots.budget > 0 && editTotal > slots.budget && (
                              <span className="text-yellow-400"> — plan over budget · you can only confirm DJs up to R{slots.budget.toLocaleString()}</span>
                            )}
                          </p>
                          <div className="space-y-1">
                            <p className="text-[10px] uppercase tracking-widest text-neutral-500">Slot fees — a headline set can pay differently</p>
                            {e.slots.map((s) => {
                              const draft = slotDrafts[s.id] ?? s.fee;
                              return (
                                <div key={s.id} className="flex flex-wrap items-center gap-2 text-xs">
                                  <span className="text-neutral-400 w-32">{s.label}</span>
                                  <input
                                    type="number"
                                    min={1}
                                    aria-label={`Fee for ${s.label}`}
                                    className={`${field} w-24`}
                                    value={draft}
                                    onChange={(ev) => setSlotDrafts({ ...slotDrafts, [s.id]: +ev.target.value })}
                                  />
                                  <span className="text-neutral-500">R{s.fee.toLocaleString()} now</span>
                                  {s.confirmed ? (
                                    <span className="text-neutral-600">confirmed — fee locked</span>
                                  ) : (
                                    <button onClick={() => saveSlotFee(s.id, s.fee)} className="text-neon underline">SET FEE</button>
                                  )}
                                </div>
                              );
                            })}
                            {!e.slots.length && <p className="text-neutral-600 text-xs">No slots yet — save a plan above.</p>}
                          </div>
                          <div className="flex items-center gap-3 text-xs">
                            <button onClick={saveSlots} className="bg-neon text-bg font-black rounded-lg px-3 py-1 tracking-widest">SAVE PLAN</button>
                            <button onClick={() => setSlots(EMPTY_SLOTS)} className="text-neutral-500 hover:text-neon">CANCEL</button>
                            <span className="text-neutral-500">
                              Re-planning replaces all slots and is refused once DJs have applied — the budget
                              alone can still be changed then.
                            </span>
                          </div>
                        </td>
                      </tr>
                    )}
                  </Fragment>
                );
              })}
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
