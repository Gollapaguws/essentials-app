"use client";

import { createSupabaseClient } from "@essentials/auth";
import { setAccessTokenProvider } from "@essentials/api-client";

export const supabase = createSupabaseClient({
  url: process.env.NEXT_PUBLIC_SUPABASE_URL!,
  anonKey: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
});

/**
 * Registered at import time rather than in an effect.
 *
 * React runs a page's effects before its parent's, so a page that calls the API
 * on mount (sign-in, the auth callback) ran before AuthProvider had told the
 * client how to read the token. The request went out without a bearer token,
 * the resulting 401 was swallowed, and a signed-in visitor was left sitting on
 * the sign-in form.
 */
setAccessTokenProvider(async () => {
  const { data } = await supabase.auth.getSession();
  return data.session?.access_token ?? null;
});
