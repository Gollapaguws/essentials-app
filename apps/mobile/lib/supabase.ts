import * as SecureStore from "expo-secure-store";
import { createSupabaseClient } from "@essentials/auth";
import { setAccessTokenProvider } from "@essentials/api-client";

/** Session survives an app restart: the refresh token lives in the device keychain. */
export const supabase = createSupabaseClient({
  url: process.env.EXPO_PUBLIC_SUPABASE_URL!,
  anonKey: process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY!,
  storage: {
    getItem: (k) => SecureStore.getItemAsync(k),
    setItem: (k, v) => SecureStore.setItemAsync(k, v),
    removeItem: (k) => SecureStore.deleteItemAsync(k),
  },
});

/**
 * Registered at import time, not in the root layout's effect: screens run their
 * effects first, so a tab that loaded data on mount would fire without a bearer
 * token and quietly show "couldn't load" while the session was fine.
 */
setAccessTokenProvider(async () => {
  const { data } = await supabase.auth.getSession();
  return data.session?.access_token ?? null;
});
