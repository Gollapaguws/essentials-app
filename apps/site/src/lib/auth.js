import { supabase } from "@/lib/supabase";

const API_URL = import.meta.env.VITE_API_URL ?? "https://essentialsedm.com/api";

/** Read the current access token straight from the Supabase session. */
async function currentToken() {
  const { data } = await supabase.auth.getSession();
  return data.session?.access_token ?? null;
}

export async function api(path, init) {
  const token = await currentToken();
  const res = await fetch(`${API_URL}${path}`, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...init?.headers,
    },
  });
  if (!res.ok) {
    let message = res.statusText;
    try {
      const body = await res.json();
      message = body.message ?? body.code ?? message;
    } catch {
      /* keep the status text */
    }
    throw new Error(message);
  }
  return res.json();
}

/**
 * Canonical identity for the current session.
 * Returns `{ user, mfaRequired }` or null.
 */
export async function fetchMe() {
  const token = await currentToken();
  if (!token) return null;
  try {
    return await api("/auth/me");
  } catch {
    return null;
  }
}

export async function signInWithPassword(email, password) {
  const { error } = await supabase.auth.signInWithPassword({ email, password });
  if (error) throw new Error(error.message);
}

/** Create the Supabase identity. Returns the session when confirmation is off. */
export async function signUpWithPassword(email, password) {
  const { data, error } = await supabase.auth.signUp({ email, password });
  if (error) throw new Error(error.message);
  return data.session ?? null;
}

export async function signInWithGoogle(redirectTo) {
  const { error } = await supabase.auth.signInWithOAuth({
    provider: "google",
    options: { redirectTo },
  });
  if (error) throw new Error(error.message);
}

export async function requestPasswordReset(email, redirectTo) {
  const { error } = await supabase.auth.resetPasswordForEmail(email, { redirectTo });
  if (error) throw new Error(error.message);
}

/** True when this browser holds a live session (a recovery link establishes one). */
export async function hasSession() {
  const { data } = await supabase.auth.getSession();
  return Boolean(data.session);
}

export async function updatePassword(password) {
  const { error } = await supabase.auth.updateUser({ password });
  if (error) throw new Error(error.message);
}

/**
 * End the account on both halves of the site.
 *
 * The dashboard keeps a server-side session behind an httpOnly cookie on this
 * same origin, so signing out of Supabase alone leaves the dashboard open. The
 * API call is first because it needs that cookie to still be there.
 */
export async function signOut() {
  try {
    await fetch(`${API_URL}/auth/session`, { method: "DELETE", credentials: "include" });
  } catch {
    // The dashboard cookie may outlive a failed call; the browser session below
    // still ends, and the dashboard's sign-out clears the cookie for good.
  }
  await supabase.auth.signOut();
}

/**
 * Swap this browser's Supabase session for the dashboard's httpOnly cookie.
 *
 * Signing in here only creates a Supabase session; the dashboard reads a
 * server-side cookie, so without this step it greeted everyone — Google or
 * password — with its own login form. Going through the API also verifies the
 * token before anything is stored.
 */
export async function openDashboard() {
  const { data } = await supabase.auth.getSession();
  const current = data.session;
  if (current) {
    try {
      await fetch(`${API_URL}/auth/session/token`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          accessToken: current.access_token,
          refreshToken: current.refresh_token,
        }),
      });
    } catch {
      // Navigating anyway lets the dashboard explain itself on its own form.
    }
  }
  window.location.href = "/dashboard";
}
