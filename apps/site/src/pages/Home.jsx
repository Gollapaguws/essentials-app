import { useEffect } from "react";
import { useSiteContent } from "@/lib/useSiteContent";

import SiteNav from "@/components/SiteNav";
import HeroCinema from "@/components/HeroCinema";
import LineupStrip from "@/components/LineupStrip";
import DjShowcase from "@/components/DjShowcase";
import ManifestoQuote from "@/components/ManifestoQuote";
import LivePanel from "@/components/LivePanel";
import LiveChat from "@/components/LiveChat";
import SiteFooter from "@/components/SiteFooter";
import { setPageMeta } from "@/lib/share";

export default function Home() {
  const content = useSiteContent();
  // Also the catch-all route: landing here resets whatever the last page claimed.
  useEffect(() => {
    setPageMeta({});
  }, []);
  return (
    <div className="noir">
      <SiteNav />
      <main>
        <HeroCinema />
        <LivePanel idleLoop={content.idleLoop} />
        <LiveChat />
        <LineupStrip events={content.events} />
        <DjShowcase />
        <ManifestoQuote />
      </main>
      <SiteFooter />
    </div>
  );
}