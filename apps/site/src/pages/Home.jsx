import { useEffect } from "react";
import { Navigate, useLocation } from "react-router-dom";
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
  const { search } = useLocation();
  // Also the catch-all route: landing here resets whatever the last page claimed.
  useEffect(() => {
    setPageMeta({});
  }, []);

  // GoTrue sends a failed or cancelled OAuth sign-in to the site root rather
  // than to the callback it was given (?error=access_denied&error_description=…).
  // Without this the visitor simply lands on the front page, signed out, with
  // nothing to say why — AuthCallback is the screen that explains it.
  const oauthError = new URLSearchParams(search).get("error");
  if (oauthError) return <Navigate to={`/auth/callback${search}`} replace />;

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