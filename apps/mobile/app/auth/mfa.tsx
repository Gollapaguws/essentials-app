import { useEffect, useState } from "react";
import { View, Text, TextInput, Pressable, StyleSheet } from "react-native";
import { router } from "expo-router";
import QRCode from "react-native-qrcode-svg";
import { api } from "@essentials/api-client";
import { colors, type } from "../../theme";
import { supabase } from "../../lib/supabase";

interface MeResponse {
  user: { role: string; aal: "aal1" | "aal2" };
  mfaRequired: boolean;
}

/** Staff accounts need two-step verification before data endpoints answer. */
export default function Mfa() {
  const [uri, setUri] = useState<string | null>(null);
  const [secret, setSecret] = useState<string | null>(null);
  const [factorId, setFactorId] = useState<string | null>(null);
  const [challengeId, setChallengeId] = useState<string | null>(null);
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      const { data: session } = await supabase.auth.getSession();
      if (!session.session) return router.replace("/");

      const { data: factors } = await supabase.auth.mfa.listFactors();
      const existing = factors?.totp?.[0];

      if (existing) {
        const { data: challenge, error: challengeError } = await supabase.auth.mfa.challenge({
          factorId: existing.id,
        });
        if (challengeError) {
          setError(challengeError.message);
          setBusy(false);
          return;
        }
        setFactorId(existing.id);
        setChallengeId(challenge.id);
        setBusy(false);
        return;
      }

      const { data: enrolled, error: enrollError } = await supabase.auth.mfa.enroll({
        factorType: "totp",
      });
      if (enrollError) {
        setError(enrollError.message);
        setBusy(false);
        return;
      }
      setFactorId(enrolled.id);
      setSecret(enrolled.totp.secret);
      setUri(enrolled.totp.uri);

      const { data: challenge } = await supabase.auth.mfa.challenge({ factorId: enrolled.id });
      setChallengeId(challenge?.id ?? null);
      setBusy(false);
    })();
  }, []);

  const verify = async () => {
    if (!factorId || !challengeId) return;
    setBusy(true);
    setError(null);

    const { error: verifyError } = await supabase.auth.mfa.verify({
      factorId,
      challengeId,
      code: code.trim(),
    });
    if (verifyError) {
      setBusy(false);
      setError("That code did not work. Try again.");
      return;
    }

    await supabase.auth.refreshSession();
    try {
      const me = await api.get<MeResponse>("/auth/me");
      if (!me.mfaRequired) {
        router.replace("/(tabs)/events");
        return;
      }
    } catch {
      /* fall through */
    }
    setBusy(false);
    setError("Two-step verification is not active yet. Try again.");
  };

  return (
    <View style={s.wrap}>
      <Text style={[type.title, { color: colors.text }]}>Two-step verification</Text>
      <Text style={{ color: colors.muted, marginTop: 8 }}>
        Add ESSENTIALS to your authenticator app to keep staff tools protected.
      </Text>

      {uri && (
        <View style={{ alignItems: "center", marginTop: 20 }}>
          <View style={{ backgroundColor: "#fff", padding: 12, borderRadius: 12 }}>
            <QRCode value={uri} size={180} />
          </View>
          {secret && (
            <Text style={{ color: colors.muted, marginTop: 10, fontSize: 12, textAlign: "center" }}>
              Manual key: {secret}
            </Text>
          )}
        </View>
      )}

      <TextInput
        style={s.input}
        placeholder="123456"
        placeholderTextColor={colors.muted}
        keyboardType="number-pad"
        maxLength={6}
        value={code}
        onChangeText={(v) => setCode(v.replace(/\D/g, ""))}
      />
      <Pressable style={s.button} onPress={verify} disabled={busy || code.length !== 6}>
        <Text style={s.buttonText}>{busy ? "CHECKING…" : "VERIFY"}</Text>
      </Pressable>
      {error && <Text style={{ color: colors.danger, marginTop: 12 }}>{error}</Text>}
    </View>
  );
}

const s = StyleSheet.create({
  wrap: { flex: 1, backgroundColor: colors.bg, padding: 24, paddingTop: 40 },
  input: { borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surface, color: colors.text, borderRadius: 10, padding: 14, marginTop: 20, textAlign: "center", letterSpacing: 6 },
  button: { backgroundColor: colors.neon, borderRadius: 10, padding: 16, alignItems: "center", marginTop: 16 },
  buttonText: { color: colors.bg, fontWeight: "900", letterSpacing: 2 },
});
