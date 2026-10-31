import { useState } from "react";
import { View, Text, TextInput, Pressable, StyleSheet, Linking } from "react-native";
import { router } from "expo-router";
import * as WebBrowser from "expo-web-browser";
import { colors, type } from "../theme";
import { supabase } from "../lib/supabase";

/** Deep link Supabase sends the PKCE code back to. */
const CALLBACK = "essentials://auth/callback";

/** 1/4 — Welcome: enter email -> sign-in link, or continue with Google. */
export default function Welcome() {
  const [email, setEmail] = useState("");
  const [loading, setLoading] = useState(false);
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const sendLink = async () => {
    setLoading(true);
    setError(null);
    const { error: err } = await supabase.auth.signInWithOtp({
      email,
      options: { emailRedirectTo: CALLBACK },
    });
    setLoading(false);
    if (err) setError("Couldn't send the link. Check the email and try again.");
    else setSent(true);
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

      {sent ? (
        <>
          <Text style={[type.body, { color: colors.text, marginTop: 32 }]}>
            Check {email} — tap the link to sign in.
          </Text>
          <Pressable onPress={() => setSent(false)}>
            <Text style={{ color: colors.muted, marginTop: 16 }}>Use a different email →</Text>
          </Pressable>
        </>
      ) : (
        <>
          <TextInput
            style={s.input}
            placeholder="you@email.com"
            placeholderTextColor={colors.muted}
            autoCapitalize="none"
            keyboardType="email-address"
            value={email}
            onChangeText={setEmail}
          />
          <Pressable style={s.button} onPress={sendLink} disabled={loading || !email.includes("@")}>
            <Text style={s.buttonText}>{loading ? "SENDING…" : "SIGN IN"}</Text>
          </Pressable>
          <Pressable style={s.ghost} onPress={google}>
            <Text style={{ color: colors.text, fontWeight: "700" }}>CONTINUE WITH GOOGLE</Text>
          </Pressable>
          <Pressable onPress={() => router.push("/auth/invite")}>
            <Text style={{ color: colors.muted, marginTop: 16 }}>Got an invite code? →</Text>
          </Pressable>
        </>
      )}

      {error && <Text style={{ color: colors.danger, marginTop: 12 }}>{error}</Text>}
    </View>
  );
}

const s = StyleSheet.create({
  wrap: { flex: 1, backgroundColor: colors.bg, justifyContent: "center", padding: 24 },
  input: { borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surface, color: colors.text, borderRadius: 10, padding: 14, marginTop: 32 },
  button: { backgroundColor: colors.neon, borderRadius: 10, padding: 16, alignItems: "center", marginTop: 16 },
  ghost: { borderWidth: 1, borderColor: colors.border, borderRadius: 10, padding: 16, alignItems: "center", marginTop: 12 },
  buttonText: { color: colors.bg, fontWeight: "900", letterSpacing: 2 },
});
