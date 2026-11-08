import { useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { fetchMe, openDashboard, signOut } from "@/lib/auth";

// Each label carries one line of plain description, so the menu says where it
// goes. Same-origin links with a hash keep working from the auth pages too: the
// router goes home, then ScrollToTop brings the section into view.
const links = [
  { label: "EVENTS", note: "Next nights, doors and tickets", to: { pathname: "/", hash: "#lineup" } },
  { label: "THE COLLECTIVE", note: "What the room is for", to: { pathname: "/", hash: "#collective" } },
  { label: "CONTACT", note: "Join the mailing list", to: { pathname: "/", hash: "#contact" } },
];

export default function SiteNav() {
  const [open, setOpen] = useState(false);
  const [me, setMe] = useState(null);
  const closeRef = useRef(null);

  useEffect(() => {
    const load = () => fetchMe().then(setMe);
    load();
    const onStorage = () => fetchMe().then(setMe);
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, []);

  // The overlay covers the page, so Escape closes it and the page behind it
  // holds still while it is open.
  useEffect(() => {
    if (!open) return;
    const onKey = (e) => {
      if (e.key === "Escape") setOpen(false);
    };
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    document.addEventListener("keydown", onKey);
    closeRef.current?.focus();
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = previousOverflow;
    };
  }, [open]);

  const role = me?.user?.role ?? null;
  const hasDashboard = Boolean(role && role !== "guest");

  const out = async () => {
    await signOut();
    setMe(null);
    setOpen(false);
  };

  return (
    <header className="noir-nav">
      <div className="noir-navbar">
        <Link to="/" className="noir-brand">
          ESSENTIALS
        </Link>
        <div className="noir-nav-actions">
          {hasDashboard && (
            <a
              href="/dashboard"
              className="noir-nav-quiet"
              onClick={(e) => {
                e.preventDefault();
                void openDashboard();
              }}
            >
              DASHBOARD
            </a>
          )}
          {!me && (
            <Link to="/login" className="noir-nav-quiet">
              SIGN IN
            </Link>
          )}
          <button
            type="button"
            onClick={() => setOpen(true)}
            className="noir-menu"
            aria-expanded={open}
            aria-controls="site-menu"
          >
            MENU
          </button>
        </div>
      </div>

      {open && (
        <div className="noir-overlay" id="site-menu" role="dialog" aria-modal="true" aria-label="Menu">
          <div className="noir-navbar">
            <span className="noir-brand">ESSENTIALS</span>
            <button ref={closeRef} type="button" onClick={() => setOpen(false)} aria-label="Close menu" className="noir-menu">
              CLOSE
            </button>
          </div>

          <nav className="noir-navlist">
            {links.map((link) => (
              <Link key={link.label} to={link.to} onClick={() => setOpen(false)} className="noir-navlink">
                {link.label}
                <span className="noir-navnote">{link.note}</span>
              </Link>
            ))}
            {hasDashboard && (
              <a
                href="/dashboard"
                onClick={(e) => {
                  e.preventDefault();
                  setOpen(false);
                  void openDashboard();
                }}
                className="noir-navlink"
              >
                DASHBOARD
                <span className="noir-navnote">Your dashboard tools</span>
              </a>
            )}
          </nav>

          <div className="noir-navfoot">
            {me ? (
              <>
                <span className="noir-navwho">Signed in as {me.user?.email}</span>
                <button type="button" onClick={out} className="noir-navquiet">
                  Sign out
                </button>
              </>
            ) : (
              <>
                <Link to="/login" onClick={() => setOpen(false)} className="noir-menu">
                  SIGN IN
                </Link>
                <Link to="/register" onClick={() => setOpen(false)} className="noir-navquiet">
                  Create a guest account
                </Link>
              </>
            )}
          </div>
        </div>
      )}
    </header>
  );
}
