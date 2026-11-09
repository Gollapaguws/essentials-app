"use client";

import { useCallback, useEffect, useState } from "react";
import { TopNav } from "@/components/TopNav";
import { Stat } from "@/components/Stat";
import { api } from "@essentials/api-client";
import { errorMessage } from "@/lib/errors";

interface EventRow {
  id: string;
  title: string;
  date: string;
  status: string;
  capacity: number;
  venue: { name: string };
  _count: { guestLists: number };
}

interface Guest {
  id: string;
  name: string | null;
  email: string;
  headcount: number;
  status: string;
  checkedInAt: string | null;
}

const field = "bg-bg border border-line rounded-lg px-3 py-2 text-sm outline-none focus:border-neon";

/**
 * Door mode: search the list by name or email and check people in without a QR
 * scanner. Built for a phone at the door: big row targets, one action per guest.
 */
export default function Door() {
  const [events, setEvents] = useState<EventRow[]>([]);
  const [eventId, setEventId] = useState("");
  const [guests, setGuests] = useState<Guest[]>([]);
  const [query, setQuery] = useState("");
  // Arriving from the palette: ?event= picks the night and ?q= pre-fills the search.
  const [requestedEvent, setRequestedEvent] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    setRequestedEvent(params.get("event"));
    const seeded = params.get("q");
    if (seeded) setQuery(seeded);
  }, []);

  useEffect(() => {
    api
      .get<EventRow[]>("/events/manage/list")
      .then((rows) => {
        const usable = rows.filter((e) => e.status === "approved" || e.status === "live" || e.status === "completed");
        setEvents(usable);
        const wanted = usable.find((e) => e.id === requestedEvent);
        if (wanted) setEventId(wanted.id);
        else if (usable[0]) setEventId(usable[0].id);
      })
      .catch((e) => setError(errorMessage(e) ?? "Could not load your events."));
  }, [requestedEvent]);

  const load = useCallback(async () => {
    if (!eventId) return;
    try {
      const q = query.trim();
      setGuests(await api.get<Guest[]>(`/events/${eventId}/guest-list${q ? `?q=${encodeURIComponent(q)}` : ""}`));
      setError(null);
    } catch (e) {
      setError(errorMessage(e) ?? "Could not load the door list.");
    }
  }, [eventId, query]);

  useEffect(() => {
    void load();
  }, [load]);

  const checkIn = async (guest: Guest) => {
    setBusyId(guest.id);
    setError(null);
    setNotice(null);
    try {
      const res = await api.post<{ result: string; guest: string | null }>(`/events/${eventId}/check-in-guest`, {
        guestListId: guest.id,
      });
      setNotice(
        res.result === "duplicate"
          ? `${res.guest ?? "That guest"} is already inside.`
          : `${res.guest ?? "Guest"} checked in.`,
      );
      await load();
    } catch (e) {
      setError(errorMessage(e) ?? "Could not check that guest in.");
    } finally {
      setBusyId(null);
    }
  };

  const selected = events.find((e) => e.id === eventId) ?? null;
  const inside = guests.filter((g) => g.status === "checked_in");
  const onList = guests.filter((g) => g.status !== "waitlisted");

  return (
    <>
      <TopNav />
      <main className="max-w-3xl mx-auto px-4 py-6 space-y-5">
        <div>
          <h1 className="text-2xl font-black tracking-wide">DOOR</h1>
          <p className="text-neutral-500 text-xs mt-1">
            Search the list by name or email and check guests in. QR scanning still works and logs to the same
            door log.
          </p>
        </div>

        {notice && <p className="text-neon text-sm">{notice}</p>}
        {error && <p className="text-red-400 text-sm">{error}</p>}

        <label className="block text-xs text-neutral-400 space-y-1">
          <span>Night</span>
          <select
            className={`${field} w-full`}
            value={eventId}
            onChange={(e) => {
              setEventId(e.target.value);
              setGuests([]);
              setNotice(null);
            }}
          >
            {events.map((e) => (
              <option key={e.id} value={e.id}>
                {e.title} — {new Date(e.date).toLocaleDateString()} @ {e.venue.name}
              </option>
            ))}
          </select>
        </label>

        {selected && (
          <div className="grid grid-cols-3 gap-3">
            <Stat label="On list" value={onList.length} />
            <Stat label="Inside" value={inside.length} />
            <Stat label="Capacity" value={selected.capacity} />
          </div>
        )}

        <div className="flex gap-2">
          <input
            className={`${field} flex-1`}
            placeholder="Search name or email"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            aria-label="Search the guest list"
          />
          <button onClick={() => load()} className="bg-neon text-bg font-black rounded-lg px-4 py-2 text-xs tracking-widest">
            SEARCH
          </button>
        </div>

        <div className="border border-line rounded-xl divide-y divide-line">
          {guests.map((g) => (
            <div key={g.id} className="px-4 py-3 flex flex-wrap items-center justify-between gap-2 text-sm">
              <div className="min-w-48">
                <p className="font-bold">
                  {g.name ?? g.email}
                  <span className="text-neutral-500 font-normal"> · {g.headcount}</span>
                </p>
                <p className="text-neutral-500 text-xs">{g.email}</p>
                <p className="text-xs text-neutral-600">
                  {g.status === "checked_in" && g.checkedInAt
                    ? `in since ${new Date(g.checkedInAt).toLocaleTimeString()}`
                    : g.status}
                </p>
              </div>
              {g.status === "checked_in" ? (
                <span className="text-neon text-xs font-bold tracking-widest">INSIDE</span>
              ) : (
                <button
                  onClick={() => checkIn(g)}
                  disabled={busyId === g.id}
                  className="bg-neon text-bg font-black rounded-lg px-4 py-2 text-xs tracking-widest disabled:opacity-40"
                >
                  {busyId === g.id ? "CHECKING…" : "CHECK IN"}
                </button>
              )}
            </div>
          ))}
          {!guests.length && <p className="px-4 py-6 text-center text-neutral-500 text-sm">No guests on this list.</p>}
        </div>
      </main>
    </>
  );
}
