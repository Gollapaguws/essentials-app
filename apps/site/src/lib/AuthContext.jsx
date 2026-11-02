import React, { createContext, useContext, useState } from "react";
import { supabase } from "@/lib/supabase";
import { fetchMe, signOut as endSession } from "@/lib/auth";

const AuthContext = createContext(undefined);

/**
 * Site session state on Supabase.
 * Consumed shape: `user`, `isAuthenticated`, `isLoadingAuth`, `authChecked`,
 * `authError`, `logout`, `navigateToLogin`, `role`, `aal`, `mfaRequired`.
 */
export const AuthProvider = ({ children }) => {
  const [session, setSession] = useState(null);
  const [user, setUser] = useState(null);
  const [me, setMe] = useState(null);
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [isLoadingAuth, setIsLoadingAuth] = useState(true);
  const [authError, setAuthError] = useState(null);
  const [authChecked, setAuthChecked] = useState(false);

  const checkUserAuth = async () => {
    setIsLoadingAuth(true);
    const { data } = await supabase.auth.getSession();
    setSession(data.session ?? null);

    if (!data.session) {
      setUser(null);
      setMe(null);
      setIsAuthenticated(false);
      setIsLoadingAuth(false);
      setAuthChecked(true);
      return;
    }

    const identity = await fetchMe();
    setMe(identity ?? null);

    if (identity) {
      setUser({ email: identity.user.email, role: identity.user.role });
      setIsAuthenticated(true);
    } else {
      setUser({ email: data.session.user.email });
      setIsAuthenticated(true);
    }
    setIsLoadingAuth(false);
    setAuthChecked(true);
  };

  React.useEffect(() => {
    checkUserAuth();

    const { data: sub } = supabase.auth.onAuthStateChange((_event, next) => {
      setSession(next ?? null);
      if (!next) {
        setUser(null);
        setMe(null);
        setIsAuthenticated(false);
        setAuthChecked(true);
        setIsLoadingAuth(false);
        return;
      }
      // Re-read the canonical role after sign-in/token refresh.
      checkUserAuth();
    });

    return () => sub.subscription.unsubscribe();
  }, []);

  const logout = async () => {
    await endSession();
    setUser(null);
    setMe(null);
    setSession(null);
    setIsAuthenticated(false);
  };

  const navigateToLogin = () => {
    window.location.href = "/login";
  };

  const value = {
    session,
    user,
    isAuthenticated,
    isLoadingAuth,
    isLoadingPublicSettings: false,
    authError,
    appPublicSettings: null,
    authChecked,
    role: me?.user?.role ?? null,
    aal: me?.user?.aal ?? null,
    mfaRequired: Boolean(me?.mfaRequired),
    logout,
    navigateToLogin,
    checkUserAuth,
    checkAppState: checkUserAuth,
    setAuthError,
  };

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
};

export const useAuth = () => {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error("useAuth must be used within an AuthProvider");
  }
  return context;
};
