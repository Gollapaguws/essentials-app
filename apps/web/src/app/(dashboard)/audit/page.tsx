"use client";

import { useEffect, useState } from "react";
import { TopNav } from "@/components/TopNav";
import { useAuth } from "@/components/AuthProvider";
import { api } from "@essentials/api-client";
import { errorMessage } from "@/lib/errors";

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
  sign_in: "text-neutral-400",
  lazy_link: "text-neutral-400",
  role_change: "text-yellow-400",
  mfa_enrolled: "text-neon",
  mfa_escalated: "text-red-400",
};

/** Admin: who signed in, whose role changed, who enrolled MFA — newest first. */
export default function Audit() {
  const { me } = useAuth();
  const [rows, setRows] = useState<AuditRow[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!me) return;
    if (me.user.role !== "admin") {
      setError("Admins only.");
      return;
    }
    api
      .get<AuditRow[]>("/auth/audit?limit=200")
      .then(setRows)
      .catch((e) => setError(errorMessage(e) ?? "Could not load the audit trail."));
  }, [me]);

  return (
    <>
      <TopNav />
      <main className="max-w-5xl mx-auto px-6 py-8 space-y-6">
        <div>
          <h1 className="text-2xl font-black tracking-wide">AUDIT TRAIL</h1>
          <p className="text-neutral-500 text-xs mt-1">
            Security-relevant events from the last 200 records: sign-ins, linked accounts, role changes and
            MFA activity.
          </p>
        </div>

        {error && <p className="text-red-400 text-sm">{error}</p>}

        <div className="border border-line rounded-xl overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-surface text-neutral-400 uppercase text-xs">
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
                  <td className="px-4 py-3 text-neutral-400 text-xs whitespace-nowrap">
                    {new Date(r.createdAt).toLocaleString()}
                  </td>
                  <td className={`px-4 py-3 font-bold text-xs ${KIND_CLASS[r.kind] ?? "text-neutral-300"}`}>
                    {r.kind.replace(/_/g, " ")}
                  </td>
                  <td className="px-4 py-3 text-xs">
                    {r.email ?? "—"}
                    {r.userId && <span className="block text-neutral-600">{r.userId}</span>}
                  </td>
                  <td className="px-4 py-3 text-neutral-500 text-xs">{r.ip ?? "—"}</td>
                  <td className="px-4 py-3 text-neutral-500 text-xs break-all">
                    {Object.keys(r.meta ?? {}).length ? JSON.stringify(r.meta) : "—"}
                  </td>
                </tr>
              ))}
              {!rows.length && !error && (
                <tr>
                  <td colSpan={5} className="px-4 py-6 text-center text-neutral-500">
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
