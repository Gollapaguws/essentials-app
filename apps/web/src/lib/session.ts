import { API_URL } from "@essentials/api-client";
import type { MeResponse } from "@essentials/auth";

/**
 * The dashboard's auth calls. There is no token here on purpose: the API sets
 * one httpOnly cookie and keeps the Supabase session server-side, so every
 * request just needs `credentials: "include"`.
 */
async function call<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${API_URL}${path}`, {
    credentials: "include",
    ...init,
    headers: { "Content-Type": "application/json", ...init?.headers },
  });
  if (!res.ok) {
    let message = res.statusText;
    try {
      const body = await res.json();
      const raw = body?.message ?? body?.error_description;
      message = Array.isArray(raw) ? raw.join(", ") : (raw ?? message);
    } catch {
      // Not JSON: the status is what we have.
    }
    throw new Error(message);
  }
  if (res.status === 204) return undefined as T;
  return res.json() as Promise<T>;
}

export interface MfaFactor {
  id: string;
  name: string | null;
  status: string | null;
}

export const session = {
  login: (email: string, password: string) =>
    call<{ ok: true }>("/auth/session", {
      method: "POST",
      body: JSON.stringify({ email, password }),
    }),

  logout: () => call<void>("/auth/session", { method: "DELETE" }),

  me: () => call<MeResponse>("/auth/me"),

  /** Ask for a recovery mail; the link returns to `path` on this origin. */
  recover: (email: string, path: string) =>
    call<{ ok: true }>("/auth/password/recover", {
      method: "POST",
      body: JSON.stringify({ email, path }),
    }),

  /** Finish the emailed link — the code pairs with a server-held verifier. */
  exchange: (code: string) =>
    call<{ ok: true }>("/auth/session/exchange", {
      method: "POST",
      body: JSON.stringify({ code }),
    }),

  setPassword: (password: string) =>
    call<{ ok: true }>("/auth/password", {
      method: "POST",
      body: JSON.stringify({ password }),
    }),

  factors: () => call<{ totp: MfaFactor[] }>("/auth/mfa/factors"),

  enroll: () =>
    call<{ id: string; secret: string; uri: string }>("/auth/mfa/enroll", { method: "POST" }),

  challenge: (factorId: string) =>
    call<{ id: string }>("/auth/mfa/challenge", {
      method: "POST",
      body: JSON.stringify({ factorId }),
    }),

  verify: (factorId: string, challengeId: string, code: string) =>
    call<{ ok: true }>("/auth/mfa/verify", {
      method: "POST",
      body: JSON.stringify({ factorId, challengeId, code }),
    }),
};
