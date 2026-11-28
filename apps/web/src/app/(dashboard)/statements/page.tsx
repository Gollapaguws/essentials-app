"use client";

import { useState } from "react";
import { api } from "@essentials/api-client";
import { errorMessage } from "@/lib/errors";
import { useResource } from "@/hooks/useResource";
import { useAuth } from "@/components/AuthProvider";
import { ConsolePage } from "@/components/console/ConsolePage";
import { PageHeader } from "@/components/console/PageHeader";
import { Panel } from "@/components/console/Panel";
import { Stat } from "@/components/Stat";
import { Badge } from "@/components/console/Badge";
import { DownloadButton } from "@/components/DownloadButton";
import {
  DoorStatementsMine,
  PromoterDoorStatementsPanel,
} from "@/components/DoorStatements";

interface StatementGig {
  id: string;
  startAt: string;
  night: string;
  venue: string;
  slot: string | null;
  fee: number;
  travel: number;
  travelEstimated: boolean;
  agreed: number;
  invoiced: number;
  paid: number;
  invoice: { number: string; status: string } | null;
}

interface StatementMonth {
  key: string;
  gigs: StatementGig[];
  gigCount: number;
  fee: number;
  travel: number;
  agreed: number;
  invoiced: number;
  paid: number;
  outstanding: number;
}

interface ArtistStatements {
  profile: { stageName: string };
  months: StatementMonth[];
  totals: {
    fee: number;
    travel: number;
    agreed: number;
    invoiced: number;
    paid: number;
    outstanding: number;
    gigs: number;
    months: number;
  };
}

interface DjMonthRow {
  key: string;
  gigCount: number;
  agreed: number;
  invoiced: number;
  paid: number;
  outstanding: number;
}

interface DjStatement {
  id: string;
  stageName: string;
  imageUrl: string | null;
  gigs: StatementGig[];
  months: DjMonthRow[];
  agreed: number;
  invoiced: number;
  paid: number;
  outstanding: number;
}

interface PromoterStatements {
  djs: DjStatement[];
  /** Present on the promoter view: which slice of the DJ list this is. */
  page?: { limit: number; offset: number; shown: number; total: number; hasMore: boolean };
  totals: {
    djs: number;
    gigs: number;
    agreed: number;
    invoiced: number;
    paid: number;
    outstanding: number;
  };
}

const rand = (value: number) => `R${value.toLocaleString()}`;

/** Matches MAX_PAGE_SIZE on the API: one page of DJs, never the whole client book. */
const PAGE_SIZE = 200;

const monthLabel = (key: string) => {
  const date = new Date(`${key}-01T00:00:00Z`);
  return Number.isNaN(date.getTime())
    ? key
    : date.toLocaleDateString(undefined, { month: "long", year: "numeric", timeZone: "UTC" });
};

const thisMonth = () => new Date().toISOString().slice(0, 7);

const slug = (value: string) =>
  value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");

const moneyTone = (status: string) =>
  status === "paid" ? "text-neon" : status === "overdue" ? "text-alert" : "text-muted";

/**
 * Statements for both sides of a gig: a DJ sees their own months, a promoter
 * sees one statement per DJ across their nights. Same data, different scope.
 */
