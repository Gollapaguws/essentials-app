import SiteNav from "@/components/SiteNav";

/**
 * The door: one shell for sign in, sign up and the password screens. The brand
 * stub names the room, the form side is torn off at a dashed seam, and the
 * headings stay in the site's poster voice while the controls stay plain.
 */
export default function AuthLayout({ title, subtitle = null, footer = null, children }) {
  return (
    <div className="noir">
      <SiteNav />
      <main className="noir-door">
        <div className="noir-door-pass">
          <aside className="noir-door-brand">
            <p className="noir-door-mark">ESSENTIALS</p>
            <p className="noir-door-line">
              One list.
              <br />
              One door.
              <br />
              Every night.
            </p>
            <p className="noir-door-stamp">Admit one</p>
          </aside>

          <div className="noir-door-form">
            <h1 className="noir-door-title">{title}</h1>
            {subtitle && <p className="noir-door-sub">{subtitle}</p>}
            {children}
            {footer && <div className="noir-door-foot">{footer}</div>}
          </div>
        </div>
      </main>
    </div>
  );
}
