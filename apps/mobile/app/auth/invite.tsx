import { useState } from "react";
import { View, Text, TextInput, Pressable, StyleSheet } from "react-native";
import { router } from "expo-router";
import { colors, type } from "../../theme";
import { api } from "@essentials/api-client";

/** 3/4 — Invite code validation: creates the account, binds referral. */
export default function Invite() {
  const [code, setCode] = useState("");
  const [error, setError] = useState<string | null>(null);

  const redeem = async () => {
    try {
      await api.post("/auth/invite/redeem", { code });
      router.push("/auth/profile");
    } catch (e) {
      setError("Invalid code or email already registered.");
    }
  };

  return (
    <View style={s.wrap}>
      <Text style={[type.title, { color: colors.text }]}>You're on the guest list of someone.</Text>
      <TextInput style={s.input} placeholder="Invite code" placeholderTextColor={colors.muted} value={code} onChangeText={setCode} autoCapitalize="characters" />
      <Pressable style={s.button} onPress={redeem} disabled={code.length < 4}>
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
