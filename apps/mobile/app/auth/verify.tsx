import { useState } from "react";
import { View, Text, TextInput, Pressable, StyleSheet } from "react-native";
import { router, useLocalSearchParams } from "expo-router";
import { colors, type } from "../../theme";
import { api } from "@essentials/api-client";

/** 2/4 — Paste magic-link token (deep link also lands here with ?token=). */
export default function Verify() {
  const { token: deepLinkToken } = useLocalSearchParams<{ token?: string }>();
  const [token, setToken2] = useState(deepLinkToken ?? "");
  const [error, setError] = useState<string | null>(null);

  const verify = async () => {
    try {
      await api.post("/auth/verify", { token });
      router.replace("/(tabs)/events");
    } catch (e: any) {
      setError(String(e?.message ?? "").includes("NO_ACCOUNT") ? "No account yet — use your invite code." : "Link expired. Request a new one.");
      if (String(e?.message ?? "").includes("NO_ACCOUNT")) router.push("/auth/invite");
    }
  };

  return (
    <View style={s.wrap}>
      <Text style={[type.title, { color: colors.text }]}>Paste your sign-in link token</Text>
      <TextInput style={s.input} value={token} onChangeText={setToken2} placeholder="token" placeholderTextColor={colors.muted} autoCapitalize="none" multiline />
      <Pressable style={s.button} onPress={verify}>
        <Text style={s.buttonText}>VERIFY</Text>
      </Pressable>
      {error && <Text style={{ color: colors.danger, marginTop: 12 }}>{error}</Text>}
    </View>
  );
}

const s = StyleSheet.create({
  wrap: { flex: 1, backgroundColor: colors.bg, padding: 24, justifyContent: "center" },
  input: { borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surface, color: colors.text, borderRadius: 10, padding: 14, marginTop: 24, minHeight: 80 },
  button: { backgroundColor: colors.neon, borderRadius: 10, padding: 16, alignItems: "center", marginTop: 16 },
  buttonText: { color: colors.bg, fontWeight: "900", letterSpacing: 2 },
});
