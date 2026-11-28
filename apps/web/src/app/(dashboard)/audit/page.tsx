"use client";

import { TopNav } from "@/components/TopNav";
import { useAuth } from "@/components/AuthProvider";
import { useResource } from "@/hooks/useResource";

interface AuditRow {
  id: string;
  kind: string;
  email: string | null;
  userId: string | null;
  ip: string | null;
  meta: Record<string, unknown>;
  createdAt: string;
}

const KIND_CLASS: Record<string, string> = {
  sign_in: "text-muted",
  lazy_link: "text-muted",
  role_change: "text-warn",
  mfa_enrolled: "text-neon",
  mfa_escalated: "text-alert",
  mfa_reset: "text-warn",
  mfa_disabled: "text-warn",
  mfa_reenabled: "text-neon",
};

const KIND_LABEL: Record<string, string> = {
  sign_in: "sign in",
  lazy_link: "account linked",
  role_change: "role change",
  mfa_enrolled: "MFA enrolled",
  mfa_escalated: "MFA verified",
  mfa_reset: "MFA reset (admin)",
  mfa_disabled: "2FA disabled (admin)",
  mfa_reenabled: "2FA required again",
};

/** A reset row is readable at a glance: what was removed, who was signed out. */
function describeReset(meta: Record<string, unknown>): string {
  const factors = Array.isArray(meta.factors)
    ? meta.factors.length
    : meta.factorType
      ? 1
      : 0;
  const sessions = typeof meta.sessionsRevoked === "number" ? meta.sessionsRevoked : null;
  const plural = (n: number, one: string) => `${n} ${one}${n === 1 ? "" : "s"}`;
  return [
    `${plural(factors, "authenticator")} removed`,
    sessions === null ? null : `${plural(sessions, "session")} ended`,
  ]
    .filter(Boolean)
    .join(" · ");
}

/** Admin: who signed in, whose role changed, who enrolled MFA — newest first. */
export default function Audit() {
  const { me } = useAuth();
  const isAdmin = me?.user.role === "admin";
  // Nobody else can read the trail, so the request is not made at all.
  const { data, error, loading } = useResource<AuditRow[]>(
    isAdmin ? "/auth/audit?limit=200" : null,
  );
  const rows = data ?? [];

  return (
    <>
      <TopNav />
      <main className="max-w-5xl mx-auto px-6 py-8 space-y-6">
        <div>
          <h1 className="text-2xl font-black tracking-wide">AUDIT TRAIL</h1>
          <p className="text-muted text-xs mt-1">
            Security-relevant events from the last 200 records: sign-ins, linked accounts, role changes and
            MFA activity.
          </p>
        </div>

        {!isAdmin && me && <p className="text-muted text-sm">Admins only.</p>}
        {error && (
          <p role="alert" className="text-alert text-sm">
            {error}
          </p>
        )}
        {loading && <p className="text-muted text-xs">Loading the trail…</p>}

        <div className="border border-line rounded-xl overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-surface text-muted uppercase text-xs">
              <tr>
                <th className="text-left px-4 py-3">When</th>
                <th className="text-left px-4 py-3">Event</th>
                <th className="text-left px-4 py-3">Account</th>
                <th className="text-left px-4 py-3">IP</th>
                <th className="text-left px-4 py-3">Detail</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id} className="border-t border-line align-top">
                  <td className="px-4 py-3 text-muted text-xs whitespace-nowrap">
                    {new Date(r.createdAt).toLocaleString()}
                  </td>
                  <td className={`px-4 py-3 font-bold text-xs ${KIND_CLASS[r.kind] ?? "text-fg"}`}>
                    {KIND_LABEL[r.kind] ?? r.kind.replace(/_/g, " ")}
                  </td>
                  <td className="px-4 py-3 text-xs">
                    {r.email ?? "—"}
                    {r.userId && <span className="block text-muted">{r.userId}</span>}
                  </td>
                  <td className="px-4 py-3 text-muted text-xs">{r.ip ?? "—"}</td>
                  <td className="px-4 py-3 text-muted text-xs break-all">
                    {r.kind === "mfa_reset"
                      ? describeReset(r.meta ?? {})
                      : r.kind === "mfa_disabled"
                        ? `password-only sign-in · ${Number(r.meta?.factorsRemoved) || 0} authenticator${
                            (Number(r.meta?.factorsRemoved) || 0) === 1 ? "" : "s"
                          } removed`
                        : Object.keys(r.meta ?? {}).length
                          ? JSON.stringify(r.meta)
                          : "—"}
                  </td>
                </tr>
              ))}
              {!rows.length && !error && !loading && (
                <tr>
                  <td colSpan={5} className="px-4 py-6 text-center text-muted">
                    No audit events yet.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </main>
    </>
  );
}
