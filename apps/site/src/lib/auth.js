const API_URL = import.meta.env.VITE_API_URL ?? "https://essentialsedm.com/api";

const TOKEN_KEY = "essentials_token";

export const getToken = () => localStorage.getItem(TOKEN_KEY);
export const setToken = (t) => (t ? localStorage.setItem(TOKEN_KEY, t) : localStorage.removeItem(TOKEN_KEY));

export async function api(path, init) {
  const res = await fetch(`${API_URL}${path}`, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      ...(getToken() ? { Authorization: `Bearer ${getToken()}` } : {}),
      ...init?.headers,
    },
  });
  if (!res.ok) throw new Error((await res.text()) || res.statusText);
  return res.json();
}

export async function requestMagicLink(email) {
  return api("/auth/magic-link", { method: "POST", body: JSON.stringify({ email, redirect: "site" }) });
}

/** Exchange a magic-link token for a session. Throws if account doesn't exist yet (needs invite code). */
export async function verifyMagicLink(token) {
  try {
    const res = await api("/auth/verify", { method: "POST", body: JSON.stringify({ token }) });
    setToken(res.accessToken);
    return { ok: true, user: res.user };
  } catch (e) {
    const msg = String(e?.message ?? "");
    if (msg.includes("NO_ACCOUNT")) return { ok: false, reason: "NO_ACCOUNT" };
    return { ok: false, reason: "EXPIRED" };
  }
}

/** Redeem an invite code to create an account, then session. */
export async function redeemInvite(code, email) {
  const res = await api("/auth/invite/redeem", { method: "POST", body: JSON.stringify({ code, email }) });
  setToken(res.accessToken);
  return res.user;
}

export const signOut = () => setToken(null);
