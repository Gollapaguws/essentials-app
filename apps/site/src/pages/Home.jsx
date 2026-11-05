import { useSiteContent } from "@/lib/useSiteContent";

import SiteNav from "@/components/SiteNav";
import HeroCinema from "@/components/HeroCinema";
import LineupStrip from "@/components/LineupStrip";
import ManifestoQuote from "@/components/ManifestoQuote";
import LivePanel from "@/components/LivePanel";
import LiveChat from "@/components/LiveChat";
import SiteFooter from "@/components/SiteFooter";

export default function Home() {
  const content = useSiteContent();
  return (
    <div className="noir">
      <SiteNav />
      <main>
        <HeroCinema />
        <LivePanel />
        <LiveChat />
        <LineupStrip events={content.events} />
        <ManifestoQuote />
      </main>
      <SiteFooter />
    </div>
  );
}