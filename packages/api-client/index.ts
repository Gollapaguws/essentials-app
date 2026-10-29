/**
 * Thin typed API client shared by mobile + web.
 * Points at the NestJS API. Token stored per platform (SecureStore on mobile).
 */
export const API_URL =
  process.env.NEXT_PUBLIC_API_URL ??
  process.env.EXPO_PUBLIC_API_URL ??
  "http://localhost:4000/api";

let token: string | null = null;
export const setToken = (t: string | null) => (token = t);
export const getToken = () => token;

/** Web: restore token saved by the dashboard login. */
if (typeof localStorage !== "undefined") {
  token = localStorage.getItem("essentials_token");
}

export class ApiError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

async function request<T>(path: string, init?: RequestInit & { raw?: false }): Promise<T> {
  const res = await fetch(`${API_URL}${path}`, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...init?.headers,
    },
  });
  if (!res.ok) {
    const body = await res.text();
    throw new ApiError(res.status, body || res.statusText);
  }
  return res.json() as Promise<T>;
}

export const api = {
  get: <T>(path: string) => request<T>(path),
  post: <T>(path: string, body?: unknown) => request<T>(path, { method: "POST", body: body ? JSON.stringify(body) : undefined }),
  patch: <T>(path: string, body?: unknown) => request<T>(path, { method: "PATCH", body: JSON.stringify(body) }),
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
