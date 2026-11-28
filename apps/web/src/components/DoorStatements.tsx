"use client";

import { useResource } from "@/hooks/useResource";
import { ConsolePage } from "@/components/console/ConsolePage";
import { PageHeader } from "@/components/console/PageHeader";
import { Panel } from "@/components/console/Panel";
import { Stat } from "@/components/Stat";
import { Badge } from "@/components/console/Badge";
import { DownloadButton } from "@/components/DownloadButton";

interface DoorShift {
  id: string;
  date: string;
  night: string;
  venue: string;
  fee: number;
  travel: number;
  travelEstimated: boolean;
  agreed: number;
  invoiced: number;
  paid: number;
  invoice: { number: string; status: string } | null;
}

interface DoorMonth {
  key: string;
  shifts: DoorShift[];
  shiftCount: number;
  fee: number;
  travel: number;
  agreed: number;
  invoiced: number;
  paid: number;
  outstanding: number;
}

interface DoorStatementsResponse {
  profile: { name: string | null; email: string };
  months: DoorMonth[];
  totals: {
    fee: number;
    travel: number;
    agreed: number;
    invoiced: number;
    paid: number;
    outstanding: number;
    shifts: number;
    months: number;
  };
}

interface DoorHostRow {
  key: string;
  shiftCount: number;
  agreed: number;
  invoiced: number;
  paid: number;
  outstanding: number;
}

interface DoorHost {
  id: string;
  name: string | null;
  email: string;
  shifts: DoorShift[];
  months: DoorHostRow[];
  agreed: number;
  invoiced: number;
  paid: number;
  outstanding: number;
}

interface PromoterDoorStatements {
  hosts: DoorHost[];
  totals: {
    hosts: number;
    shifts: number;
    agreed: number;
    invoiced: number;
    paid: number;
    outstanding: number;
  };
  page: { limit: number; offset: number; shown: number; total: number; hasMore: boolean };
}

const rand = (value: number) => `R${value.toLocaleString()}`;
const PAGE_SIZE = 200;

const monthLabel = (key: string) => {
  const date = new Date(`${key}-01T00:00:00Z`);
  return Number.isNaN(date.getTime())
    ? key
    : date.toLocaleDateString(undefined, { month: "long", year: "numeric", timeZone: "UTC" });
};

const moneyTone = (status: string) =>
  status === "paid" ? "text-neon" : status === "overdue" ? "text-alert" : "text-muted";

