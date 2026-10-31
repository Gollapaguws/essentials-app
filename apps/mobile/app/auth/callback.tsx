import { useEffect, useState } from "react";
import { View, Text, Pressable, StyleSheet } from "react-native";
import { router, useLocalSearchParams } from "expo-router";
import { api } from "@essentials/api-client";
import { colors, type } from "../../theme";
import { supabase } from "../../lib/supabase";

interface MeResponse {
  user: { sub: string; email: string; role: string; aal: "aal1" | "aal2" };
  mfaRequired: boolean;
}

/**
 * Deep-link landing (`essentials://auth/callback?code=…`).
 * The PKCE verifier is in SecureStore on this device, so the exchange happens here.
 */
export default function AuthCallback() {
  const { code } = useLocalSearchParams<{ code?: string }>();
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!code) {
      setError("This link is incomplete or has expired.");
      return;
    }

    (async () => {
      const { error: exchangeError } = await supabase.auth.exchangeCodeForSession(code);
      if (exchangeError) {
        setError("This link has expired. Request a new one.");
        return;
      }

      try {
        const me = await api.get<MeResponse>("/auth/me");
        if (me.mfaRequired) router.replace("/auth/mfa");
        else router.replace("/(tabs)/events");
      } catch (e: any) {
        if (e?.status === 401) {
          // No Prisma account yet: onboarding continues with an invite code.
          router.replace("/auth/invite");
          return;
        }
        setError("Signed in, but your account could not be loaded.");
      }
    })();
  }, [code]);

  return (
    <View style={s.wrap}>
      {error ? (
        <>
          <Text style={[type.title, { color: colors.text }]}>Sign-in failed</Text>
          <Text style={{ color: colors.muted, marginTop: 8, textAlign: "center" }}>{error}</Text>
          <Pressable style={s.button} onPress={() => router.replace("/")}>
            <Text style={s.buttonText}>SEND A NEW LINK</Text>
          </Pressable>
        </>
      ) : (
        <Text style={[type.body, { color: colors.muted, letterSpacing: 2 }]}>SIGNING YOU IN…</Text>
      )}
    </View>
  );
}

const s = StyleSheet.create({
  wrap: { flex: 1, backgroundColor: colors.bg, alignItems: "center", justifyContent: "center", padding: 24 },
  button: { backgroundColor: colors.neon, borderRadius: 10, padding: 16, alignItems: "center", marginTop: 24, alignSelf: "stretch" },
  buttonText: { color: colors.bg, fontWeight: "900", letterSpacing: 2 },
});
