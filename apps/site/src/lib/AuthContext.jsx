import React, { createContext, useCallback, useContext, useEffect, useState } from "react";
import { supabase } from "@/lib/supabase";
import { fetchMe, signOut as endSession } from "@/lib/auth";

const AuthContext = createContext(undefined);

/**
 * Site session state on Supabase.
 * Keeps the pre-existing consumer shape (`user`, `isAuthenticated`, `isLoadingAuth`,
 * `authChecked`, `authError`, `checkUserAuth`, `logout`, `navigateToLogin`) and adds
 * `role`, `aal`, `mfaRequired` from the canonical `/auth/me` response.
 */
export const AuthProvider = ({ children }) => {
  const [session, setSession] = useState(null);
  const [user, setUser] = useState(null);
  const [me, setMe] = useState(null);
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [isLoadingAuth, setIsLoadingAuth] = useState(true);
  const [authError, setAuthError] = useState(null);
  const [authChecked, setAuthChecked] = useState(false);

  const checkUserAuth = useCallback(async () => {
    setIsLoadingAuth(true);
    const { data } = await supabase.auth.getSession();
    setSession(data.session ?? null);

    if (!data.session) {
      setUser(null);
      setMe(null);
      setIsAuthenticated(false);
      setIsLoadingAuth(false);
      setAuthChecked(true);
      return null;
    }

    const identity = await fetchMe();
    setMe(identity ?? null);

    if (!identity || identity.inviteRequired) {
      setUser({ email: data.session.user.email });
      setIsAuthenticated(true);
      setIsLoadingAuth(false);
      setAuthChecked(true);
      return identity;
    }

    setUser({ email: identity.user.email, role: identity.user.role });
    setIsAuthenticated(true);
    setIsLoadingAuth(false);
    setAuthChecked(true);
    return identity;
  }, []);

  useEffect(() => {
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
  }, [checkUserAuth]);

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
    role: me && !me.inviteRequired ? me.user.role : null,
    aal: me && !me.inviteRequired ? me.user.aal : null,
    mfaRequired: Boolean(me && !me.inviteRequired && me.mfaRequired),
    inviteRequired: Boolean(me && me.inviteRequired),
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