/** Door host: every confirmed or worked shift, grouped by month. */
export function DoorStatementsMine() {
  const source = useResource<DoorStatementsResponse>("/door-gigs/statements");
  const data = source.data;
  const noProfile = /door profile/i.test(source.error ?? "");
  const loadError = noProfile ? null : source.error;
  const totals = data?.totals;

  return (
    <ConsolePage size="lg">
      <PageHeader
        eyebrow="Door / Money"
        title="DOOR STATEMENTS"
        description="Every door shift you have been confirmed for, grouped by month: the fee, travel added on the invoice, and what the venue has paid."
        actions={<Badge tone="info">{totals?.shifts ?? 0} shifts</Badge>}
      />

      {loadError && (
        <p role="alert" className="text-alert text-sm">
          {loadError}
        </p>
      )}
      {noProfile && (
        <p className="border border-line bg-surface rounded-xl p-4 text-muted text-sm">
          Statements belong to a door profile. Add your address and bank details on the{" "}
          <a href="/door" className="text-neon hover:underline">
            Door
          </a>{" "}
          page to see your months here.
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
          ? `${totals.shifts} shift${totals.shifts === 1 ? "" : "s"} across ${totals.months} month${totals.months === 1 ? "" : "s"}`
          : "Loading…"}
      </p>
      <p className="text-faint text-[11px]">
        Travel on uninvoiced shifts is estimated from your home base at the platform rate; invoiced
        shifts show the amount that was billed.
      </p>

      {(data?.months ?? []).map((row) => (
        <Panel key={row.key}>
          <div className="flex flex-wrap items-center justify-between gap-3 border-b border-line pb-3">
            <div>
              <h2 className="text-sm font-bold uppercase tracking-wider">{monthLabel(row.key)}</h2>
              <p className="text-muted text-xs mt-1">
                {row.shiftCount} shift{row.shiftCount === 1 ? "" : "s"} · {rand(row.agreed)} agreed ·{" "}
                <span className="text-neon">{rand(row.paid)} paid</span> · {rand(row.outstanding)} owed
              </p>
            </div>
            <DownloadButton
              path={`/door-gigs/statements.csv?month=${row.key}`}
              filename={`door-statement-${row.key}.csv`}
              label="DOWNLOAD MONTH"
            />
          </div>
          <div className="overflow-x-auto -mx-1">
            <table className="w-full min-w-[640px] text-sm">
              <thead>
                <tr className="text-left text-[11px] uppercase tracking-widest text-muted">
                  <th className="px-1 py-2">Shift</th>
                  <th className="px-1 py-2 text-right">Fee</th>
                  <th className="px-1 py-2 text-right">Travel</th>
                  <th className="px-1 py-2 text-right">Invoiced</th>
                  <th className="px-1 py-2 text-right">Paid</th>
                  <th className="px-1 py-2">Invoice</th>
                </tr>
              </thead>
              <tbody>
                {row.shifts.map((shift) => (
                  <tr key={shift.id} className="border-t border-line align-top">
                    <td className="px-1 py-2">
                      <p className="font-bold">{shift.night}</p>
                      <p className="text-muted text-xs">
                        {shift.venue} · {new Date(shift.date).toLocaleDateString()}
                      </p>
                    </td>
                    <td className="px-1 py-2 text-right">{rand(shift.fee)}</td>
                    <td className="px-1 py-2 text-right text-muted">
                      {rand(shift.travel)}
                      {shift.travelEstimated && (
                        <span className="block text-[10px] text-faint">estimated</span>
                      )}
                    </td>
                    <td className="px-1 py-2 text-right">{rand(shift.invoiced)}</td>
                    <td className="px-1 py-2 text-right text-neon">{rand(shift.paid)}</td>
                    <td className="px-1 py-2 text-xs">
                      {shift.invoice ? (
                        <span className={moneyTone(shift.invoice.status)}>
                          {shift.invoice.number} · {shift.invoice.status}
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

      {data && !data.months.length && (
        <Panel>
          <p className="text-muted text-sm">
            No door statements yet. A shift lands here once a promoter confirms you for it.
          </p>
        </Panel>
      )}
    </ConsolePage>
  );
}

/** Promoter: one statement per door host across their nights. */
export function PromoterDoorStatementsPanel() {
  const source = useResource<PromoterDoorStatements>(
    `/door-gigs/statements/hosts?limit=${PAGE_SIZE}`,
  );
  const data = source.data;
  const totals = data?.totals;

  return (
    <Panel
      title="Door host statements"
      description="One statement per door host across your nights: agreed fees and travel, what was invoiced, paid, and still outstanding."
      flush
    >
      {source.error && (
        <p role="alert" className="border-b border-line/70 px-4 py-2 text-sm text-alert">
          {source.error}
        </p>
      )}
      <div className="space-y-4 px-4 py-3">
        {data?.page?.hasMore && (
          <p className="text-warn text-xs">
            Showing {data.page.shown} of {data.page.total} hosts. The totals cover all of them.
          </p>
        )}
        <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
          <Stat label="Agreed" value={rand(totals?.agreed ?? 0)} />
          <Stat label="Invoiced" value={rand(totals?.invoiced ?? 0)} />
          <Stat label="Paid" value={rand(totals?.paid ?? 0)} />
          <Stat label="Outstanding" value={rand(totals?.outstanding ?? 0)} />
        </div>

        {(data?.hosts ?? []).map((host) => (
          <div key={host.id} className="rounded-xl border border-line/70 p-3">
            <div className="flex flex-wrap items-start justify-between gap-2">
              <div>
                <h3 className="text-sm font-bold uppercase tracking-wider">
                  {host.name ?? host.email}
                </h3>
                <p className="text-muted text-xs mt-1">
                  {host.shifts.length} shift{host.shifts.length === 1 ? "" : "s"} · {rand(host.agreed)} agreed ·{" "}
                  <span className="text-neon">{rand(host.paid)} paid</span> · {rand(host.outstanding)} outstanding
                </p>
              </div>
              <DownloadButton
                path={`/door-gigs/statements.csv?profileId=${host.id}`}
                filename={`door-statement-${host.email.replace(/[^a-z0-9]+/gi, "-")}.csv`}
                label="DOWNLOAD"
              />
            </div>
            <div className="overflow-x-auto mt-3">
              <table className="w-full min-w-[520px] text-sm">
                <thead>
                  <tr className="text-left text-[11px] uppercase tracking-widest text-muted">
                    <th className="px-1 py-2">Month</th>
                    <th className="px-1 py-2 text-right">Shifts</th>
                    <th className="px-1 py-2 text-right">Agreed</th>
                    <th className="px-1 py-2 text-right">Invoiced</th>
                    <th className="px-1 py-2 text-right">Paid</th>
                    <th className="px-1 py-2 text-right">Outstanding</th>
                  </tr>
                </thead>
                <tbody>
                  {host.months.map((row) => (
                    <tr key={row.key} className="border-t border-line">
                      <td className="px-1 py-2">
                        <span className="font-bold">{monthLabel(row.key)}</span>
                        <DownloadButton
                          path={`/door-gigs/statements.csv?month=${row.key}&profileId=${host.id}`}
                          filename={`door-statement-${host.email.replace(/[^a-z0-9]+/gi, "-")}-${row.key}.csv`}
                          label="CSV"
                          className="ml-2 text-muted underline text-[11px]"
                        />
                      </td>
                      <td className="px-1 py-2 text-right">{row.shiftCount}</td>
                      <td className="px-1 py-2 text-right">{rand(row.agreed)}</td>
                      <td className="px-1 py-2 text-right">{rand(row.invoiced)}</td>
                      <td className="px-1 py-2 text-right text-neon">{rand(row.paid)}</td>
                      <td className="px-1 py-2 text-right">{rand(row.outstanding)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        ))}

        {data && !data.hosts.length && (
          <p className="px-1 py-4 text-center text-muted text-sm">
            No door statements yet. Once you confirm a door host for a night, their fees appear here.
          </p>
        )}
      </div>
    </Panel>
  );
}
