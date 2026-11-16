import { useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import SiteNav from "@/components/SiteNav";
import SiteFooter from "@/components/SiteFooter";

const API_URL = import.meta.env.VITE_API_URL ?? "https://essentialsedm.com/api";

const when = (date) =>
  new Date(date).toLocaleDateString(undefined, {
    weekday: "short",
    day: "numeric",
    month: "short",
  });

const initials = (name = "") =>
  name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((word) => word[0])
    .join("")
    .toUpperCase();

/** A DJ's public page: photo, bio and the announced nights they play. */
export default function DjProfile() {
  const { id } = useParams();
  const [dj, setDj] = useState(null);
  const [state, setState] = useState("loading");

  useEffect(() => {
    let live = true;
    setState("loading");
    fetch(`${API_URL}/site/djs/${encodeURIComponent(id)}`)
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
      .then((data) => {
        if (!live) return;
        setDj(data);
        setState("ready");
      })
      .catch(() => live && setState("missing"));
    return () => {
      live = false;
    };
  }, [id]);

  return (
    <div className="noir">
      <SiteNav />
      <main>
        <section className="noir-sec">
          {state === "loading" && <p className="noir-note">Loading the profile…</p>}

          {state === "missing" && (
            <>
              <span className="noir-micro">NOT ON THE ROSTER</span>
              <h1 className="noir-h2">THIS DJ IS UNAVAILABLE.</h1>
              <p className="noir-note">
                That profile does not exist or has been removed. The current roster is on the front
                page.
              </p>
              <Link to="/" className="noir-btn">
                SEE THE ROSTER
              </Link>
            </>
          )}

          {state === "ready" && dj && (
            <>
              <Link to="/#djs" className="noir-quiet-link">
                ← THE ROSTER
              </Link>

              <div className="noir-dj-profile">
                <div className="noir-dj-portrait">
                  {dj.imageUrl ? (
                    <img src={dj.imageUrl} alt={dj.stageName} />
                  ) : (
                    <span className="noir-dj-mono" aria-hidden="true">
                      {initials(dj.stageName)}
                    </span>
                  )}
                </div>

                <div>
                  <span className="noir-micro">ESSENTIALS DJ</span>
                  <h1 className="noir-h2">{dj.stageName}</h1>
                  {dj.bio ? (
                    <p className="noir-note">{dj.bio}</p>
                  ) : (
                    <p className="noir-note">Profile coming soon.</p>
                  )}

                  <span className="noir-micro noir-lbl-block">UPCOMING SETS</span>
                  {dj.sets?.length > 0 ? (
                    <div className="noir-dj-sets">
                      {dj.sets.map((set) => (
                        <Link key={`${set.eventId}-${set.time}`} to={`/events/${set.eventId}`} className="noir-dj-set">
                          <span className="noir-dj-setdate">{when(set.date)}</span>
                          <span className="noir-dj-setname">{set.title}</span>
                          <span className="noir-micro">
                            {set.venue?.name}
                            {set.time ? ` · ${set.time}` : ""}
                          </span>
                        </Link>
                      ))}
                    </div>
                  ) : (
                    <p className="noir-note">
                      No announced dates right now.{" "}
                      <Link to="/#contact" className="noir-quiet-link">
                        Get on the list
                      </Link>{" "}
                      to hear when the next one is.
                    </p>
                  )}

                  <a
                    href={`mailto:bookings@essentials.co.za?subject=${encodeURIComponent(
                      `Booking — ${dj.stageName}`
                    )}`}
                    className="noir-btn"
                  >
                    BOOK {dj.stageName.toUpperCase()}
                  </a>
                </div>
              </div>
            </>
          )}
        </section>
      </main>
      <SiteFooter />
    </div>
  );
}
