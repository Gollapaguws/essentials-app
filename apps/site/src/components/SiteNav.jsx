import { useState, useEffect } from "react";
import { Link } from "react-router-dom";
import { getToken, signOut } from "@/lib/auth";

const links = [
  { label: "EVENTS", href: "#lineup" },
  { label: "THE COLLECTIVE", href: "#collective" },
  { label: "THE VAULT", href: "#vault" },
  { label: "CONTACT", href: "#contact" },
];

export default function SiteNav() {
  const [open, setOpen] = useState(false);
  const [loggedIn, setLoggedIn] = useState(false);

  useEffect(() => {
    setLoggedIn(!!getToken());
    const onStorage = () => setLoggedIn(!!getToken());
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, []);

  const out = () => {
    signOut();
    setLoggedIn(false);
    setOpen(false);
  };

  const navList = (
    <nav className="noir-navlist">
      {links.map((link) => (
        <a key={link.href} href={link.href} onClick={() => setOpen(false)} className="noir-navlink">
          {link.label}
        </a>
      ))}
      {loggedIn ? (
        <button type="button" onClick={out} className="noir-navlink" style={{ background: "none", border: 0, color: "inherit", cursor: "pointer", textAlign: "left" }}>
          SIGN OUT
        </button>
      ) : (
        <Link to="/login" onClick={() => setOpen(false)} className="noir-navlink" style={{ color: "#FFD873" }}>
          SIGN IN
        </Link>
      )}
    </nav>
  );

  return (
    <header className="noir-nav">
      <div className="noir-navbar">
        <a href="#top" className="noir-brand">
          ESSENTIALS
        </a>
        <div style={{ display: "flex", alignItems: "center", gap: 16 }}>
          {!open && (
            loggedIn ? (
              <button type="button" onClick={out} className="noir-menu" style={{ letterSpacing: 2 }}>SIGN OUT</button>
            ) : (
              <Link to="/login" className="noir-menu" style={{ letterSpacing: 2, color: "#FFD873" }}>SIGN IN</Link>
            )
          )}
          <button type="button" onClick={() => setOpen(true)} className="noir-menu">
            MENU
          </button>
        </div>
      </div>

      {open && (
        <div className="noir-overlay">
          <div className="noir-navbar">
            <span className="noir-brand">ESSENTIALS</span>
            <button
              type="button"
              onClick={() => setOpen(false)}
              aria-label="Close menu"
              className="noir-menu"
            >
              CLOSE
            </button>
          </div>
          {navList}
        </div>
      )}
    </header>
  );
}
