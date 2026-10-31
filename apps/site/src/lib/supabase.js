import { createSupabaseClient } from "@essentials/auth";

export const supabase = createSupabaseClient({
  url: import.meta.env.VITE_SUPABASE_URL,
  anonKey: import.meta.env.VITE_SUPABASE_ANON_KEY,
});

/** Absolute URL Supabase sends the PKCE code back to. */
export const authCallbackUrl = `${window.location.origin}/auth/callback`;
