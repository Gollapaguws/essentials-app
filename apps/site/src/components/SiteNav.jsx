import { useState } from "react";

const links = [
  { label: "EVENTS", href: "#lineup" },
  { label: "THE COLLECTIVE", href: "#collective" },
  { label: "THE VAULT", href: "#vault" },
  { label: "CONTACT", href: "#contact" },
];

export default function SiteNav() {
  const [open, setOpen] = useState(false);

  return (
    <header className="noir-nav">
      <div className="noir-navbar">
        <a href="#top" className="noir-brand">
          ESSENTIALS
        </a>
        <button type="button" onClick={() => setOpen(true)} className="noir-menu">
          MENU
        </button>
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
          <nav className="noir-navlist">
            {links.map((link) => (
              <a
                key={link.href}
                href={link.href}
                onClick={() => setOpen(false)}
                className="noir-navlink"
              >
                {link.label}
              </a>
            ))}
          </nav>
        </div>
      )}
    </header>
  );
}