export default function Statements() {
  const { me } = useAuth();
  const role = me?.user.role;
  const isDj = role === "artist";
  const isDoor = role === "door";

  // One resource per side of the desk; `null` keeps the unused one idle.
  const artistSource = useResource<ArtistStatements>(isDj ? "/artists/statements" : null);
  const promoterSource = useResource<PromoterStatements>(
    role === "promoter" || role === "admin"
      ? `/artists/statements/djs?limit=${PAGE_SIZE}`
      : null,
  );
  const artist = artistSource.data;
  const promoter = promoterSource.data;
  // A DJ without a profile gets the "create one" panel, not a red error.
  const noProfile = isDj && /artist profile/i.test(artistSource.error ?? "");
  const loadError = isDj ? (noProfile ? null : artistSource.error) : promoterSource.error;

  const [month, setMonth] = useState(thisMonth);
  const [error, setError] = useState<string | null>(null);
  const [sendingId, setSendingId] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const emailStatement = async (dj: DjStatement) => {
    setSendingId(dj.id);
    setError(null);
    setNotice(null);
    try {
      const result = await api.post<{ to: string }>("/artists/statements/email", {
        artistId: dj.id,
        month,
      });
      setNotice(`${monthLabel(month)} statement sent to ${dj.stageName} at ${result.to}.`);
    } catch (e) {
      setError(errorMessage(e) ?? "Could not email that statement.");
    } finally {
      setSendingId(null);
    }
  };

  // Door hosts have their own months and invoices — same page, different money.
  if (isDoor) return <DoorStatementsMine />;

  if (isDj) {
    const totals = artist?.totals;
    return (
      <ConsolePage size="lg">
        <PageHeader
          eyebrow="Stage / Money"
          title="STATEMENTS"
          description="Every gig you have been confirmed for, grouped by month: the fee, the travel added on the invoice, what the venue has paid, and what is still owed."
          actions={
            <div className="flex flex-wrap items-center gap-3">
              <label className="text-[10px] uppercase tracking-widest text-muted">
                Month
                <input
                  type="month"
                  value={month}
                  onChange={(e) => setMonth(e.target.value || month)}
                  className="ml-2 bg-bg border border-line rounded-lg px-2 py-1 text-xs text-muted"
                />
              </label>
              <DownloadButton
                path={`/artists/statements.csv?month=${month}`}
                filename={`statement-${month}.csv`}
                label="DOWNLOAD CSV"
              />
            </div>
          }
        />

        {(error ?? loadError) && (
          <p role="alert" className="text-alert text-sm">
            {error ?? loadError}
          </p>
        )}
        {noProfile && (
          <p className="border border-line bg-surface rounded-xl p-4 text-muted text-sm">
            Statements belong to a DJ profile. Create one on{" "}
            <a href="/artist/profile" className="text-neon hover:underline">
              My Profile
            </a>{" "}
            to see your months here.
          </p>
        )}

        <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
          <Stat label="Agreed" value={rand(totals?.agreed ?? 0)} />
          <Stat label="Invoiced" value={rand(totals?.invoiced ?? 0)} />
          <Stat label="Paid" value={rand(totals?.paid ?? 0)} />
          <Stat label="Still owed" value={rand(totals?.outstanding ?? 0)} />
        </div>

        <p className="text-muted text-xs">
          {totals
            ? `${totals.gigs} gig${totals.gigs === 1 ? "" : "s"} across ${totals.months} month${totals.months === 1 ? "" : "s"}`
            : "Loading…"}
        </p>
        <p className="text-faint text-[11px]">
          Travel on uninvoiced gigs is estimated from your home base at the platform rate; invoiced
          gigs show the amount that was billed. Add or fix your home base in My Profile to make the
          estimate accurate.
        </p>

        {(artist?.months ?? []).map((row) => (
          <Panel key={row.key}>
            <div className="flex flex-wrap items-center justify-between gap-3 border-b border-line pb-3">
              <div>
                <h2 className="text-sm font-bold uppercase tracking-wider">{monthLabel(row.key)}</h2>
                <p className="text-muted text-xs mt-1">
                  {row.gigCount} gig{row.gigCount === 1 ? "" : "s"} · {rand(row.agreed)} agreed ·{" "}
                  <span className="text-neon">{rand(row.paid)} paid</span> · {rand(row.outstanding)} owed
                </p>
              </div>
              <DownloadButton
                path={`/artists/statements.csv?month=${row.key}`}
                filename={`statement-${row.key}.csv`}
                label="DOWNLOAD MONTH"
              />
            </div>
            <div className="overflow-x-auto -mx-1">
              <table className="w-full min-w-[640px] text-sm">
                <thead>
                  <tr className="text-left text-[11px] uppercase tracking-widest text-muted">
                    <th className="px-1 py-2">Gig</th>
                    <th className="px-1 py-2 text-right">Fee</th>
                    <th className="px-1 py-2 text-right">Travel</th>
                    <th className="px-1 py-2 text-right">Invoiced</th>
                    <th className="px-1 py-2 text-right">Paid</th>
                    <th className="px-1 py-2">Invoice</th>
                  </tr>
                </thead>
                <tbody>
                  {row.gigs.map((gig) => (
                    <tr key={gig.id} className="border-t border-line align-top">
                      <td className="px-1 py-2">
                        <p className="font-bold">{gig.night}</p>
                        <p className="text-muted text-xs">
                          {gig.venue} · {new Date(gig.startAt).toLocaleDateString()}
                          {gig.slot ? ` · ${gig.slot}` : ""}
                        </p>
                      </td>
                      <td className="px-1 py-2 text-right">{rand(gig.fee)}</td>
                      <td className="px-1 py-2 text-right text-muted">
                        {rand(gig.travel)}
                        {gig.travelEstimated && (
                          <span className="block text-[10px] text-faint">estimated</span>
                        )}
                      </td>
                      <td className="px-1 py-2 text-right">{rand(gig.invoiced)}</td>
                      <td className="px-1 py-2 text-right text-neon">{rand(gig.paid)}</td>
                      <td className="px-1 py-2 text-xs">
                        {gig.invoice ? (
                          <span className={moneyTone(gig.invoice.status)}>
                            {gig.invoice.number} · {gig.invoice.status}
                          </span>
                        ) : (
                          <span className="text-warn">not invoiced</span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Panel>
        ))}

        {artist && !artist.months.length && (
          <Panel>
            <p className="text-muted text-sm">
              No statements yet. A gig lands here once a promoter confirms you for it.
              Travel on uninvoiced gigs is estimated from your home base.
            </p>
          </Panel>
        )}
      </ConsolePage>
    );
  }

  const totals = promoter?.totals;
  return (
    <ConsolePage size="lg">
      <PageHeader
        eyebrow="Night ops / Money"
        title="DJ STATEMENTS"
        description="One statement per DJ across your nights: what was agreed, what the DJ has invoiced, what the venue has paid, and what is still outstanding."
        actions={
          <div className="flex flex-wrap items-center gap-3">
            <Badge tone="info">{totals?.djs ?? 0} DJs</Badge>
            <label className="text-[10px] uppercase tracking-widest text-muted">
              Statement month
              <input
                type="month"
                value={month}
                onChange={(e) => setMonth(e.target.value || month)}
                className="ml-2 bg-bg border border-line rounded-lg px-2 py-1 text-xs text-muted"
              />
            </label>
          </div>
        }
      />

      {(error ?? loadError) && (
        <p role="alert" className="text-alert text-sm">
          {error ?? loadError}
        </p>
      )}
      {notice && <p className="text-neon text-sm">{notice}</p>}
      {promoter?.page?.hasMore && (
        <p className="text-warn text-xs">
          Showing {promoter.page.shown} of {promoter.page.total} DJs. The totals above cover all of them.
        </p>
      )}

      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <Stat label="Agreed" value={rand(totals?.agreed ?? 0)} />
        <Stat label="Invoiced" value={rand(totals?.invoiced ?? 0)} />
        <Stat label="Paid" value={rand(totals?.paid ?? 0)} />
        <Stat label="Outstanding" value={rand(totals?.outstanding ?? 0)} />
      </div>

      <div className="space-y-3">
        {(promoter?.djs ?? []).map((dj) => (
          <Panel key={dj.id}>
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <h2 className="text-sm font-bold uppercase tracking-wider">{dj.stageName}</h2>
                <p className="text-muted text-xs mt-1">
                  {dj.gigs.length} gig{dj.gigs.length === 1 ? "" : "s"} · {rand(dj.agreed)} agreed ·{" "}
                  <span className="text-neon">{rand(dj.paid)} paid</span> · {rand(dj.outstanding)} outstanding
                </p>
              </div>
              <div className="flex flex-wrap items-center gap-3">
                <button
                  type="button"
                  onClick={() => void emailStatement(dj)}
                  disabled={sendingId === dj.id}
                  title={`Email ${dj.stageName} their ${monthLabel(month)} statement`}
                  className="border border-neon/40 text-neon rounded-lg px-3 py-1.5 text-[11px] font-bold tracking-widest disabled:opacity-40"
                >
                  {sendingId === dj.id ? "SENDING…" : "EMAIL MONTH"}
                </button>
                <DownloadButton
                  path={`/artists/statements.csv?month=${month}&artistId=${dj.id}`}
                  filename={`statement-${slug(dj.stageName)}-${month}.csv`}
                  label="DOWNLOAD MONTH"
                />
              </div>
            </div>

            <div className="overflow-x-auto mt-3">
              <table className="w-full min-w-[560px] text-sm">
                <thead>
                  <tr className="text-left text-[11px] uppercase tracking-widest text-muted">
                    <th className="px-1 py-2">Month</th>
                    <th className="px-1 py-2 text-right">Gigs</th>
                    <th className="px-1 py-2 text-right">Agreed</th>
                    <th className="px-1 py-2 text-right">Invoiced</th>
                    <th className="px-1 py-2 text-right">Paid</th>
                    <th className="px-1 py-2 text-right">Outstanding</th>
                  </tr>
                </thead>
                <tbody>
                  {dj.months.map((row) => (
                    <tr key={row.key} className="border-t border-line">
                      <td className="px-1 py-2">
                        <span className="font-bold">{monthLabel(row.key)}</span>
                        <DownloadButton
                          path={`/artists/statements.csv?month=${row.key}&artistId=${dj.id}`}
                          filename={`statement-${slug(dj.stageName)}-${row.key}.csv`}
                          label="CSV"
                          className="ml-2 text-muted underline text-[11px]"
                        />
                      </td>
                      <td className="px-1 py-2 text-right">{row.gigCount}</td>
                      <td className="px-1 py-2 text-right">{rand(row.agreed)}</td>
                      <td className="px-1 py-2 text-right">{rand(row.invoiced)}</td>
                      <td className="px-1 py-2 text-right text-neon">{rand(row.paid)}</td>
                      <td className="px-1 py-2 text-right">{rand(row.outstanding)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Panel>
        ))}
      </div>

      {promoter && !promoter.djs.length && (
        <Panel>
          <p className="text-muted text-sm">
            No DJ statements yet. Once you confirm a DJ for a night, their fees appear here.
          </p>
        </Panel>
      )}

      <PromoterDoorStatementsPanel />
    </ConsolePage>
  );
}
