"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import type { MeResponse } from "@essentials/auth";
import { session } from "@/lib/session";

interface AuthState {
  me: MeResponse | null;
  loading: boolean;
  /** True once /auth/me has answered for this browser's session cookie. */
  authenticated: boolean;
  refresh: () => Promise<void>;
}

const AuthContext = createContext<AuthState>({
  me: null,
  loading: true,
  authenticated: false,
  refresh: async () => {},
});

/**
 * Reads the signed-in identity from the API using the httpOnly session cookie.
 * Nothing token-shaped is stored in the browser, so there is no session object
 * to keep in sync — a refresh just asks the API again.
 */
export function AuthProvider({ children }: { children: ReactNode }) {
  const [me, setMe] = useState<MeResponse | null>(null);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    try {
      setMe(await session.me());
    } catch {
      // 401 is the normal "not signed in" answer.
      setMe(null);
    }
  }, []);

  useEffect(() => {
    let active = true;
    refresh().finally(() => {
      if (active) setLoading(false);
    });
    return () => {
      active = false;
    };
  }, [refresh]);

  const value = useMemo(
    () => ({ me, loading, authenticated: Boolean(me), refresh }),
    [me, loading, refresh],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export const useAuth = () => useContext(AuthContext);
