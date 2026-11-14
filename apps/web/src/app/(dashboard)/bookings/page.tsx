"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { TopNav } from "@/components/TopNav";
import { useAuth } from "@/components/AuthProvider";
import { api } from "@essentials/api-client";
import { errorMessage } from "@/lib/errors";

interface Booking {
  id: string;
  title: string | null;
  startsAt: string;
  endsAt: string;
}

interface Draft {
  date: string;
  start: string;
  end: string;
  title: string;
}

const pad = (n: number) => String(n).padStart(2, "0");
const dateKey = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const timeLabel = (iso: string) =>
  new Date(iso).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
const dayLabel = (iso: string) =>
  new Date(iso).toLocaleDateString(undefined, { weekday: "short", day: "numeric", month: "short" });

/** A sensible starting point: the next full hour, two hours long. */
function nextSlot(): Draft {
  const start = new Date(Date.now() + 60 * 60 * 1000);
  start.setMinutes(0, 0, 0);
  const end = new Date(start.getTime() + 2 * 60 * 60 * 1000);
  return {
    date: dateKey(start),
    start: `${pad(start.getHours())}:00`,
    end: `${pad(end.getHours())}:00`,
    title: "",
  };
}

const WEEKDAYS = ["MON", "TUE", "WED", "THU", "FRI", "SAT", "SUN"];

