import { useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import SiteNav from "@/components/SiteNav";
import SiteFooter from "@/components/SiteFooter";
import { setPageMeta, shareImage } from "@/lib/share";
import { API_BASE } from "@/lib/apiBase";

const API_URL = API_BASE;

const when = (date) => {
  const d = new Date(date);
  return `${d.toLocaleDateString(undefined, {
    weekday: "long",
    day: "numeric",
    month: "long",
  })} · ${d.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" })}`;
};

const ticketHref = (event) =>
  event.ticketUrl ??
  `mailto:bookings@essentials.co.za?subject=${encodeURIComponent(`Tickets — ${event.title}`)}`;

/**
 * Where guest emails land. Deliberately public: a promoter login in the middle
 * of a "your door pass" link loses the guest.
 */
export default function EventDetail() {
  const { id } = useParams();
  const [event, setEvent] = useState(null);
  const [state, setState] = useState("loading");

  useEffect(() => {
    let live = true;
    setState("loading");
    fetch(`${API_URL}/site/events/${encodeURIComponent(id)}`)
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
      .then((data) => {
        if (!live) return;
        setEvent(data);
        setState("ready");
      })
      .catch(() => live && setState("missing"));
    return () => {
      live = false;
    };
  }, [id]);

  // A night's link is usually shared, not searched: the unfurl has to carry the
  // night's own title, date and lineup.
  useEffect(() => {
    if (state === "missing") {
      setPageMeta({ title: "Night not found", path: "/events" });
      return;
    }
    if (!event) return;
    setPageMeta({
      title: event.title,
      description: [when(event.date), event.venue?.name, (event.artists ?? []).map((a) => a.name).join(", ")]
        .filter(Boolean)
        .join(" · "),
      image: shareImage(API_URL, "event", event.id),
      path: `/events/${event.id}`,
      type: "article",
    });
  }, [event, state]);

  return (
    <div className="noir">
      <SiteNav />
      <main>
        <section className="noir-sec">
          {state === "loading" && <p className="noir-note">Loading the room…</p>}

          {state === "missing" && (
            <>
              <span className="noir-micro">NOT ON SALE</span>
              <h1 className="noir-h2">THIS ROOM IS CLOSED.</h1>
              <p className="noir-note">
                That night is not available — it may be sold out, cancelled or moved. The rest of
                the season is on the lineup.
              </p>
              <Link to="/events" className="noir-btn">
                SEE THE LINEUP
              </Link>
            </>
          )}

          {state === "ready" && event && (
            <>
              <span className="noir-micro">{when(event.date)}</span>
              <h1 className="noir-h2">{event.title}</h1>

              <div className="noir-frame" style={{ maxWidth: 620, minHeight: 0, marginTop: 28 }}>
                <span className="noir-micro">
                  {event.venue?.name}
                  {event.venue?.address ? ` — ${event.venue.address}` : ""}
                </span>
                {event.dressCode && <span className="noir-micro">Dress code — {event.dressCode}</span>}
                <span className="noir-micro">
                  Going {event.going}
                  {event.capacity ? ` / ${event.capacity}` : ""}
                </span>
                <a href={ticketHref(event)} className="noir-ticket" target="_blank" rel="noreferrer">
                  {event.ticketUrl ? "TICKETS →" : "REQUEST TICKETS →"}
                </a>
              </div>

              {event.artists?.length > 0 ? (
                <>
                  <span className="noir-micro noir-lbl-block">CONFIRMED DJS</span>
                  <span className="noir-djs" style={{ maxWidth: 420, marginTop: 10 }}>
                    {event.artists.map((dj, i) => {
                      const key = `${dj.id ?? dj.name}-${i}`;
                      const content = (
                        <>
                          <span className="noir-dj-name">{dj.name}</span>
                          {dj.time && <span className="noir-dj-time">{dj.time}</span>}
                          {dj.role && (
                            <span className="noir-micro">
                              {dj.role}
                              {dj.bpm ? ` · ${dj.bpm} BPM` : ""}
                            </span>
                          )}
                        </>
                      );
                      return dj.id ? (
                        <Link className="noir-dj" key={key} to={`/djs/${dj.id}`}>
                          {content}
                        </Link>
                      ) : (
                        <span className="noir-dj" key={key}>
                          {content}
                        </span>
                      );
                    })}
                  </span>
                </>
              ) : (
                event.lineup?.length > 0 && (
                  <>
                    <span className="noir-micro noir-lbl-block">LINEUP</span>
                    {event.lineup.map((act, i) => (
                      <p key={`${act.artistName ?? act.name ?? i}`} className="noir-note" style={{ marginTop: 10 }}>
                        {act.artistName ?? act.name}
                        {act.slot ? ` · ${act.slot}` : ""}
                      </p>
                    ))}
                  </>
                )
              )}

              {event.description && <p className="noir-note">{event.description}</p>}

              <p className="noir-note">
                Your door pass lives in the SONUS app.{" "}
                <Link to="/register" className="noir-quiet-link">
                  Get on the list
                </Link>{" "}
                to RSVP and be counted at the door.
              </p>
            </>
          )}
        </section>
      </main>
      <SiteFooter />
    </div>
  );
}
