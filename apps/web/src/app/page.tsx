"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { api } from "@essentials/api-client";
import { DASHBOARD_ROLES, landingPath, type MeResponse } from "@essentials/auth";
import { supabase } from "@/lib/supabase";
import { InfoTip, Tooltip } from "@/components/Tooltip";

/** Sign-in for promoters/venue managers/admins: email and password. */
export default function LoginPage() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
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

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const { error: err } = await supabase.auth.signInWithPassword({ email, password });
    if (err) {
      setBusy(false);
      setError("Wrong email or password.");
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

        {error && <p className="text-red-400 text-sm mt-4">{error}</p>}
      </div>
    </main>
  );
}
