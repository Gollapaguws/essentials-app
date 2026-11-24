"use client";

import { usePathname } from "next/navigation";
import { useEffect } from "react";

/**
 * Tab titles for the dashboard.
 *
 * Every screen here is a client component, so a page cannot export `metadata`
 * of its own — without this they all share the root layout's title and a row of
 * open tabs is indistinguishable. The root layout's title template can't help
 * either, for the same reason, so the suffix is written here.
 */
const TITLES: [string, string][] = [
  ["/auth/callback", "Signing in"],
  ["/auth/mfa", "Verify sign-in"],
  ["/auth/password", "Set a password"],
  ["/login", "Sign in"],
  ["/account", "Account"],
  ["/applications", "Applications"],
  ["/artist", "Artist"],
  ["/artists", "Artists"],
  ["/audit", "Audit log"],
  ["/bookings", "Bookings"],
  ["/door", "Door"],
  ["/earnings", "Earnings"],
  ["/editor", "Front page editor"],
  ["/events", "Events"],
  ["/gig-calendar", "Gig calendar"],
  ["/go-live", "Go live"],
  ["/help", "Help"],
  ["/insights", "Insights"],
  ["/mail", "Mail"],
  ["/notifications", "Notifications"],
  ["/promotions", "Promotions"],
  ["/settings", "Settings"],
  ["/settlements", "Settlements"],
  ["/simulcast", "Simulcast"],
  ["/social", "Social"],
  ["/statements", "Statements"],
  ["/users", "Users"],
  ["/venue", "Venue"],
];

/** Exported for the spec: the mapping is the whole behaviour. */
export function pageTitle(pathname: string): string {
  // Longest prefix wins, so /artists/:id is "Artists" rather than "Artist".
  const match = TITLES.filter(([prefix]) => pathname === prefix || pathname.startsWith(`${prefix}/`)).sort(
    (a, b) => b[0].length - a[0].length,
  )[0];
  return `${match?.[1] ?? "Promoter dashboard"} · SONUS`;
}

export function PageTitle() {
  const pathname = usePathname();

  useEffect(() => {
    const wanted = pageTitle(pathname);
    document.title = wanted;

    // The router owns the <title>: it re-renders the layout's static metadata
    // after hydration and on every navigation, which overwrites a title set
    // from a client component (measured: ours applied, then theirs ~20ms
    // later). The proper fix is a `metadata` export per page, but every
    // dashboard screen is a client component and cannot have one. So hold the
    // title here and re-assert it — the observer writes only when it differs,
    // so its own mutations do not loop.
    const observer = new MutationObserver(() => {
      if (document.title !== wanted) document.title = wanted;
    });
    observer.observe(document.head, { subtree: true, childList: true, characterData: true });
    return () => observer.disconnect();
  }, [pathname]);

  return null;
}
