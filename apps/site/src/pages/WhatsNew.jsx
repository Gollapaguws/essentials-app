import { useEffect, useState } from "react";
import { Link, Navigate } from "react-router-dom";
import SiteNav from "@/components/SiteNav";
import SiteFooter from "@/components/SiteFooter";
import { useAuth } from "@/lib/AuthContext";

const API_URL = import.meta.env.VITE_API_URL ?? "https://essentialsedm.com/api";

/** Newest first; the page stays short even when the changelog grows. */
const RELEASES_SHOWN = 3;

const day = (date) =>
  new Date(date).toLocaleDateString("en-GB", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  }).toUpperCase();

const Shell = ({ children }) => (
  <div className="noir">
    <SiteNav />
    <main>
      <section className="noir-sec">{children}</section>
    </main>
    <SiteFooter />
  </div>
);

/** Release notes, read from CHANGELOG.md by the API on every request. */
function Notes() {
  const [releases, setReleases] = useState([]);
  const [state, setState] = useState("loading");

  useEffect(() => {
    let alive = true;
    fetch(`${API_URL}/site/changelog`)
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
      .then((data) => {
        if (!alive) return;
        const rows = Array.isArray(data?.releases) ? data.releases : [];
        setReleases(rows.slice(0, RELEASES_SHOWN));
        setState("ready");
      })
      .catch(() => alive && setState("error"));
    return () => {
      alive = false;
    };
  }, []);

  if (state === "loading") return <p className="noir-note">Loading the notes…</p>;

  if (state === "error") {
    return (
      <p className="noir-note">
        The notes could not load just now.{" "}
        <button type="button" onClick={() => window.location.reload()} className="noir-quiet-link">
          Try again
        </button>
      </p>
    );
  }

  if (!releases.length) {
    return (
      <p className="noir-note">
        Nothing has been published yet.{" "}
        <Link to="/events" className="noir-quiet-link">
          See the lineup
        </Link>{" "}
        in the meantime.
      </p>
    );
  }

  return releases.map((release) => (
    <article key={release.date} className="noir-frame" style={{ maxWidth: 760, marginTop: 24 }}>
      <span className="noir-micro">{day(release.date)}</span>
      {release.sections.map((section) => (
        <div key={section.title} style={{ marginTop: 18 }}>
          <h3 className="noir-frame-title">{section.title}</h3>
          <ul style={{ display: "grid", gap: 10, margin: "10px 0 0", paddingLeft: 18 }}>
            {section.items.map((item) => (
              <li key={`${section.title}-${item.text.slice(0, 40)}`} className="noir-note" style={{ margin: 0 }}>
                {item.title && <strong>{item.title}</strong>}
                {item.title ? " " : ""}
                {item.text}
              </li>
            ))}
          </ul>
        </div>
      ))}
    </article>
  ));
}

export default function WhatsNew() {
  const { isAuthenticated, isLoadingAuth, authChecked, role } = useAuth();

  if (isLoadingAuth || !authChecked) {
    return (
      <div className="noir" style={{ minHeight: "100vh", display: "grid", placeItems: "center" }}>
        <span className="noir-micro">CHECKING SESSION</span>
      </div>
    );
  }
  if (!isAuthenticated) return <Navigate to="/login" replace />;

  // Members only. A guest account gets a straight answer instead of a bounce.
  if (!role || role === "guest") {
    return (
      <Shell>
        <div className="noir-sec-head">
          <span className="noir-micro">MEMBERS ONLY</span>
          <h1 className="noir-h2">THIS DOOR IS FOR MEMBERS</h1>
        </div>
        <p className="noir-note" style={{ maxWidth: 620 }}>
          What&apos;s new is where we post what has changed for DJs, promoters and venue managers.
          Your account is still a guest one, so the notes are not open to you yet — ask us to
          switch it over and they appear at your next sign-in.
        </p>
        <p className="noir-note">
          <Link to="/events" className="noir-quiet-link">
            See the lineup
          </Link>{" "}
          or{" "}
          <Link to="/login" className="noir-quiet-link">
            sign in with another account
          </Link>
          .
        </p>
      </Shell>
    );
  }

  return (
    <Shell>
      <div className="noir-sec-head">
        <span className="noir-micro">SEASON 07</span>
        <h1 className="noir-h2">WHAT&apos;S NEW</h1>
      </div>

      <p className="noir-note">
        Straight from the release notes: every change that has landed, newest first. This page
        builds itself, so what you read here is what shipped.
      </p>

      <Notes />
    </Shell>
  );
}
