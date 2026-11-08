"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { api } from "@essentials/api-client";
import { DASHBOARD_ROLES, landingPath, type MeResponse } from "@essentials/auth";
import { session } from "@/lib/session";
import { InfoTip, Tooltip } from "@/components/Tooltip";

/** Sign-in for every dashboard role: email and password. */
export default function LoginPage() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [resetSent, setResetSent] = useState(false);
  const [mailDown, setMailDown] = useState(false);
  const router = useRouter();

  const routeByRole = (me: MeResponse) => {
    // A new address picks its own password before any role gate applies.
    if (me.mustResetPassword) {
      router.replace("/auth/password");
      return;
    }
    if (!DASHBOARD_ROLES.includes(me.user.role ?? "guest")) {
      setError("Dashboard is for DJs, promoters, venue managers and admins.");
      return;
    }
    router.replace(me.mfaRequired ? "/auth/mfa" : landingPath(me.user.role));
  };

  // Already signed in with a live session cookie? Go straight in.
  useEffect(() => {
    session
      .me()
      .then(routeByRole)
      .catch(() => {
        // no session: stay on the form
      });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Say the relay is down before the click, not after: otherwise staff ask for a
  // reset link, get "sent", and wait for something that cannot arrive. A failed
  // check on its own is not proof, so only a definite "down" raises the banner.
  useEffect(() => {
    let cancelled = false;
    api
      .get<{ ok: boolean }>("/mail/status")
      .then((status) => {
        if (!cancelled) setMailDown(!status.ok);
      })
      .catch(() => {
        /* the endpoint being unreachable is not evidence about the mail server */
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const sendReset = async () => {
    setError(null);
    if (!email.includes("@")) {
      setError("Type the email on your account first, then tap Forgot password.");
      return;
    }
    // The recovery mail has to come back to this app's callback, which sits under the
    // dashboard's base path (`/dashboard` in production, empty in dev). This page is
    // `<basePath>/login`, so strip that segment rather than assuming where it is.
    const basePath = window.location.pathname.replace(/\/login\/?$/, "");
    try {
      await session.recover(email, `${basePath}/auth/callback?type=recovery`);
      setResetSent(true);
    } catch {
      setError("Could not send the reset email. Try again in a moment.");
    }
  };

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await session.login(email, password);
    } catch {
      setBusy(false);
      setError("Wrong email or password.");
      return;
    }
    try {
      routeByRole(await session.me());
    } catch {
      setError("Signed in, but the dashboard could not be loaded.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <main className="min-h-screen grid place-items-center px-6">
      <div className="w-full max-w-md border border-line bg-surface rounded-2xl p-8">
        <h1 className="text-neon text-3xl font-black tracking-widest">ESSENTIALS</h1>
        <p className="text-neutral-500 mt-2 text-sm">Dashboard — sign in to continue.</p>
        {mailDown && (
          <p className="mt-4 text-xs text-amber-400" role="status">
            Password reset email is down right now, so a reset link will not arrive. An admin can set
            a password for you from Users.
          </p>
        )}

        <form className="mt-6 space-y-4" onSubmit={submit}>
          <div className="space-y-1">
            <div className="flex items-center gap-2 text-[11px] uppercase tracking-widest text-neutral-500">
              <label htmlFor="email">Email</label>
              <InfoTip label="The address on your ESSENTIALS account. Staff accounts are created by an admin; guests can sign up on the public site." />
            </div>
            <input
              id="email"
              className="w-full bg-bg border border-line rounded-lg px-4 py-3 outline-none focus:border-neon"
              placeholder="you@essentials.example"
              type="email"
              autoComplete="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
            />
          </div>
          <div className="space-y-1">
            <div className="flex items-center gap-2 text-[11px] uppercase tracking-widest text-neutral-500">
              <label htmlFor="password">Password</label>
              <InfoTip label="At least 8 characters, chosen when the account was created." />
              <button
                type="button"
                onClick={sendReset}
                className="ml-auto text-[11px] normal-case tracking-normal text-neutral-500 underline hover:text-neon"
              >
                Forgot password?
              </button>
            </div>
            <input
              id="password"
              className="w-full bg-bg border border-line rounded-lg px-4 py-3 outline-none focus:border-neon"
              placeholder="Password"
              type="password"
              autoComplete="current-password"
              required
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
          </div>
          <Tooltip
            className="w-full"
            label="Signs in with your email and password. Promoter, venue and admin accounts then need their 6-digit authenticator code."
          >
            <button
              disabled={busy}
              className="w-full bg-neon text-bg font-black tracking-widest rounded-lg py-3 hover:opacity-90 disabled:opacity-50"
            >
              {busy ? "WORKING…" : "SIGN IN"}
            </button>
          </Tooltip>
        </form>

        {resetSent && (
          <p className="text-neutral-400 text-xs mt-4">
            Recovery email sent to {email}. Open it to choose a new password, then sign in here.
          </p>
        )}

        {error && <p className="text-red-400 text-sm mt-4">{error}</p>}
      </div>
    </main>
  );
}
