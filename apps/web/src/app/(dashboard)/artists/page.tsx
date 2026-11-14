"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { api } from "@essentials/api-client";
import { errorMessage } from "@/lib/errors";
import { ConsolePage } from "@/components/console/ConsolePage";
import { PageHeader } from "@/components/console/PageHeader";
import { Panel } from "@/components/console/Panel";

interface UpcomingGig {
  id: string;
  slot: string | null;
  startAt: string;
  event: { title: string; date: string; venue: { name: string } };
}

interface Artist {
  id: string;
  stageName: string;
  bio: string | null;
  imageUrl: string | null;
  travelRatePerKm: number;
  user: { name: string | null; email: string };
  confirmedGigs: number;
  upcomingGigs: UpcomingGig[];
}

/** Promoter: the DJ roster, so an application can be judged against who is free and what they cost. */
export default function ArtistRoster() {
  const [artists, setArtists] = useState<Artist[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api.get<Artist[]>("/artists").then(setArtists).catch((e) => setError(errorMessage(e)));
  }, []);

  return (
    <ConsolePage size="xl">
      <PageHeader
        eyebrow="Night ops / Roster"
        title="ARTISTS"
        description="Every DJ on the roster, with their travel rate and the gigs they are already locked into."
      />
      {error && <p className="text-red-400 text-sm">{error}</p>}

      <Panel flush>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[760px] text-sm">
            <thead className="bg-surface text-neutral-400 uppercase text-xs">
              <tr>
                <th className="text-left px-4 py-3">DJ</th>
                <th className="text-left px-4 py-3">Contact</th>
                <th className="text-left px-4 py-3">Travel</th>
                <th className="text-left px-4 py-3">Confirmed</th>
                <th className="text-left px-4 py-3">Next up</th>
              </tr>
            </thead>
            <tbody>
              {artists.map((a) => (
                <tr key={a.id} className="border-t border-line align-top">
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-3">
                      <div className="w-10 h-10 rounded-full bg-surface border border-line overflow-hidden shrink-0">
                        {a.imageUrl && (
                          <img src={a.imageUrl} alt={a.stageName} className="w-full h-full object-cover" />
                        )}
                      </div>
                      <div>
                        <Link href={`/artists/${a.id}`} className="font-bold hover:text-neon">
                          {a.stageName}
                        </Link>
                        {a.bio && <p className="text-neutral-500 text-xs max-w-xs line-clamp-2">{a.bio}</p>}
                      </div>
                    </div>
                  </td>
                  <td className="px-4 py-3 text-neutral-400">
                    <p>{a.user.name ?? "—"}</p>
                    <p className="text-xs">{a.user.email}</p>
                  </td>
                  <td className="px-4 py-3">R{a.travelRatePerKm.toLocaleString()}/km</td>
                  <td className="px-4 py-3">{a.confirmedGigs}</td>
                  <td className="px-4 py-3 text-neutral-400">
                    {a.upcomingGigs.length ? (
                      a.upcomingGigs.map((g) => (
                        <p key={g.id} className="text-xs">
                          {new Date(g.startAt).toLocaleDateString()} · {g.event.title} at {g.event.venue.name}
                          {g.slot ? ` · ${g.slot}` : ""}
                        </p>
                      ))
                    ) : (
                      <span className="text-xs">No gigs booked</span>
                    )}
                  </td>
                </tr>
              ))}
              {!artists.length && (
                <tr>
                  <td colSpan={5} className="px-4 py-6 text-center text-neutral-500">
                    No DJs have created a profile yet.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </Panel>
    </ConsolePage>
  );
}
