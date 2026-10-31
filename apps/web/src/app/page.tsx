"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { api } from "@essentials/api-client";
import { DASHBOARD_ROLES, type MeResponse } from "@essentials/auth";
import { supabase } from "@/lib/supabase";

type Mode = "link" | "password";

/** Sign-in for promoters/venue managers/admins: email link or password. */
export default function LoginPage() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [mode, setMode] = useState<Mode>("link");
  const [sent, setSent] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const router = useRouter();

  const routeByRole = (me: MeResponse) => {
    if (!DASHBOARD_ROLES.includes(me.user.role ?? "guest")) {
      setError("Dashboard is for promoters, venue managers and admins.");
      return;
    }
    router.replace(me.mfaRequired ? "/auth/mfa" : "/dashboard");
  };

  // Already signed in (site or dashboard) with a privileged role? Go straight in.
  useEffect(() => {
    supabase.auth.getSession().then(async ({ data }) => {
      if (!data.session) return;
      try {
        routeByRole(await api.get<MeResponse>("/auth/me"));
      } catch {
        // stale session: stay on the form
      }
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const submitLink = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const { error: err } = await supabase.auth.signInWithOtp({
      email,
      options: { emailRedirectTo: `${window.location.origin}/auth/callback` },
    });
    setBusy(false);
    if (err) setError("Could not send the link. Try a password instead.");
    else setSent(true);
  };

  const submitPassword = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const { error: err } = await supabase.auth.signInWithPassword({ email, password });
    if (err) {
      setBusy(false);
      setError("Wrong email or password — or use a sign-in link instead.");
      return;
    }
    try {
      routeByRole(await api.get<MeResponse>("/auth/me"));
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
        <p className="text-neutral-500 mt-2 text-sm">Promoter dashboard — sign in to continue.</p>

        {sent ? (
          <div className="mt-6 space-y-3">
            <p className="text-neutral-300 text-sm">Check {email} for your sign-in link.</p>
            <button
              className="text-neutral-500 text-xs underline"
              onClick={() => {
                setSent(false);
                setError(null);
              }}
            >
              Use a different email
            </button>
          </div>
        ) : (
          <form className="mt-6 space-y-3" onSubmit={mode === "link" ? submitLink : submitPassword}>
            <input
              className="w-full bg-bg border border-line rounded-lg px-4 py-3 outline-none focus:border-neon"
              placeholder="you@essentials.example"
              type="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
            />
            {mode === "password" && (
              <input
                className="w-full bg-bg border border-line rounded-lg px-4 py-3 outline-none focus:border-neon"
                placeholder="Password"
                type="password"
                required
                value={password}
                onChange={(e) => setPassword(e.target.value)}
              />
            )}
            <button
              disabled={busy}
              className="w-full bg-neon text-bg font-black tracking-widest rounded-lg py-3 hover:opacity-90 disabled:opacity-50"
            >
              {busy ? "WORKING…" : mode === "link" ? "EMAIL ME A LINK" : "SIGN IN"}
            </button>
            <button
              type="button"
              className="w-full text-neutral-500 text-xs underline"
              onClick={() => {
                setMode(mode === "link" ? "password" : "link");
                setError(null);
              }}
            >
              {mode === "link" ? "Sign in with a password instead" : "Email me a link instead"}
            </button>
          </form>
        )}

        {error && <p className="text-red-400 text-sm mt-4">{error}</p>}
      </div>
    </main>
  );
}
