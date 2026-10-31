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
 * Returns `{ user, mfaRequired }`, `{ inviteRequired: true, email }`, or null.
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

/** Send a sign-in link (and, for new identities, create the Supabase user). */
export async function signInWithPassword(email, password) {
  const { error } = await supabase.auth.signInWithPassword({ email, password });
  if (error) throw new Error(error.message);
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

export async function updatePassword(password) {
  const { error } = await supabase.auth.updateUser({ password });
  if (error) throw new Error(error.message);
}

/** Redeem an invite for the signed-in identity; the email comes from the session. */
export async function redeemInvite(code) {
  return api("/auth/invite/redeem", { method: "POST", body: JSON.stringify({ code }) });
}

export const signOut = () => supabase.auth.signOut();
