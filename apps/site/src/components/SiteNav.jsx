import { useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { fetchMe, openDashboard, signOut } from "@/lib/auth";
import { API_BASE } from "@/lib/apiBase";

// Each label carries one line of plain description, so the menu says where it
// goes. Same-origin links with a hash keep working from the auth pages too: the
// router goes home, then ScrollToTop brings the section into view.
const links = [
  { label: "EVENTS", note: "Next nights, doors and tickets", to: { pathname: "/", hash: "#lineup" } },
  { label: "THE DJS", note: "The roster and their profiles", to: { pathname: "/", hash: "#djs" } },
  { label: "THE COLLECTIVE", note: "What the room is for", to: { pathname: "/", hash: "#collective" } },
  { label: "CONTACT", note: "Where to find us", to: { pathname: "/", hash: "#contact" } },
  { label: "WHAT'S NEW", note: "What has landed lately", to: { pathname: "/whats-new" }, member: true },
  { label: "PRIVACY", note: "What we hold and your rights", to: { pathname: "/privacy" } },
];

const INSTALL_DISMISSED_KEY = "essentials-install-banner-dismissed";
const API_URL = API_BASE;

const trackInstallEvent = (name) => {
  void fetch(`${API_URL}/site/event`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name }),
    keepalive: true,
  }).catch(() => {});
};

const isStandalone = () => {
  if (typeof window === "undefined") return false;
  const standaloneDisplay = window.matchMedia?.("(display-mode: standalone)")?.matches;
  const standalone = /** @type {Navigator & { standalone?: boolean }} */ (window.navigator)
    .standalone;
  return Boolean(standaloneDisplay || standalone);
};

const getInstallStep = () => {
  if (typeof navigator === "undefined") return null;
  const ua = navigator.userAgent;
  const isIOS =
    /iPad|iPhone|iPod/.test(ua) ||
    (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);

  if (isIOS) return "Open in Safari, tap Share, then Add to Home Screen.";
  if (/Android/.test(ua)) return "Open in Chrome, tap the menu, then Install app.";
  return "Open this page in Safari or Chrome, then add it to your home screen.";
};

export default function SiteNav() {
  const [open, setOpen] = useState(false);
  const [me, setMe] = useState(null);
  const [showInstall, setShowInstall] = useState(() => {
    if (typeof window === "undefined" || isStandalone()) return false;
    try {
      return window.localStorage.getItem(INSTALL_DISMISSED_KEY) !== "1";
    } catch {
      return true;
    }
  });
  const [installPrompt, setInstallPrompt] = useState(null);
  const closeRef = useRef(null);

  const dismissInstall = () => {
    trackInstallEvent("install_banner_dismiss");
    setShowInstall(false);
    try {
      window.localStorage.setItem(INSTALL_DISMISSED_KEY, "1");
    } catch {
      // Private browsing can reject writes; dismissing still works this visit.
    }
  };

  const installApp = async () => {
    if (!installPrompt) return;
    trackInstallEvent("install_prompt_open");
    try {
      await installPrompt.prompt();
      const choice = await installPrompt.userChoice;
      if (choice?.outcome === "accepted") setShowInstall(false);
    } catch {
      // The prompt can only be opened once; keep the written instructions visible.
    } finally {
      setInstallPrompt(null);
    }
  };

  // Chrome fires this only when the PWA meets its install criteria. Keeping the
  // event lets the banner offer the native install sheet instead of instructions.
  useEffect(() => {
    const onPrompt = (event) => {
      event.preventDefault();
      setInstallPrompt(event);
    };
    const onInstalled = () => {
      trackInstallEvent("app_install");
      setShowInstall(false);
    };
    window.addEventListener("beforeinstallprompt", onPrompt);
    window.addEventListener("appinstalled", onInstalled);
    return () => {
      window.removeEventListener("beforeinstallprompt", onPrompt);
      window.removeEventListener("appinstalled", onInstalled);
    };
  }, []);

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
  // Member-only pages stay out of the menu for signed-out and guest accounts.
  const visibleLinks = links.filter((link) => !link.member || hasDashboard);

  const out = async () => {
    await signOut();
    setMe(null);
    setOpen(false);
  };

  return (
    <header className="noir-nav">
      {showInstall && (
        <div className="noir-install" role="region" aria-label="Install the SONUS app">
          <div className="noir-install-copy">
            <span className="noir-install-kicker">INSTALL SONUS</span>
            <p className="noir-install-text">
              {installPrompt
                ? "Install for full-screen access and quicker launches."
                : getInstallStep()}
            </p>
          </div>
          <div className="noir-install-actions">
            {installPrompt && (
              <button type="button" className="noir-install-btn" onClick={installApp}>
                INSTALL
              </button>
            )}
            <button
              type="button"
              className="noir-install-close"
              onClick={dismissInstall}
              aria-label="Dismiss install instructions"
            >
              <span aria-hidden="true">×</span>
            </button>
          </div>
        </div>
      )}
      <div className="noir-navbar">
        <Link to="/" className="noir-brand">
          SONUS
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
            <span className="noir-brand">SONUS</span>
            <button ref={closeRef} type="button" onClick={() => setOpen(false)} aria-label="Close menu" className="noir-menu">
              CLOSE
            </button>
          </div>

          <nav className="noir-navlist">
            {visibleLinks.map((link) => (
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
