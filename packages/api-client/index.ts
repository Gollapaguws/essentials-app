/**
 * Thin typed API client shared by mobile + web.
 * Points at the NestJS API. The bearer token comes from the app's Supabase session
 * via a provider registered at startup, so no token is ever persisted here.
 */
export const API_URL =
  process.env.NEXT_PUBLIC_API_URL ??
  process.env.EXPO_PUBLIC_API_URL ??
  "http://localhost:4000/api";

export type AccessTokenProvider = () => string | null | Promise<string | null>;

let tokenProvider: AccessTokenProvider | null = null;

/** Register how to read the current Supabase access token (null clears it). */
export function setAccessTokenProvider(p: AccessTokenProvider | null): void {
  tokenProvider = p;
}

export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
    public code?: string,
  ) {
    super(message);
  }
}

async function currentToken(): Promise<string | null> {
  if (!tokenProvider) return null;
  try {
    return await tokenProvider();
  } catch {
    // A provider failure must not break the request; the API answers 401 if it matters.
    return null;
  }
}

async function toError(res: Response): Promise<ApiError> {
  const raw = await res.text();
  try {
    const body = JSON.parse(raw) as { code?: string; message?: string | string[] };
    const message = Array.isArray(body.message)
      ? body.message.join(", ")
      : (body.message ?? body.code ?? raw);
    return new ApiError(res.status, message || res.statusText, body.code);
  } catch {
    return new ApiError(res.status, raw || res.statusText);
  }
}

async function send(path: string, init: RequestInit | undefined, token: string | null) {
  return fetch(`${API_URL}${path}`, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...init?.headers,
    },
  });
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  let token = await currentToken();
  let res = await send(path, init, token);

  // Exactly one retry: the session may have refreshed between sign-in and this call.
  if (res.status === 401 && tokenProvider) {
    token = await currentToken();
    if (token) res = await send(path, init, token);
  }

  if (!res.ok) throw await toError(res);
  return res.json() as Promise<T>;
}

export const api = {
  get: <T>(path: string) => request<T>(path),
  post: <T>(path: string, body?: unknown) =>
    request<T>(path, { method: "POST", body: body ? JSON.stringify(body) : undefined }),
  patch: <T>(path: string, body?: unknown) =>
    request<T>(path, { method: "PATCH", body: JSON.stringify(body) }),
  del: <T>(path: string) => request<T>(path, { method: "DELETE" }),
};

// ---- typed endpoints ----
export interface EventSummary {
  id: string; title: string; description?: string; date: string;
  lineup: { artistName: string; slot: string }[];
  dressCode?: string;
  venue: { name: string; lat: number; lng: number; amenities: string[] };
  going: number; capacity: number;
}
export interface RsvpResult { status: "attending" | "waitlisted"; going: number; capacity: number }
export interface DoorPass { eventId: string; qrToken: string; headcount: number }
export interface LoyaltyStatus { label: string; cycleVisits: number; target: number; remaining: number; freeEntries: number }
export interface ReferralInfo { code: string; link: string; invited: number; rewarded: number }
export interface VenueTableDto { id: string; tableNumber: string; capacity: number; minSpend: number; available: boolean }
