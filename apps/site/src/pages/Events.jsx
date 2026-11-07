import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import SiteNav from "@/components/SiteNav";
import SiteFooter from "@/components/SiteFooter";

const API_URL = import.meta.env.VITE_API_URL ?? "https://essentialsedm.com/api";

const when = (date) =>
  new Date(date).toLocaleDateString(undefined, {
    weekday: "short",
    day: "numeric",
    month: "short",
  });

/** Public lineup: every announced night, readable without an account. */
export default function Events() {
  const [events, setEvents] = useState([]);
  const [state, setState] = useState("loading");

  useEffect(() => {
    fetch(`${API_URL}/site/events`)
      .then((r) => (r.ok ? r.json() : []))
      .then((rows) => {
        setEvents(Array.isArray(rows) ? rows : []);
        setState("ready");
      })
      .catch(() => setState("error"));
  }, []);

  return (
    <div className="noir">
      <SiteNav />
      <main>
        <section className="noir-sec">
          <div className="noir-sec-head">
            <span className="noir-micro">SEASON 07</span>
            <h1 className="noir-h2">THE LINEUP</h1>
          </div>

          {state === "loading" && <p className="noir-note">Loading the rooms…</p>}

          {state === "error" && (
            <p className="noir-note">
              The lineup could not load just now.{" "}
              <button
                type="button"
                onClick={() => window.location.reload()}
                className="noir-quiet-link"
              >
                Try again
              </button>
            </p>
          )}

          {state === "ready" && !events.length && (
            <p className="noir-note">
              No dates are on sale right now. Get on the list and you will hear about the next
              room before anyone else.
            </p>
          )}

          {events.length > 0 && (
            <div className="noir-strip">
              {events.map((event) => (
                <Link key={event.id} to={`/events/${event.id}`} className="noir-frame">
                  <span className="noir-scan" aria-hidden="true" />
                  <span className="noir-micro">{when(event.date)}</span>
                  <span className="noir-frame-title">{event.title}</span>
                  <span className="noir-micro">
                    {event.venue?.name}
                    {event.venue?.address ? ` — ${event.venue.address}` : ""}
                  </span>
                  <span className="noir-frame-meta">
                    <span className="noir-micro">Going {event.going}</span>
                    <span className="noir-micro">{String(event.status ?? "").toUpperCase()}</span>
                  </span>
                  <span className="noir-ticket">VIEW THE NIGHT →</span>
                </Link>
              ))}
            </div>
          )}
        </section>
      </main>
      <SiteFooter />
    </div>
  );
}
