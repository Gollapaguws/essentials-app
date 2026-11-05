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

export const signOut = () => supabase.auth.signOut();
