"use client";

import { useEffect, useState } from "react";
import { TopNav } from "@/components/TopNav";
import { Stat } from "@/components/Stat";
import { OverviewCharts } from "@/components/OverviewCharts";
import { api } from "@essentials/api-client";

interface Overview {
  totals: { events: number; rsvps: number; checkedIn: number; waitlisted: number; noShowRate: number; listToDoorConversion: number; tableRevenue: number };
  perEvent: { name: string; rsvps: number; door: number; noShows: number; tableRevenue: number; conversion: number }[];
  perVenue: { venue: string; events: number; tableRevenue: number; rsvps: number }[];
}

export default function Dashboard() {
  const [data, setData] = useState<Overview | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api.get<Overview>("/analytics/overview").then(setData).catch((e) => setError("Sign in first (start at /) — " + e.message));
  }, []);

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
            <OverviewCharts perEvent={data.perEvent} />
          </>
        )}
      </main>
    </>
  );
}
