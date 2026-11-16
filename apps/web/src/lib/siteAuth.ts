import { createSupabaseClient } from "@essentials/auth";
import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * The dashboard and the public site share one origin, so the site's Supabase
 * session (including a Google sign-in) is already in this browser's storage.
 * Reading it here is what lets an account without a password enter the
 * dashboard; the API still decides whether the session is valid.
 */
let client: SupabaseClient | null = null;

export function siteAuth(): SupabaseClient | null {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !anonKey) return null;
  client ??= createSupabaseClient({ url, anonKey });
  return client;
}

/** Where Supabase returns a Google sign-in: the site owns the PKCE exchange. */
export function siteAuthCallback(): string {
  return `${window.location.origin}/auth/callback`;
}

/** The public sign-in page, for when the bundle has no Supabase configuration. */
export function siteLoginUrl(): string {
  return `${window.location.origin}/login`;
}
