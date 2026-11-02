"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { DASHBOARD_ROLES } from "@essentials/auth";
import { useAuth } from "@/components/AuthProvider";

/**
 * Guard only — each dashboard page renders its own <TopNav />, so mounting one
 * here would duplicate it.
 */
export default function DashboardLayout({ children }: { children: import("react").ReactNode }) {
  const { session, me, loading } = useAuth();
  const router = useRouter();

  useEffect(() => {
    if (loading) return;
    if (!session) {
      router.replace("/");
      return;
    }
    if (!me) return; // /auth/me still in flight or failed; the page surfaces its own error
    if (!DASHBOARD_ROLES.includes(me.user.role ?? "guest")) {
      router.replace("/");
      return;
    }
    if (me.mfaRequired) router.replace("/auth/mfa");
  }, [loading, session, me, router]);

  if (loading || (session && !me)) {
    return (
      <main className="min-h-screen grid place-items-center">
        <p className="text-neutral-500 text-sm tracking-widest">LOADING…</p>
      </main>
    );
  }

  if (!session) return null;

  return <>{children}</>;
}
