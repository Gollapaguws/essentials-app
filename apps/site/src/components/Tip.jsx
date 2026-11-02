import { useState } from "react";

/**
 * Hover/focus tooltip for the noir site. Inline styles + local state, because the
 * site's theme is hand-written CSS rather than Tailwind utilities.
 */
export default function Tip({ label, children, width = 240, style = {} }) {
  const [open, setOpen] = useState(false);

  return (
    <span
      style={{ position: "relative", display: "inline-flex", ...style }}
      onMouseEnter={() => setOpen(true)}
      onMouseLeave={() => setOpen(false)}
      onFocus={() => setOpen(true)}
      onBlur={() => setOpen(false)}
    >
      {children}
      {open && (
        <span
          role="tooltip"
          style={{
            position: "absolute",
            top: "calc(100% + 8px)",
            left: 0,
            zIndex: 40,
            width,
            padding: "10px 12px",
            borderRadius: 8,
            border: "1px solid rgba(255,255,255,.16)",
            background: "#141414",
            color: "#e5e5e5",
            fontSize: 12,
            lineHeight: 1.5,
            textAlign: "left",
            letterSpacing: 0,
            boxShadow: "0 12px 30px rgba(0,0,0,.6)",
            pointerEvents: "none",
          }}
        >
          {label}
        </span>
      )}
    </span>
  );
}
