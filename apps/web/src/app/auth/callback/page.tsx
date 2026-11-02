"use client";

import { Suspense, useEffect, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { api } from "@essentials/api-client";
import { DASHBOARD_ROLES, type MeResponse } from "@essentials/auth";
import { supabase } from "@/lib/supabase";

function CallbackInner() {
  const params = useSearchParams();
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const code = params.get("code");
    if (!code) {
      setError("This link is incomplete or has expired.");
      return;
    }

    (async () => {
      const { error: exchangeError } = await supabase.auth.exchangeCodeForSession(code);
      if (exchangeError) {
        setError("This link has expired. Request a new one.");
        return;
      }

      try {
        const me = await api.get<MeResponse>("/auth/me");
        if ("inviteRequired" in me) {
          await supabase.auth.signOut();
          setError("No dashboard account yet — ask an admin for an invite.");
          return;
        }
        if (!DASHBOARD_ROLES.includes(me.user.role ?? "guest")) {
          await supabase.auth.signOut();
          setError("Dashboard is for promoters, venue managers and admins.");
          return;
        }
        router.replace(me.mfaRequired ? "/auth/mfa" : "/dashboard");
      } catch {
        setError("Signed in, but the dashboard could not be loaded.");
      }
    })();
  }, [params, router]);

  return (
    <main className="min-h-screen grid place-items-center px-6">
      <div className="text-center space-y-4">
        <h1 className="text-neon text-2xl font-black tracking-widest">ESSENTIALS</h1>
        {error ? (
          <>
            <p className="text-neutral-400">{error}</p>
            <Link href="/" className="text-neon underline text-sm">
              Send a new link
            </Link>
          </>
        ) : (
          <p className="text-neutral-400">Signing you in…</p>
        )}
      </div>
    </main>
  );
}

export default function AuthCallbackPage() {
  return (
    <Suspense fallback={<main className="min-h-screen grid place-items-center">Loading…</main>}>
      <CallbackInner />
    </Suspense>
  );
}
