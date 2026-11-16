"use client";

import { useEffect } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { DASHBOARD_ROLES, landingPath } from "@essentials/auth";
import { useAuth } from "@/components/AuthProvider";
import { WhatsNew } from "@/components/WhatsNew";

/**
 * Guard only — each dashboard page renders its own <TopNav />, so mounting one
 * here would duplicate it.
 */
export default function DashboardLayout({ children }: { children: import("react").ReactNode }) {
  const { session, me, loading } = useAuth();
  const router = useRouter();
  const pathname = usePathname();

  useEffect(() => {
    if (loading) return;
    if (!session) {
      router.replace("/login");
      return;
    }
    if (!me) return; // /auth/me still in flight or failed; the page surfaces its own error
    // First sign-in for a new address: no dashboard until it picks a password.
    if (me.mustResetPassword) {
      router.replace("/auth/password");
      return;
    }
    if (!DASHBOARD_ROLES.includes(me.user.role ?? "guest")) {
      router.replace("/");
      return;
    }
    if (me.mfaRequired) router.replace("/auth/mfa");
    // `/` is the promoter analytics home. Other roles own other pages, so send
    // them there before that page renders and 403s. (Paths here exclude the
    // `/dashboard` base path — Next strips it from `usePathname`.)
    if (pathname === "/" && me.user.role !== "promoter" && me.user.role !== "admin") {
      router.replace(landingPath(me.user.role));
    }
  }, [loading, session, me, router, pathname]);

  if (loading || (session && !me)) {
    return (
      <main className="min-h-screen grid place-items-center">
        <p className="text-neutral-500 text-sm tracking-widest">LOADING…</p>
      </main>
    );
  }

  // Never render nothing here. A blank page looks like the app is broken and
  // hides a redirect that did not complete, so say where the visitor is going
  // and leave a link that works even if the client-side navigation stalls.
  if (!session) {
    return (
      <main className="min-h-screen grid place-items-center px-6 text-center">
        <div className="space-y-3">
          <p className="text-neutral-500 text-sm tracking-widest">REDIRECTING TO SIGN-IN…</p>
          <Link href="/login" className="text-neon underline text-sm">
            Sign in
          </Link>
        </div>
      </main>
    );
  }

  return (
    <>
      {children}
      <WhatsNew />
    </>
  );
}
