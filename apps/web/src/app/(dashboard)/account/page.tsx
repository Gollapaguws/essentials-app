"use client";

import { useCallback, useEffect, useState } from "react";
import { TopNav } from "@/components/TopNav";
import { session, type DashboardDevice } from "@/lib/session";
import { signOutEverywhere } from "@/lib/signOut";
import { errorMessage } from "@/lib/errors";

const when = (iso: string) => {
  const date = new Date(iso);
  return Number.isNaN(date.getTime())
    ? "unknown"
    : date.toLocaleString(undefined, {
        day: "numeric",
        month: "short",
        year: "numeric",
        hour: "2-digit",
        minute: "2-digit",
      });
};

/**
 * Every browser signed in to this account. The tokens are on the server, so
 * revoking a row is what actually ends that session — not clearing a cookie in
 * the browser that might not be the one holding it.
 */
export default function Account() {
  const [devices, setDevices] = useState<DashboardDevice[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [revoking, setRevoking] = useState<string | null>(null);

  const load = useCallback(async () => {
    setError(null);
    try {
      const { sessions } = await session.devices();
      setDevices(sessions);
    } catch (e) {
      setError(errorMessage(e) ?? "Could not load your signed-in devices.");
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const revoke = async (device: DashboardDevice) => {
    setRevoking(device.id);
    setError(null);
    try {
      // Signing this browser out is a full sign-out, not just a revoked row:
      // the site's tokens and the chat widget are on this browser too, and the
      // login card is not where a DJ expects to be after signing out.
      if (device.current) {
        await signOutEverywhere();
        return;
      }
      await session.revokeDevice(device.id);
      setDevices((prev) => prev?.filter((d) => d.id !== device.id) ?? prev);
    } catch (e) {
      setError(errorMessage(e) ?? "Could not sign that device out.");
    } finally {
      setRevoking(null);
    }
  };

  return (
    <>
      <TopNav />
      <main className="max-w-4xl mx-auto px-6 py-8 space-y-6">
        <div>
          <h1 className="text-2xl font-black tracking-wide">SIGNED-IN DEVICES</h1>
          <p className="text-neutral-500 text-xs mt-1 max-w-xl">
            Each row is a browser session on this account. The sign-in tokens live on the server, so
            revoking a row signs that browser out on its next request — even if you no longer have it.
          </p>
        </div>

        {error && <p className="text-red-400 text-sm">{error}</p>}

        {devices === null && !error && <p className="text-neutral-500 text-sm">Loading…</p>}

        {devices?.length === 0 && (
          <p className="text-neutral-500 text-sm">No other devices are signed in.</p>
        )}

        {devices && devices.length > 0 && (
          <ul className="border border-line rounded-xl divide-y divide-line">
            {devices.map((device) => (
              <li
                key={device.id}
                className="flex flex-wrap items-center justify-between gap-3 px-5 py-4"
              >
                <div className="space-y-1">
                  <p className="text-sm text-white">
                    Session from {when(device.createdAt)}
                    {device.current && (
                      <span className="ml-2 text-[10px] font-bold tracking-widest text-neon border border-neon/40 rounded px-1.5 py-0.5">
                        THIS BROWSER
                      </span>
                    )}
                    {device.aal === "aal2" && (
                      <span className="ml-2 text-[10px] font-bold tracking-widest text-neutral-400 border border-line rounded px-1.5 py-0.5">
                        TWO-STEP
                      </span>
                    )}
                  </p>
                  <p className="text-neutral-600 text-xs">
                    Last active {when(device.lastSeenAt)}
                  </p>
                </div>
                <button
                  onClick={() => void revoke(device)}
                  disabled={revoking !== null}
                  className="text-xs tracking-widest text-neutral-400 hover:text-red-400 disabled:opacity-40"
                >
                  {revoking === device.id
                    ? "SIGNING OUT…"
                    : device.current
                      ? "SIGN OUT"
                      : "REVOKE"}
                </button>
              </li>
            ))}
          </ul>
        )}
      </main>
    </>
  );
}
