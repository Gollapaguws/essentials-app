"use client";

import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import type { Session } from "@supabase/supabase-js";
import { api, setAccessTokenProvider } from "@essentials/api-client";
import type { MeResponse } from "@essentials/auth";
import { supabase } from "@/lib/supabase";

interface AuthState {
  session: Session | null;
  me: MeResponse | null;
  loading: boolean;
  refresh: () => Promise<void>;
}

const AuthContext = createContext<AuthState>({
  session: null,
  me: null,
  loading: true,
  refresh: async () => {},
});

/**
 * Holds the Supabase session for the app shell and keeps the shared API client's
 * bearer token in sync. The API client reads the token lazily on every request,
 * so a refresh only needs to invalidate the session state here.
 */
export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [me, setMe] = useState<MeResponse | null>(null);
  const [loading, setLoading] = useState(true);

  const refresh = async () => {
    const { data } = await supabase.auth.getSession();
    if (!data.session) {
      setMe(null);
      return;
    }
    try {
      setMe(await api.get<MeResponse>("/auth/me"));
    } catch {
      setMe(null);
    }
  };

  useEffect(() => {
    setAccessTokenProvider(async () => {
      const { data } = await supabase.auth.getSession();
      return data.session?.access_token ?? null;
    });

    let active = true;
    supabase.auth.getSession().then(async ({ data }) => {
      if (!active) return;
      setSession(data.session);
      if (data.session) await refresh();
      if (active) setLoading(false);
    });

    const { data: sub } = supabase.auth.onAuthStateChange((_event, next) => {
      if (!active) return;
      setSession(next);
      if (next) void refresh();
      else setMe(null);
    });

    return () => {
      active = false;
      sub.subscription.unsubscribe();
    };
  }, []);

  const value = useMemo(() => ({ session, me, loading, refresh }), [session, me, loading]);

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export const useAuth = () => useContext(AuthContext);
