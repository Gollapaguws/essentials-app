"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { TopNav } from "@/components/TopNav";
import { useAuth } from "@/components/AuthProvider";
import { Stat } from "@/components/Stat";
import { OverviewCharts } from "@/components/OverviewCharts";
import { api } from "@essentials/api-client";
import { errorMessage } from "@/lib/errors";

interface PacingRow { eventId: string; title: string; rsvps: number; previousRsvps: number | null; ratio: number | null; alert: boolean }
interface Overview {
  totals: { events: number; rsvps: number; checkedIn: number; waitlisted: number; noShowRate: number; listToDoorConversion: number };
  perEvent: { name: string; rsvps: number; door: number; noShows: number; conversion: number }[];
  perVenue: { venue: string; events: number; rsvps: number }[];
}

export default function Dashboard() {
  const { me } = useAuth();
  const router = useRouter();
  const [data, setData] = useState<Overview | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Analytics is the promoter view; a DJ or venue manager who lands here is
  // sent to the page their role actually owns instead of a 403.
  useEffect(() => {
    const role = me?.user.role;
    if (role === "artist") router.replace("/artist");
    else if (role === "venue_manager") router.replace("/venue");
  }, [me, router]);

  const [pacing, setPacing] = useState<PacingRow[]>([]);
  useEffect(() => {
    // Analytics is promoter/admin data; other roles get redirected by the layout,
    // so don't fire requests that can only answer 403.
    const role = me?.user.role;
    if (role && role !== "promoter" && role !== "admin") return;
    api.get<Overview>("/analytics/overview").then(setData).catch((e) => setError(errorMessage(e)));
    api.get<PacingRow[]>("/analytics/pacing").then((rows) => setPacing(rows.filter((r) => r.alert))).catch(() => {});
  }, [me]);

  return (
    <>
      <TopNav />
      <main className="max-w-6xl mx-auto px-6 py-8 space-y-8">
        <h1 className="text-2xl font-black tracking-wide">ANALYTICS OVERVIEW</h1>
        {error && <p className="text-red-400 text-sm">{error}</p>}
        {data && (
          <>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
              <Stat label="Events" value={data.totals.events} />
              <Stat label="RSVPs" value={data.totals.rsvps} />
              <Stat label="Door (checked in)" value={data.totals.checkedIn} />
              <Stat label="No-show rate" value={`${data.totals.noShowRate}%`} />
              <Stat label="List→Door conversion" value={`${data.totals.listToDoorConversion}%`} />
              <Stat label="Waitlisted" value={data.totals.waitlisted} />
            </div>
            {pacing.length > 0 && (
              <div className="border border-red-500/40 bg-red-500/5 rounded-xl p-4">
                <h2 className="text-sm font-bold text-red-400 uppercase tracking-wider mb-2">PACING ALERTS - RSVPs ahead of previous event x2</h2>
                {pacing.map((r) => (
                  <p key={r.eventId} className="text-sm">{r.title}: {r.rsvps} vs {r.previousRsvps} last time ({r.ratio}x)</p>
                ))}
              </div>
            )}
            <OverviewCharts perEvent={data.perEvent} />
          </>
        )}
      </main>
    </>
  );
}
