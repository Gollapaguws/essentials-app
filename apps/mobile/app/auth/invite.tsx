import { useState } from "react";
import { View, Text, TextInput, Pressable, StyleSheet } from "react-native";
import { router } from "expo-router";
import { colors, type } from "../../theme";
import { api, setToken } from "@essentials/api-client";

/** 3/4 — Invite code validation: creates the account, binds referral. */
export default function Invite() {
  const [code, setCode] = useState("");
  const [email, setEmail] = useState("");
  const [error, setError] = useState<string | null>(null);

  const redeem = async () => {
    try {
      const res = await api.post<{ accessToken: string }>("/auth/invite/redeem", { code, email });
      setToken(res.accessToken);
      router.push("/auth/profile");
    } catch (e) {
      setError("Invalid code or email already registered.");
    }
  };

  return (
    <View style={s.wrap}>
      <Text style={[type.title, { color: colors.text }]}>You're on the guest list of someone.</Text>
      <TextInput style={s.input} placeholder="Invite code" placeholderTextColor={colors.muted} value={code} onChangeText={setCode} autoCapitalize="characters" />
      <TextInput style={s.input} placeholder="you@email.com" placeholderTextColor={colors.muted} value={email} onChangeText={setEmail} autoCapitalize="none" keyboardType="email-address" />
      <Pressable style={s.button} onPress={redeem} disabled={!code || !email.includes("@")}>
        <Text style={s.buttonText}>JOIN ESSENTIALS</Text>
      </Pressable>
      {error && <Text style={{ color: colors.danger, marginTop: 12 }}>{error}</Text>}
    </View>
  );
}

const s = StyleSheet.create({
  wrap: { flex: 1, backgroundColor: colors.bg, padding: 24, justifyContent: "center" },
  input: { borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surface, color: colors.text, borderRadius: 10, padding: 14, marginTop: 12 },
  button: { backgroundColor: colors.neon, borderRadius: 10, padding: 16, alignItems: "center", marginTop: 20 },
  buttonText: { color: colors.bg, fontWeight: "900", letterSpacing: 2 },
});
