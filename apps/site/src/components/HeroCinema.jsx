import GoldWordmark from "@/components/GoldWordmark";
import HeroSlider from "@/components/HeroSlider";
import { slides } from "@/data/siteContent";
import { useSiteContent } from "@/lib/useSiteContent";

export default function HeroCinema() {
  const c = useSiteContent();
  return (
    <section id="top" className="noir-hero">
      <div className="noir-bar noir-bar-top">
        <span className="noir-micro">ROLL 07</span>
        <span className="noir-micro">ALL SOUND. NO FILLER.</span>
        <span className="noir-micro">SEASON 07</span>
      </div>

      <div className="noir-stage">
        <HeroSlider slides={slides} />

        <h1 className="noir-wm">
          <GoldWordmark text="ESSENTIALS" />
        </h1>
        <p className="noir-tag">{c.tagline}</p>
        <a href="#contact" className="noir-btn">
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