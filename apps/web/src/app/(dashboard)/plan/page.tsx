"use client";

import { TopNav } from "@/components/TopNav";
import { useAuth } from "@/components/AuthProvider";
import { useResource } from "@/hooks/useResource";

interface UsageRow {
  metric: string;
  used: number;
  limit: number | null;
  remaining: number | null;
}

interface Summary {
  organisation: { id: string; name: string; slug: string; kind: string; hub: string | null } | null;
  subscription: {
    status: string;
    provider: string | null;
    currentPeriodStart: string;
    currentPeriodEnd: string;
    cancelAtPeriodEnd: boolean;
  } | null;
  plan: { key: string; name: string; priceZar: number; entitlements: Record<string, number> } | null;
  period: { start: string; end: string };
  usage: UsageRow[];
}

interface Workspace extends Summary {
  members: number;
}

interface Overview {
  workspaces: Workspace[];
  generatedAt: string;
}

interface PlanRow {
  id: string;
  key: string;
  name: string;
  priceZar: number;
  entitlements: Record<string, number>;
  hub: { slug: string; name: string };
}

const METRIC_LABEL: Record<string, string> = {
  "email.sends": "email sends",
  "email.contacts": "contacts",
  "social.publishes": "social posts",
  "social.accounts": "social accounts",
  "viewing.sessions": "viewing sessions",
};

const KIND_LABEL: Record<string, string> = {
  platform: "Platform",
  promoter: "Promoter",
  venue: "Venue",
  artist: "Artist",
};

const STATUS_CLASS: Record<string, string> = {
  active: "text-neon",
  trialing: "text-warn",
  past_due: "text-alert",
  cancelled: "text-muted",
};

const metricLabel = (metric: string) => METRIC_LABEL[metric] ?? metric.replace(/[._]/g, " ");
const rand = (cents: number) => (cents === 0 ? "Free" : `R${(cents / 100).toLocaleString("en-ZA")}`);
const day = (iso: string) =>
  new Date(iso).toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" });

/** A meter is only alarming near its limit; an unlimited metric has no bar worth drawing. */
function barClass(used: number, limit: number | null): string {
  if (limit === null || limit <= 0) return "bg-line";
  const share = used / limit;
  if (share >= 1) return "bg-red-500";
  if (share >= 0.8) return "bg-yellow-400";
  return "bg-neon";
}

function UsageCell({ rows }: { rows: UsageRow[] }) {
  if (!rows.length) return <span className="text-muted text-xs">No metered use yet</span>;
  return (
    <div className="space-y-1.5 min-w-40">
      {rows.map((row) => (
        <div key={row.metric}>
          <div className="flex justify-between gap-3 text-xs">
            <span className="text-muted">{metricLabel(row.metric)}</span>
            <span className="text-muted font-mono">
              {row.used}
              {row.limit === null ? "" : ` / ${row.limit}`}
            </span>
          </div>
          {row.limit !== null && row.limit > 0 && (
            <div className="h-1 mt-1 rounded bg-line overflow-hidden">
              <div
                className={`h-full ${barClass(row.used, row.limit)}`}
                style={{ width: `${Math.min(100, Math.round((row.used / row.limit) * 100))}%` }}
              />
            </div>
          )}
        </div>
      ))}
    </div>
  );
}

/**
 * Admin: every workspace's plan, period and counters. Read-only by design —
 * Phase 1 has no checkout, so the screen answers "what is this workspace on and
 * what has it used" and nothing else.
 */
