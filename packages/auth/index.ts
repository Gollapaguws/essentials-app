import { createClient, type SupabaseClient } from "@supabase/supabase-js";

export type AuthRole = "guest" | "artist" | "promoter" | "venue_manager" | "admin";

/** Canonical identity returned by `GET /api/auth/me`. */
export interface AuthUser {
  sub: string;
  email: string;
  role: AuthRole | null;
  aal: "aal1" | "aal2";
  /** True until the account's owner has chosen their own password. */
  mustResetPassword?: boolean;
}

export type MeResponse = { user: AuthUser; mfaRequired: boolean; mustResetPassword: boolean };

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

/** Roles allowed into the dashboard. DJs included: the artist portal lives there. */
export const DASHBOARD_ROLES: readonly AuthRole[] = ["artist", "promoter", "venue_manager", "admin"];

/**
 * Where a role should land after signing in. `/dashboard` is the promoter
 * analytics page, so artists and venue managers get their own home instead.
 */
export function landingPath(role: AuthRole | null): string {
  if (role === "artist") return "/artist";
  if (role === "venue_manager") return "/venue";
  return "/";
}
