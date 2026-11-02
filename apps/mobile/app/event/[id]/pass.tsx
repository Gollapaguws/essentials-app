import { useEffect, useState } from "react";
import { View, Text, StyleSheet } from "react-native";
import { useLocalSearchParams } from "expo-router";
import QRCode from "react-native-qrcode-svg";
import { colors, type } from "../../../theme";
import { api, type DoorPass } from "@essentials/api-client";

/** Door pass: QR code for check-in at the door. */
export default function DoorPassScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const [pass, setPass] = useState<DoorPass | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api.get<DoorPass>(`/events/${id}/door-pass`).then(setPass).catch(() => setError("No door pass — RSVP first."));
  }, [id]);

  return (
    <View style={s.wrap}>
      {pass ? (
        <View style={s.card}>
          <Text style={[type.title, { color: colors.neon, letterSpacing: 3 }]}>DOOR PASS</Text>
          <View style={s.qrBox}>
            <QRCode value={pass.qrToken} size={220} backgroundColor="#FFFFFF" color="#0A0A0A" />
          </View>
          <Text style={{ color: colors.muted }}>Show at the door · {pass.headcount} guest(s)</Text>
        </View>
      ) : (
        <Text style={{ color: colors.danger }}>{error ?? "Loading…"}</Text>
      )}
    </View>
  );
}

const s = StyleSheet.create({
  wrap: { flex: 1, backgroundColor: colors.bg, alignItems: "center", justifyContent: "center", padding: 24 },
  card: { backgroundColor: colors.surface, borderColor: colors.border, borderWidth: 1, borderRadius: 20, padding: 28, alignItems: "center", gap: 16 },
  qrBox: { backgroundColor: "#FFFFFF", padding: 16, borderRadius: 12 },
});
