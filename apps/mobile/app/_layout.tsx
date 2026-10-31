import { useEffect, useState } from "react";
import { Stack } from "expo-router";
import { StatusBar } from "expo-status-bar";
import { setAccessTokenProvider } from "@essentials/api-client";
import { colors } from "../theme";
import { supabase } from "../lib/supabase";

export default function Layout() {
  const [ready, setReady] = useState(false);

  useEffect(() => {
    setAccessTokenProvider(async () => {
      const { data } = await supabase.auth.getSession();
      return data.session?.access_token ?? null;
    });
    // Restore the persisted session before the first screen decides where to go.
    supabase.auth.getSession().finally(() => setReady(true));
  }, []);

  if (!ready) return null;

  return (
    <>
      <StatusBar style="light" />
      <Stack
        screenOptions={{
          headerStyle: { backgroundColor: colors.bg },
          headerTintColor: colors.neon,
          contentStyle: { backgroundColor: colors.bg },
          headerTitleStyle: { fontWeight: "900", letterSpacing: 2 },
        }}
      >
        <Stack.Screen name="index" options={{ headerShown: false }} />
        <Stack.Screen name="auth/verify" options={{ title: "SIGN IN" }} />
        <Stack.Screen name="auth/invite" options={{ title: "INVITE CODE" }} />
        <Stack.Screen name="auth/profile" options={{ title: "PROFILE" }} />
        <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
        <Stack.Screen name="event/[id]" options={{ title: "EVENT" }} />
        <Stack.Screen name="event/[id]/pass" options={{ title: "DOOR PASS" }} />
        <Stack.Screen name="event/[id]/chat" options={{ title: "EVENT CHAT" }} />
      </Stack>
    </>
  );
}
