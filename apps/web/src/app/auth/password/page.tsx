"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { api } from "@essentials/api-client";
import { landingPath, type MeResponse } from "@essentials/auth";
import { session } from "@/lib/session";
import { InfoTip } from "@/components/Tooltip";

/**
 * First sign-in for a new address: the account was set up with someone else's
 * password, so the owner picks their own before anything else opens.
 */
export default function SetPasswordPage() {
  const router = useRouter();
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [busy, setBusy] = useState(false);
  const [checking, setChecking] = useState(true);
  const [recovery, setRecovery] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const leave = (me: MeResponse) =>
    router.replace(me.mfaRequired ? "/auth/mfa" : landingPath(me.user.role ?? "guest"));

  useEffect(() => {
    // Read here rather than with useSearchParams so the page keeps prerendering.
    const isRecovery = new URLSearchParams(window.location.search).get("recovery") === "1";
    setRecovery(isRecovery);
    (async () => {
      let me: MeResponse;
      try {
        me = await session.me();
      } catch {
        router.replace("/login");
        return;
      }
      // Already done, or never needed: don't trap the account on this screen.
      // A recovery link is allowed through even when no reset was pending.
      if (!isRecovery && !me.mustResetPassword) {
        leave(me);
        return;
      }
      setChecking(false);
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (password !== confirm) {
      setError("The two passwords do not match.");
      return;
    }
    setBusy(true);
    setError(null);

    try {
      await session.setPassword(password);
    } catch (e) {
      setBusy(false);
      setError((e as Error).message);
      return;
    }

    try {
      // Only the first-sign-in screen clears the mustResetPassword flag; a recovery
      // link just needs the password written before the dashboard opens.
      if (!recovery) await api.post<{ mustResetPassword: boolean }>("/auth/password/complete", {});
      leave(await api.get<MeResponse>("/auth/me"));
    } catch {
      setBusy(false);
      setError("Password saved, but the account could not be updated. Reload and try again.");
    }
  };

  return (
    <main className="min-h-screen grid place-items-center px-6">
      <div className="w-full max-w-md border border-line bg-surface rounded-2xl p-8 space-y-4">
        <h1 className="text-neon text-2xl font-black tracking-widest">CHOOSE A NEW PASSWORD</h1>
        <p className="text-neutral-400 text-sm">
          {recovery
            ? "You opened a recovery link. Choose a new password — the old one stops working straight away."
            : "This is the first sign-in for this address. Set your own password — the one it was created with stops working for you here."}
        </p>

        {checking ? (
          <p className="text-neutral-500 text-sm tracking-widest">LOADING…</p>
        ) : (
          <form className="space-y-4" onSubmit={submit}>
            <div className="space-y-1">
              <div className="flex items-center gap-2 text-[11px] uppercase tracking-widest text-neutral-500">
                <label htmlFor="password">New password</label>
                <InfoTip label="At least 8 characters. Use a phrase you have not used on another service." />
              </div>
              <input
                id="password"
                className="w-full bg-bg border border-line rounded-lg px-4 py-3 outline-none focus:border-neon"
                type="password"
                autoComplete="new-password"
                minLength={8}
                required
                value={password}
                onChange={(e) => setPassword(e.target.value)}
              />
            </div>

            <div className="space-y-1">
              <div className="flex items-center gap-2 text-[11px] uppercase tracking-widest text-neutral-500">
                <label htmlFor="confirm">Repeat password</label>
                <InfoTip label="Typed twice so a slip of the finger cannot lock you out of the account." />
              </div>
              <input
                id="confirm"
                className="w-full bg-bg border border-line rounded-lg px-4 py-3 outline-none focus:border-neon"
                type="password"
                autoComplete="new-password"
                minLength={8}
                required
                value={confirm}
                onChange={(e) => setConfirm(e.target.value)}
              />
            </div>

            <button
              disabled={busy}
              className="w-full bg-neon text-bg font-black tracking-widest rounded-lg py-3 disabled:opacity-50"
            >
              {busy ? "SAVING…" : "SAVE AND CONTINUE"}
            </button>
          </form>
        )}

        {error && <p className="text-red-400 text-sm">{error}</p>}
      </div>
    </main>
  );
}
