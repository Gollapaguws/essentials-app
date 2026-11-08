"use client";

import { session } from "@/lib/session";
import { resetAgentUser } from "@/lib/agent";

/**
 * Drop the site's Supabase session from this browser.
 *
 * supabase-js stores under `sb-<ref>-auth-token` (plus a PKCE verifier key), and
 * the dashboard shares the origin with the site, so signing out here has to
 * clear it too — the API has already ended the session behind the tokens.
 */
export function forgetSiteSession(): void {
  for (const key of Object.keys(window.localStorage)) {
    if (/^sb-.*-auth-token/.test(key)) window.localStorage.removeItem(key);
  }
}

/**
 * Sign out of the account on both halves of the site.
 *
 * The dashboard's cookie and the site's browser tokens are two separate halves
 * of one sign-in, and clearing only one of them looked like a sign-out while
 * leaving the other able to sign straight back in. Every sign-out control goes
 * through here so they cannot drift apart again.
 */
export async function signOutEverywhere(): Promise<void> {
  await session.logout().catch(() => undefined);
  // The chat widget must forget the account that just signed out.
  resetAgentUser();
  forgetSiteSession();
  // Leave the dashboard rather than routing to its root or its login card:
  // every dashboard page is signed-in only, so those render a form a moment
  // after signing out. The public site is what a DJ expects to land on.
  window.location.replace("/");
}
