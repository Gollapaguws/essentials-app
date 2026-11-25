import CosmicBackdrop from "@/components/CosmicBackdrop";
import { useSiteContent } from "@/lib/useSiteContent";

/**
 * The front page's opening frame: the SONUS wordmark over a ringed orb, with the
 * two-line subtitle from the artwork. The next night's venue and city sit along
 * the bottom edge, where a poster carries its billing block. ESSENTIALS is the
 * parent company and SONUS the product, so the top bar carries the full mark and
 * the wordmark itself stays SONUS.
 */
export default function HeroCinema() {
  const c = useSiteContent();
  const next = c.events?.[0];
  const billingVenue = next?.venue ? `${next.venue} . ${next.city ?? c.city}` : c.city;

  return (
    <section id="top" className="noir-hero">
      <div className="noir-bar noir-bar-top">
        <span className="noir-micro">ESSENTIALS × SONUS</span>
        <span className="noir-micro">AMPLIFY THE SIGNAL</span>
        <span className="noir-micro">SEASON 07</span>
      </div>

      <div className="noir-stage sonus-stage">
        <CosmicBackdrop />

        <div className="sonus-lockup">
          <h1 className="noir-wm sonus-wm">
            <span className="sonus-wordmark">SONUS</span>
          </h1>
          <p className="sonus-sub">Amplify</p>
          <p className="sonus-sub sonus-sub-last">The Signal</p>
        </div>

        <div className="sonus-billing">
          <span className="noir-micro">{c.tagline}</span>
          <span className="noir-micro">{billingVenue}</span>
        </div>

        <a href="#contact" className="noir-btn sonus-cta">
          {c.ctaLabel}
        </a>
      </div>

      <div className="noir-bar noir-bar-bottom">
        <span className="noir-micro">{c.city}</span>
        <span className="noir-micro">24 FPS</span>
      </div>
    </section>
  );
}