export default function PlanAndUsage() {
  const { me } = useAuth();
  const isAdmin = me?.user.role === "admin";
  const overview = useResource<Overview>(isAdmin ? "/billing/overview" : null);
  const plans = useResource<PlanRow[]>(isAdmin ? "/billing/plans" : null);

  const workspaces = overview.data?.workspaces ?? [];
  const planRows = plans.data ?? [];
  const comped = workspaces.filter((w) => w.subscription?.provider === "comp").length;
  const metered = workspaces.filter((w) => w.usage.length > 0).length;
  const error = overview.error ?? plans.error;
  const loading = overview.loading || plans.loading;

  return (
    <>
      <TopNav />
      <main className="max-w-6xl mx-auto px-6 py-8 space-y-8">
        <div>
          <h1 className="text-2xl font-black tracking-wide">PLAN &amp; USAGE</h1>
          <p className="text-muted text-xs mt-1">
            Every workspace&apos;s plan, billing period and usage counters. Nothing is charged: no
            checkout and no payment provider are wired yet, and existing workspaces are comped for a
            year. Prices are the launch hypotheses from the vision document, not settled prices.
          </p>
        </div>

        {!isAdmin && me && <p className="text-muted text-sm">Admins only.</p>}
        {error && (
          <p role="alert" className="text-alert text-sm">
            {error}
          </p>
        )}
        {loading && <p className="text-muted text-xs">Loading plans and usage…</p>}

        {isAdmin && !loading && (
          <>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              <div className="border border-line rounded-xl p-4">
                <div className="text-3xl font-black">{workspaces.length}</div>
                <div className="text-muted text-xs uppercase tracking-widest mt-1">Workspaces</div>
              </div>
              <div className="border border-line rounded-xl p-4">
                <div className="text-3xl font-black">{comped}</div>
                <div className="text-muted text-xs uppercase tracking-widest mt-1">Comped plans</div>
              </div>
              <div className="border border-line rounded-xl p-4">
                <div className="text-3xl font-black">{metered}</div>
                <div className="text-muted text-xs uppercase tracking-widest mt-1">
                  Workspaces with metered use
                </div>
              </div>
            </div>

            <div className="border border-line rounded-xl overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-surface text-muted uppercase text-xs">
                  <tr>
                    <th className="text-left px-4 py-3">Workspace</th>
                    <th className="text-left px-4 py-3">Type</th>
                    <th className="text-left px-4 py-3">Plan</th>
                    <th className="text-left px-4 py-3">Status</th>
                    <th className="text-left px-4 py-3">Period ends</th>
                    <th className="text-left px-4 py-3">Usage this period</th>
                    <th className="text-right px-4 py-3">Members</th>
                  </tr>
                </thead>
                <tbody>
                  {workspaces.map((ws) => (
                    <tr key={ws.organisation?.id ?? ws.organisation?.slug} className="border-t border-line align-top">
                      <td className="px-4 py-3">
                        <span className="font-bold">{ws.organisation?.name ?? "—"}</span>
                        <span className="block text-muted text-xs font-mono">
                          {ws.organisation?.slug}
                          {ws.organisation?.hub ? ` · ${ws.organisation.hub}` : ""}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-xs text-muted">
                        {KIND_LABEL[ws.organisation?.kind ?? ""] ?? ws.organisation?.kind ?? "—"}
                      </td>
                      <td className="px-4 py-3 text-xs">
                        {ws.plan ? (
                          <>
                            <span className="text-muted">{ws.plan.name}</span>
                            <span className="block text-muted font-mono">{ws.plan.key}</span>
                          </>
                        ) : (
                          <span className="text-muted">No plan</span>
                        )}
                      </td>
                      <td
                        className={`px-4 py-3 text-xs font-bold ${
                          STATUS_CLASS[ws.subscription?.status ?? ""] ?? "text-muted"
                        }`}
                      >
                        {ws.subscription?.status ?? "—"}
                        {ws.subscription?.provider && (
                          <span className="block text-muted font-normal">{ws.subscription.provider}</span>
                        )}
                      </td>
                      <td className="px-4 py-3 text-xs text-muted whitespace-nowrap">
                        {day(ws.period.end)}
                        {ws.subscription?.cancelAtPeriodEnd && (
                          <span className="block text-warn">cancels</span>
                        )}
                      </td>
                      <td className="px-4 py-3">
                        <UsageCell rows={ws.usage} />
                      </td>
                      <td className="px-4 py-3 text-right text-xs text-muted">{ws.members}</td>
                    </tr>
                  ))}
                  {!workspaces.length && (
                    <tr>
                      <td colSpan={7} className="px-4 py-6 text-center text-muted">
                        No workspaces yet.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>

            <div className="space-y-3">
              <h2 className="text-sm font-black tracking-widest text-muted uppercase">Plans on the EDM hub</h2>
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
                {planRows.map((plan) => (
                  <div key={plan.id} className="border border-line rounded-xl p-4 space-y-2">
                    <div className="flex items-baseline justify-between gap-3">
                      <span className="font-bold">{plan.name}</span>
                      <span className="font-mono text-sm text-neon">{rand(plan.priceZar)}</span>
                    </div>
                    <div className="text-muted text-xs font-mono">{plan.key}</div>
                    <div className="flex flex-wrap gap-1.5 pt-1">
                      {Object.entries(plan.entitlements).map(([metric, limit]) => (
                        <span
                          key={metric}
                          className="text-[10px] uppercase tracking-wide border border-line rounded px-1.5 py-0.5 text-muted"
                        >
                          {metricLabel(metric)}: {limit}
                        </span>
                      ))}
                      {!Object.keys(plan.entitlements).length && (
                        <span className="text-muted text-xs">No metered allowances</span>
                      )}
                    </div>
                  </div>
                ))}
                {!planRows.length && !plans.loading && (
                  <p className="text-muted text-xs">No plans seeded on this hub.</p>
                )}
              </div>
            </div>
          </>
        )}
      </main>
    </>
  );
}
