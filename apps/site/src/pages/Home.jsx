import SiteNav from "@/components/SiteNav";
import HeroCinema from "@/components/HeroCinema";
import LineupStrip from "@/components/LineupStrip";
import ManifestoQuote from "@/components/ManifestoQuote";
import SiteFooter from "@/components/SiteFooter";

export default function Home() {
  return (
    <div className="noir">
      <SiteNav />
      <main>
        <HeroCinema />
        <LineupStrip />
        <ManifestoQuote />
      </main>
      <SiteFooter />
    </div>
  );
}