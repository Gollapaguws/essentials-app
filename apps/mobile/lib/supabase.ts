import * as SecureStore from "expo-secure-store";
import { createSupabaseClient } from "@essentials/auth";

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
