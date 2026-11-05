import { useState } from "react";
import { View, Text, TextInput, Pressable, StyleSheet, Linking } from "react-native";
import * as WebBrowser from "expo-web-browser";
import { router } from "expo-router";
import { api } from "@essentials/api-client";
import { colors, type } from "../theme";
import { supabase } from "../lib/supabase";
import { FieldHint } from "../components/FieldHint";

/** Deep link Supabase sends the PKCE code back to. */
const CALLBACK = "essentials://auth/callback";

interface MeResponse {
  user: { sub: string; email: string; role: string; aal: "aal1" | "aal2" };
  mfaRequired: boolean;
}

/** 1/3 — Welcome: email + password, or continue with Google. */
export default function Welcome() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const signIn = async () => {
    setLoading(true);
    setError(null);
    const { error: err } = await supabase.auth.signInWithPassword({ email, password });
    if (err) {
      setLoading(false);
      setError("Wrong email or password.");
      return;
    }
    try {
      // MFA and role routing stay behind /auth/me, same as the deep-link route.
      const me = await api.get<MeResponse>("/auth/me");
      router.replace(me.mfaRequired ? "/auth/mfa" : "/(tabs)/events");
    } catch {
      setError("Signed in, but your account could not be loaded.");
    } finally {
      setLoading(false);
    }
  };

  const google = async () => {
    setError(null);
    const { data, error: err } = await supabase.auth.signInWithOAuth({
      provider: "google",
      options: { redirectTo: CALLBACK, skipBrowserRedirect: true },
    });
    if (err || !data?.url) {
      setError("Google sign-in is unavailable right now.");
      return;
    }
    // The auth session returns through the same deep link as an email sign-in.
    const result = await WebBrowser.openAuthSessionAsync(data.url, CALLBACK);
    if (result.type === "success" && result.url) Linking.openURL(result.url);
  };

  return (
    <View style={s.wrap}>
      <Text style={[type.display, { color: colors.neon }]}>ESSENTIALS</Text>
      <Text style={[type.body, { color: colors.muted, marginTop: 8 }]}>THE LIST IS THE NIGHT.</Text>

      <TextInput
        style={s.input}
        placeholder="you@email.com"
        placeholderTextColor={colors.muted}
        autoCapitalize="none"
        keyboardType="email-address"
        value={email}
        onChangeText={setEmail}
      />
      <FieldHint
        label="Which email?"
        hint="The address on your ESSENTIALS account. A new email creates a guest account on its own; admin, promoter and venue roles are assigned by an admin afterwards."
      />
      <TextInput
        style={s.input}
        placeholder="Password"
        placeholderTextColor={colors.muted}
        secureTextEntry
        autoCapitalize="none"
        autoComplete="current-password"
        value={password}
        onChangeText={setPassword}
      />
      <FieldHint
        label="Your password"
        hint="At least 8 characters, chosen when the account was created. Staff accounts add their 6-digit authenticator code after signing in."
      />
      <Pressable
        style={s.button}
        onPress={signIn}
        disabled={loading || !email.includes("@") || password.length < 1}
      >
        <Text style={s.buttonText}>{loading ? "WORKING…" : "SIGN IN"}</Text>
      </Pressable>
      <Pressable style={s.ghost} onPress={google}>
        <Text style={{ color: colors.text, fontWeight: "700" }}>CONTINUE WITH GOOGLE</Text>
      </Pressable>
      <FieldHint
        label="Using Google"
        hint="Signs in with the Google account already on this device. First time here? It creates your ESSENTIALS guest account."
      />

      {error && <Text style={{ color: colors.danger, marginTop: 12 }}>{error}</Text>}
    </View>
  );
}

const s = StyleSheet.create({
  wrap: { flex: 1, backgroundColor: colors.bg, justifyContent: "center", padding: 24 },
  input: { borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surface, color: colors.text, borderRadius: 10, padding: 14, marginTop: 16 },
  button: { backgroundColor: colors.neon, borderRadius: 10, padding: 16, alignItems: "center", marginTop: 16 },
  ghost: { borderWidth: 1, borderColor: colors.border, borderRadius: 10, padding: 16, alignItems: "center", marginTop: 12 },
  buttonText: { color: colors.bg, fontWeight: "900", letterSpacing: 2 },
});
