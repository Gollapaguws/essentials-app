"use client";

import { Suspense, useEffect, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { DASHBOARD_ROLES, landingPath } from "@essentials/auth";
import { session } from "@/lib/session";

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
      try {
        await session.exchange(code);
      } catch {
        setError("This link has expired. Request a new one.");
        return;
      }

      // Recovery links sign the account in just to change the password: skip the
      // role gate and send them to the screen that owns that one job.
      if (params.get("type") === "recovery") {
        router.replace("/auth/password?recovery=1");
        return;
      }

      try {
        const me = await session.me();
        if (!DASHBOARD_ROLES.includes(me.user.role ?? "guest")) {
          await session.logout().catch(() => undefined);
          setError("Dashboard is for DJs, promoters, venue managers and admins.");
          return;
        }
        router.replace(me.mfaRequired ? "/auth/mfa" : landingPath(me.user.role));
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
