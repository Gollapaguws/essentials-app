"use client";

import { useState } from "react";
import Link from "next/link";
import { TopNav } from "@/components/TopNav";
import { useAuth } from "@/components/AuthProvider";
import { api } from "@essentials/api-client";
import { errorMessage } from "@/lib/errors";
import { useResource } from "@/hooks/useResource";

interface NotificationRow {
  id: string;
  kind: string;
  title: string;
  body: string;
  link: string | null;
  read: boolean;
  createdAt: string;
}

interface DjTarget {
  id: string;
  email: string;
  name: string | null;
  stageName: string | null;
  telegram: boolean;
}

interface TestResult {
  recipient: DjTarget;
  delivered: number;
  channels: { inapp: number; telegram: number };
}

const KIND_LABEL: Record<string, string> = {
  dj_call: "DJ CALL",
  application: "APPLICATION",
  confirmed: "CONFIRMED",
  declined: "DECLINED",
  telegram_onboarding: "TELEGRAM",
  generic: "NOTICE",
};

const field = "bg-bg border border-line rounded-lg px-3 py-2 text-sm outline-none focus:border-neon";

/** The bell feed: everything sent to this account, newest first. */
export default function Notifications() {
  const { me } = useAuth();
  const isAdmin = me?.user.role === "admin";

  const rowsSource = useResource<NotificationRow[]>("/notifications");
  const djsSource = useResource<DjTarget[]>(isAdmin ? "/notifications/djs" : null);
  const rows = rowsSource.data ?? [];
  const djs = djsSource.data ?? [];
  // Load failures come from the resources; `error` is only for actions.
  const loadError = rowsSource.error ?? djsSource.error;

  const [busy, setBusy] = useState(false);
  const [onlyUnread, setOnlyUnread] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [targetId, setTargetId] = useState("");
  const [sending, setSending] = useState(false);
  const [testNotice, setTestNotice] = useState<string | null>(null);

  const unread = rows.filter((r) => !r.read).length;
  const visible = onlyUnread ? rows.filter((r) => !r.read) : rows;

  const markAll = async () => {
    setBusy(true);
    try {
      await api.post("/notifications/read", {});
      rowsSource.reload();
    } catch (err) {
      setError(errorMessage(err) ?? "Could not mark notifications read.");
    } finally {
      setBusy(false);
    }
  };

  const markOne = async (id: string) => {
    try {
      await api.post("/notifications/read", { id });
      // Optimistic: the row dims immediately; a reload would be a needless round trip.
      rowsSource.setData((prev) =>
        (prev ?? []).map((r) => (r.id === id ? { ...r, read: true } : r)),
      );
    } catch (err) {
      setError(errorMessage(err) ?? "Could not mark that notification read.");
    }
  };

  /** Admin check: prove the bell + Telegram paths reach a real DJ. */
  const sendTest = async () => {
    if (!targetId) return;
    setSending(true);
    setError(null);
    setTestNotice(null);
    try {
      const result = await api.post<TestResult>("/notifications/test", { userId: targetId });
      const who =
        result.recipient.stageName ?? result.recipient.name ?? result.recipient.email;
      const parts = [`in-app ${result.channels.inapp}`];
      if (result.channels.telegram) parts.push(`telegram ${result.channels.telegram}`);
      const silent = !result.channels.telegram;
      setTestNotice(
        `Test sent to ${who} — ${parts.join(" · ")}.${silent ? " No Telegram went out: the account has not linked it." : ""}`,
      );
    } catch (err) {
      setError(errorMessage(err) ?? "Could not send the test notification.");
    } finally {
      setSending(false);
    }
  };

  return (
    <>
      <TopNav />
      <main className="max-w-4xl mx-auto px-6 py-8 space-y-6">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <h1 className="text-2xl font-black tracking-wide">
              NOTIFICATIONS
              {unread > 0 && (
                <span className="ml-3 align-middle bg-neon text-bg text-xs font-black rounded-full px-2 py-0.5">
                  {unread} UNREAD
                </span>
              )}
            </h1>
            <p className="text-muted text-xs mt-1">
              {rows.length} total · DJ calls, gig confirmations and invoices. Telegram carries the
              same messages where linked.
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <button
              onClick={() => setOnlyUnread((v) => !v)}
              className={`border rounded-lg px-3 py-2 text-xs font-bold tracking-widest ${
                onlyUnread ? "border-neon text-neon" : "border-line text-fg"
              }`}
            >
              {onlyUnread ? "SHOWING UNREAD" : "ONLY UNREAD"}
            </button>
            <button
              onClick={markAll}
              disabled={busy || unread === 0}
              className="bg-neon text-bg font-black rounded-lg px-3 py-2 text-xs tracking-widest disabled:opacity-40"
            >
              MARK ALL READ
            </button>
          </div>
        </div>

        {isAdmin && (
          <section className="border border-line rounded-xl p-4 space-y-3">
            <div>
              <h2 className="text-sm font-bold uppercase tracking-wider text-neon">
                Send a test notification
              </h2>
              <p className="text-muted text-xs mt-1">
                Sends the same notice a DJ call sends: the bell feed, plus Telegram where the DJ
                has linked it.
              </p>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <select
                className={field}
                value={targetId}
                onChange={(e) => setTargetId(e.target.value)}
                aria-label="DJ to notify"
              >
                <option value="">{djs.length ? "Choose a DJ" : "No DJ accounts yet"}</option>
                {djs.map((dj) => (
                  <option key={dj.id} value={dj.id}>
                    {dj.stageName ? `${dj.stageName} — ${dj.email}` : dj.email}
                    {dj.telegram ? " (telegram)" : ""}
                  </option>
                ))}
              </select>
              <button
                onClick={sendTest}
                disabled={!targetId || sending}
                className="bg-neon text-bg font-black rounded-lg px-3 py-2 text-xs tracking-widest disabled:opacity-50"
              >
                {sending ? "SENDING…" : "SEND TEST"}
              </button>
            </div>
            {testNotice && <p className="text-neon text-sm">{testNotice}</p>}
          </section>
        )}

        {(error ?? loadError) && (
          <p role="alert" className="text-alert text-sm">
            {error ?? loadError}
          </p>
        )}
        {rowsSource.loading && <p className="text-muted text-xs">Loading…</p>}

        <div className="border border-line rounded-xl divide-y divide-line">
          {visible.map((row) => (
            <div key={row.id} className={`px-4 py-3 flex flex-wrap items-start gap-3 ${row.read ? "opacity-60" : ""}`}>
              <span
                aria-label={row.read ? "read" : "unread"}
                className={`mt-1.5 w-2 h-2 rounded-full shrink-0 ${row.read ? "bg-fg/10" : "bg-neon"}`}
              />
              <div className="min-w-0 flex-1">
                <p className="text-[11px] uppercase tracking-widest text-muted">
                  {KIND_LABEL[row.kind] ?? row.kind} ·{" "}
                  {new Date(row.createdAt).toLocaleString()}
                </p>
                <p className="font-bold text-sm mt-0.5">{row.title}</p>
                <p className="text-muted text-sm mt-0.5">{row.body}</p>
                {row.link && (
                  <Link href={row.link.replace(/^https?:\/\/[^/]+/, "")} className="text-neon text-xs underline mt-1 inline-block">
                    Open →
                  </Link>
                )}
              </div>
              {!row.read && (
                <button onClick={() => markOne(row.id)} className="text-muted text-[11px] tracking-widest hover:text-neon">
                  MARK READ
                </button>
              )}
            </div>
          ))}
          {!visible.length && (
            <p className="px-4 py-8 text-center text-muted text-sm">
              {onlyUnread ? "Nothing unread — you're all caught up." : "No notifications yet."}
            </p>
          )}
        </div>
      </main>
    </>
  );
}
