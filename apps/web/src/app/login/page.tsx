"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { DASHBOARD_ROLES, landingPath, type MeResponse } from "@essentials/auth";
import { session } from "@/lib/session";
import { siteAuth, siteAuthCallback, siteLoginUrl } from "@/lib/siteAuth";
import { InfoTip, Tooltip } from "@/components/Tooltip";

/** Sign-in for every dashboard role: email and password. */
export default function LoginPage() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [resetSent, setResetSent] = useState(false);
  const [checking, setChecking] = useState(true);
  const [googleBusy, setGoogleBusy] = useState(false);
  const router = useRouter();

  const routeByRole = (me: MeResponse) => {
    // A new address picks its own password before any role gate applies.
    if (me.mustResetPassword) {
      router.replace("/auth/password");
      return;
    }
    if (!DASHBOARD_ROLES.includes(me.user.role ?? "guest")) {
      setError("Dashboard is for DJs, promoters, venue managers, door staff and admins.");
      return;
    }
    router.replace(me.mfaRequired ? "/auth/mfa" : landingPath(me.user.role));
  };

  // Already signed in with a live session cookie? Go straight in.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const me = await session.me();
        if (cancelled) return;
        routeByRole(me);
        setChecking(false);
        return;
      } catch {
        // No dashboard cookie. This browser may still hold the site's Supabase
        // session (Google accounts have no password to type here), so adopt it.
      }
      const supabase = siteAuth();
      if (!supabase) {
        if (!cancelled) setChecking(false);
        return;
      }
      try {
        const { data } = await supabase.auth.getSession();
        const current = data.session;
        if (!current) {
          if (!cancelled) setChecking(false);
          return;
        }
        await session.adopt(current.access_token, current.refresh_token);
        const me = await session.me();
        if (cancelled) return;
        routeByRole(me);
      } catch {
        // A stale site session is not an error worth showing; the form is the fallback.
      } finally {
        if (!cancelled) setChecking(false);
      }
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const google = async () => {
    setError(null);
    const supabase = siteAuth();
    if (!supabase) {
      window.location.href = siteLoginUrl();
      return;
    }
    setGoogleBusy(true);
    const { error: oauthError } = await supabase.auth.signInWithOAuth({
      provider: "google",
      options: { redirectTo: siteAuthCallback() },
    });
    if (oauthError) {
      setGoogleBusy(false);
      setError("Google sign-in did not start. Try again.");
    }
  };

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
        <h1 className="font-display text-neon text-3xl tracking-[0.18em]">SONUS</h1>
        <p className="text-muted mt-2 text-sm">Dashboard — sign in to continue.</p>
        <a
          href="https://essentialsedm.com"
          className="mt-4 flex items-center justify-between gap-2 rounded-lg border border-neon/40 bg-neon/10 px-4 py-3 text-[11px] font-black tracking-[0.18em] text-neon transition hover:border-neon hover:bg-neon/15"
        >
          <span>VISIT ESSENTIALSEDM.COM</span>
          <span aria-hidden="true">↗</span>
        </a>
        {checking && (
          <p className="mt-6 text-xs uppercase tracking-widest text-muted">Checking your session…</p>
        )}

        {!checking && (
          <>
            <button
              type="button"
              onClick={google}
              disabled={googleBusy}
              className="mt-6 w-full rounded-lg border border-line bg-bg px-4 py-3 font-bold tracking-wide hover:border-neon disabled:opacity-50"
            >
              {googleBusy ? "OPENING GOOGLE…" : "Continue with Google"}
            </button>
            <p className="mt-2 text-xs text-muted">
              Uses the Google account already in this browser. After it returns, the dashboard signs itself in.
            </p>
            <div className="mt-5 flex items-center gap-3 text-[10px] uppercase tracking-widest text-muted">
              <span className="h-px flex-1 bg-line" />
              or use your email
              <span className="h-px flex-1 bg-line" />
            </div>
          </>
        )}

        <form className="mt-6 space-y-4" onSubmit={submit}>
          <div className="space-y-1">
            <div className="flex items-center gap-2 text-[11px] uppercase tracking-widest text-muted">
              <label htmlFor="email">Email</label>
              <InfoTip label="The address on your SONUS account. Staff accounts are created by an admin; guests can sign up on the public site." />
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
            <div className="flex items-center gap-2 text-[11px] uppercase tracking-widest text-muted">
              <label htmlFor="password">Password</label>
              <InfoTip label="At least 12 characters, chosen when the account was created." />
              <button
                type="button"
                onClick={sendReset}
                className="ml-auto text-[11px] normal-case tracking-normal text-muted underline hover:text-neon"
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
          <p className="text-muted text-xs mt-4">
            Recovery email sent to {email}. Open it to choose a new password, then sign in here.
          </p>
        )}

        {error && <p className="text-alert text-sm mt-4">{error}</p>}
      </div>
    </main>
  );
}