/** DJ: the live calendar of windows in which Go Live is allowed to broadcast. */
export default function BookingCalendar() {
  const { me } = useAuth();
  const role = me?.user.role ?? "guest";

  const [bookings, setBookings] = useState<Booking[]>([]);
  const [loading, setLoading] = useState(true);
  const [noProfile, setNoProfile] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const [month, setMonth] = useState(() => {
    const now = new Date();
    return new Date(now.getFullYear(), now.getMonth(), 1);
  });
  // Initialised from the clock once; changing the month leaves the draft alone.
  const [draft, setDraft] = useState<Draft>(nextSlot);

  const load = useCallback(async () => {
    try {
      setBookings(await api.get<Booking[]>("/live/bookings"));
      setNoProfile(false);
    } catch (e) {
      const message = errorMessage(e);
      // A DJ without a profile has nothing to book from; point at My Profile.
      if (/artist profile/i.test(message)) setNoProfile(true);
      else setError(message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const book = async (event: React.FormEvent) => {
    event.preventDefault();
    setError(null);
    setNotice(null);
    const startsAt = new Date(`${draft.date}T${draft.start}:00`);
    let endsAt = new Date(`${draft.date}T${draft.end}:00`);
    if (Number.isNaN(startsAt.getTime()) || Number.isNaN(endsAt.getTime())) {
      setError("Pick a valid date and time.");
      return;
    }
    // An end earlier than the start is a set that runs past midnight.
    if (endsAt <= startsAt) endsAt = new Date(endsAt.getTime() + 24 * 60 * 60 * 1000);

    setSaving(true);
    try {
      await api.post("/live/bookings", {
        startsAt: startsAt.toISOString(),
        endsAt: endsAt.toISOString(),
        title: draft.title.trim() || undefined,
      });
      setNotice(
        `Booked for ${dayLabel(startsAt.toISOString())}, ${timeLabel(startsAt.toISOString())}–${timeLabel(endsAt.toISOString())}. Go Live unlocks inside that window.`,
      );
      setDraft((current) => ({ ...current, title: "" }));
      await load();
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setSaving(false);
    }
  };

  const cancel = async (booking: Booking) => {
    if (!window.confirm(`Cancel the session on ${dayLabel(booking.startsAt)}?`)) return;
    setError(null);
    setNotice(null);
    try {
      await api.del(`/live/bookings/${booking.id}`);
      await load();
    } catch (e) {
      setError(errorMessage(e));
    }
  };

  const bookingsByDay = useMemo(() => {
    const map = new Map<string, Booking[]>();
    for (const booking of bookings) {
      const key = dateKey(new Date(booking.startsAt));
      map.set(key, [...(map.get(key) ?? []), booking]);
    }
    return map;
  }, [bookings]);

  const daysInMonth = new Date(month.getFullYear(), month.getMonth() + 1, 0).getDate();
  // Monday-first grid, the way a week is read here.
  const leading = (new Date(month.getFullYear(), month.getMonth(), 1).getDay() + 6) % 7;
  const cells: (number | null)[] = [
    ...Array.from({ length: leading }, () => null),
    ...Array.from({ length: daysInMonth }, (_, i) => i + 1),
  ];
  const todayKey = dateKey(new Date());
  const minDate = todayKey;
  const now = Date.now();

  if (role === "admin") {
    return (
      <>
        <TopNav />
        <main className="max-w-4xl mx-auto px-6 py-8 space-y-4">
          <h1 className="text-2xl font-black tracking-wide">LIVE CALENDAR</h1>
          <p className="border border-line bg-surface rounded-xl p-4 text-neutral-400 text-sm">
            Admin accounts broadcast without a booking, so there is no calendar to keep here.
            DJs book their own stream windows, and Go Live is refused outside them.
          </p>
          <Link href="/go-live" className="inline-block text-neon text-sm hover:underline">
            Go to Go Live →
          </Link>
        </main>
      </>
    );
  }

  return (
    <>
      <TopNav />
      <main className="max-w-5xl mx-auto px-6 py-8 space-y-6">
        <div>
          <h1 className="text-2xl font-black tracking-wide">LIVE CALENDAR</h1>
          <p className="text-neutral-500 text-xs mt-1">
            Book the windows you will broadcast in. <strong className="text-neutral-300">Go Live is
            refused outside a booked session</strong>, so create one before your set starts. Each
            session can be up to 12 hours, and two of your sessions cannot overlap.
          </p>
        </div>

        {notice && <p className="text-neon text-sm">{notice}</p>}
        {error && <p className="text-red-400 text-sm">{error}</p>}

        {noProfile && (
          <p className="border border-line bg-surface rounded-xl p-4 text-neutral-400 text-sm">
            Live sessions belong to a DJ profile. Create one on{" "}
            <Link href="/artist/profile" className="text-neon hover:underline">
              My Profile
            </Link>{" "}
            before booking a window.
          </p>
        )}

        <div className="grid lg:grid-cols-[1.25fr_1fr] gap-4 items-start">
          <section className="border border-line bg-surface rounded-xl p-4 space-y-3">
            <div className="flex items-center justify-between gap-2">
              <button
                type="button"
                onClick={() => setMonth(new Date(month.getFullYear(), month.getMonth() - 1, 1))}
                className="border border-line rounded-lg px-2 py-1 text-xs text-neutral-400 hover:text-white"
                aria-label="Previous month"
              >
                ←
              </button>
              <p className="font-black tracking-widest text-sm">
                {month.toLocaleDateString(undefined, { month: "long", year: "numeric" }).toUpperCase()}
              </p>
              <button
                type="button"
                onClick={() => setMonth(new Date(month.getFullYear(), month.getMonth() + 1, 1))}
                className="border border-line rounded-lg px-2 py-1 text-xs text-neutral-400 hover:text-white"
                aria-label="Next month"
              >
                →
              </button>
            </div>

            <div className="grid grid-cols-7 gap-1 text-center text-[10px] tracking-widest text-neutral-500">
              {WEEKDAYS.map((day) => (
                <span key={day} className="py-1">
                  {day}
                </span>
              ))}
            </div>

            <div className="grid grid-cols-7 gap-1">
              {cells.map((day, index) => {
                if (day === null) return <span key={`blank-${index}`} />;
                const key = dateKey(new Date(month.getFullYear(), month.getMonth(), day));
                const count = bookingsByDay.get(key)?.length ?? 0;
                const selected = draft.date === key;
                const past = key < todayKey;
                return (
                  <button
                    key={key}
                    type="button"
                    disabled={past}
                    onClick={() => setDraft((current) => ({ ...current, date: key }))}
                    title={
                      count
                        ? `${count} booked session${count === 1 ? "" : "s"}`
                        : "Book this day"
                    }
                    className={`relative aspect-square rounded-lg border text-sm transition ${
                      selected
                        ? "border-neon text-neon font-bold"
                        : key === todayKey
                          ? "border-neutral-500 text-white"
                          : "border-transparent text-neutral-300 hover:border-line"
                    } disabled:text-neutral-700 disabled:hover:border-transparent`}
                  >
                    {day}
                    {count > 0 && (
                      <span className="absolute bottom-1 left-1/2 -translate-x-1/2 flex gap-0.5">
                        {Array.from({ length: Math.min(count, 3) }, (_, dot) => (
                          <span key={dot} className="w-1 h-1 rounded-full bg-neon" />
                        ))}
                      </span>
                    )}
                  </button>
                );
              })}
            </div>

            <p className="text-neutral-600 text-[11px]">
              Dots mark days with a booked session. Pick a day to load it into the form.
            </p>
          </section>

          <section className="border border-line bg-surface rounded-xl p-4 space-y-3">
            <h2 className="text-sm font-bold uppercase tracking-wider">Book a session</h2>
            <form onSubmit={book} className="space-y-3">
              <label className="block">
                <span className="text-[10px] uppercase tracking-widest text-neutral-500">Date</span>
                <input
                  type="date"
                  required
                  min={minDate}
                  value={draft.date}
                  onChange={(e) => setDraft({ ...draft, date: e.target.value })}
                  className="w-full mt-1 bg-bg border border-line rounded-lg px-3 py-2 text-sm"
                />
              </label>
              <div className="grid grid-cols-2 gap-2">
                <label className="block">
                  <span className="text-[10px] uppercase tracking-widest text-neutral-500">Starts</span>
                  <input
                    type="time"
                    required
                    value={draft.start}
                    onChange={(e) => setDraft({ ...draft, start: e.target.value })}
                    className="w-full mt-1 bg-bg border border-line rounded-lg px-3 py-2 text-sm"
                  />
                </label>
                <label className="block">
                  <span className="text-[10px] uppercase tracking-widest text-neutral-500">Ends</span>
                  <input
                    type="time"
                    required
                    value={draft.end}
                    onChange={(e) => setDraft({ ...draft, end: e.target.value })}
                    className="w-full mt-1 bg-bg border border-line rounded-lg px-3 py-2 text-sm"
                  />
                </label>
              </div>
              <label className="block">
                <span className="text-[10px] uppercase tracking-widest text-neutral-500">
                  Title (optional)
                </span>
                <input
                  maxLength={80}
                  placeholder="Friday warm-up"
                  value={draft.title}
                  onChange={(e) => setDraft({ ...draft, title: e.target.value })}
                  className="w-full mt-1 bg-bg border border-line rounded-lg px-3 py-2 text-sm"
                />
              </label>
              <p className="text-neutral-600 text-[11px]">
                An end time earlier than the start is treated as the next day, so 20:00–02:00
                works.
              </p>
              <button
                disabled={saving || noProfile}
                className="w-full bg-neon text-bg font-black rounded-lg py-2 text-xs tracking-widest disabled:opacity-40"
              >
                {saving ? "BOOKING…" : "BOOK SESSION"}
              </button>
            </form>
          </section>
        </div>

        <section className="border border-line bg-surface rounded-xl overflow-hidden">
          <div className="px-4 py-3 border-b border-line flex items-center justify-between gap-3">
            <h2 className="text-sm font-bold uppercase tracking-wider">Your sessions</h2>
            <Link href="/go-live" className="text-neon text-xs hover:underline">
              Go Live →
            </Link>
          </div>
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-[11px] uppercase tracking-widest text-neutral-500">
                <th className="px-4 py-2">When</th>
                <th className="px-4 py-2">Session</th>
                <th className="px-4 py-2">Status</th>
                <th className="px-4 py-2"></th>
              </tr>
            </thead>
            <tbody>
              {bookings.map((booking) => {
                const start = new Date(booking.startsAt);
                const end = new Date(booking.endsAt);
                const liveNow = now >= start.getTime() && now < end.getTime();
                return (
                  <tr key={booking.id} className="border-t border-line align-top">
                    <td className="px-4 py-3">
                      <p className="font-bold">{dayLabel(booking.startsAt)}</p>
                      <p className="text-neutral-500 text-xs">
                        {timeLabel(booking.startsAt)}–{timeLabel(booking.endsAt)}
                      </p>
                    </td>
                    <td className="px-4 py-3 text-neutral-300">
                      {booking.title || <span className="text-neutral-600">Live session</span>}
                    </td>
                    <td className="px-4 py-3">
                      {liveNow ? (
                        <span className="text-neon font-bold text-xs">● LIVE NOW</span>
                      ) : (
                        <span className="text-neutral-500 text-xs">
                          in{" "}
                          {Math.max(1, Math.round((start.getTime() - now) / 3_600_000))}h
                        </span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-right">
                      <button
                        type="button"
                        onClick={() => void cancel(booking)}
                        className="text-red-400 underline text-xs"
                      >
                        Cancel
                      </button>
                    </td>
                  </tr>
                );
              })}
              {!loading && !bookings.length && (
                <tr>
                  <td colSpan={4} className="px-4 py-8 text-center text-neutral-500">
                    No sessions booked yet. Pick a day on the calendar and book a window — without
                    one, Go Live will refuse to start.
                  </td>
                </tr>
              )}
              {loading && (
                <tr>
                  <td colSpan={4} className="px-4 py-8 text-center text-neutral-500">
                    Loading…
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </section>
      </main>
    </>
  );
}
