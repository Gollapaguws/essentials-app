import { useState } from "react";
import { View, Text, TextInput, Pressable, StyleSheet } from "react-native";
import { router } from "expo-router";
import { colors, type } from "../theme";
import { api } from "@essentials/api-client";

/** 1/4 — Welcome: enter email -> magic link. */
export default function Welcome() {
  const [email, setEmail] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const sendLink = async () => {
    setLoading(true); setError(null);
    try {
      await api.post("/auth/magic-link", { email, mobile: true });
      router.push({ pathname: "/auth/verify", params: { email } });
    } catch (e) {
      setError("Couldn't send the link. Check the email and try again.");
    } finally {
      setLoading(false);
    }
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
      <Pressable style={s.button} onPress={sendLink} disabled={loading || !email.includes("@")}>
        <Text style={s.buttonText}>{loading ? "SENDING…" : "SIGN IN"}</Text>
      </Pressable>
      <Pressable onPress={() => router.push("/auth/invite")}>
        <Text style={{ color: colors.muted, marginTop: 16 }}>Got an invite code? →</Text>
      </Pressable>
      {error && <Text style={{ color: colors.danger, marginTop: 12 }}>{error}</Text>}
    </View>
  );
}

const s = StyleSheet.create({
  wrap: { flex: 1, backgroundColor: colors.bg, justifyContent: "center", padding: 24 },
  input: { borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surface, color: colors.text, borderRadius: 10, padding: 14, marginTop: 32 },
  button: { backgroundColor: colors.neon, borderRadius: 10, padding: 16, alignItems: "center", marginTop: 16 },
  buttonText: { color: colors.bg, fontWeight: "900", letterSpacing: 2 },
});
