import { useEffect, useState } from "react";
import { Link } from "react-router-dom";

const API_URL = import.meta.env.VITE_API_URL ?? "https://essentialsedm.com/api";

const initials = (name = "") =>
  name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((word) => word[0])
    .join("")
    .toUpperCase();

/**
 * The public roster, photo first. Profiles are public, so every card here is a
 * link into /djs/:id — the same page the lineup cards point at.
 */
export default function DjShowcase() {
  const [djs, setDjs] = useState([]);

  useEffect(() => {
    fetch(`${API_URL}/site/djs`)
      .then((r) => (r.ok ? r.json() : []))
      .then((rows) => setDjs(Array.isArray(rows) ? rows : []))
      .catch(() => {});
  }, []);

  if (!djs.length) return null;

  return (
    <section id="djs" className="noir-sec">
      <div className="noir-sec-head">
        <span className="noir-micro">THE ROSTER</span>
        <h2 className="noir-h2">THE DJS</h2>
      </div>
      <p className="noir-note">
        The artists we build rooms around. Read who they are, then find the night they play next.
      </p>

      <div className="noir-dj-grid">
        {djs.map((dj) => (
          <Link key={dj.id} to={`/djs/${dj.id}`} className="noir-dj-card">
            <span className="noir-dj-photo">
              {dj.imageUrl ? (
                <img src={dj.imageUrl} alt={dj.stageName} loading="lazy" />
              ) : (
                <span className="noir-dj-mono" aria-hidden="true">
                  {initials(dj.stageName)}
                </span>
              )}
            </span>
            <span className="noir-dj-cardname">{dj.stageName}</span>
            {dj.bio ? (
              <span className="noir-dj-bio">{dj.bio}</span>
            ) : (
              <span className="noir-micro noir-dj-cardnote">PROFILE SOON</span>
            )}
            <span className="noir-micro noir-dj-cardnote">
              {dj.upcoming > 0
                ? `${dj.upcoming} UPCOMING SET${dj.upcoming === 1 ? "" : "S"}`
                : "AVAILABLE FOR BOOKING"}
            </span>
          </Link>
        ))}
      </div>
    </section>
  );
}
