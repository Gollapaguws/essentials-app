import { createClient, type SupabaseClient } from "@supabase/supabase-js";

export type AuthRole = "guest" | "artist" | "promoter" | "venue_manager" | "admin";

/** Canonical identity returned by `GET /api/auth/me`. */
export interface AuthUser {
  sub: string;
  email: string;
  role: AuthRole | null;
  aal: "aal1" | "aal2";
}

export type MeResponse =
  | { user: AuthUser; mfaRequired: boolean }
  | { inviteRequired: true; email: string };

export interface AuthStorage {
  getItem(key: string): string | null | Promise<string | null>;
  setItem(key: string, value: string): void | Promise<void>;
  removeItem(key: string): void | Promise<void>;
}

export interface CreateSupabaseClientOptions {
  url: string;
  anonKey: string;
  storage?: AuthStorage;
  flowType?: "pkce" | "implicit";
  /**
   * Default `false`: every app exchanges the PKCE code explicitly on its own
   * callback screen, so auto-detection would consume the verifier first.
   */
  detectSessionInUrl?: boolean;
}

export function createSupabaseClient(o: CreateSupabaseClientOptions): SupabaseClient {
  return createClient(o.url, o.anonKey, {
    auth: {
      flowType: o.flowType ?? "pkce",
      detectSessionInUrl: o.detectSessionInUrl ?? false,
      autoRefreshToken: true,
      persistSession: true,
      ...(o.storage ? { storage: o.storage } : {}),
    },
  });
}

/** Roles that must satisfy MFA (`aal2`) before data endpoints answer. */
export const MFA_REQUIRED_ROLES: readonly AuthRole[] = ["promoter", "venue_manager", "admin"];

/** Role allowed into the promoter dashboard. */
export const DASHBOARD_ROLES: readonly AuthRole[] = ["promoter", "venue_manager", "admin"];
