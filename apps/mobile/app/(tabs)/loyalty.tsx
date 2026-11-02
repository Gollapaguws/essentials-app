import { useEffect, useState } from "react";
import { ScrollView, Text, View, Pressable, StyleSheet } from "react-native";
import * as Clipboard from "expo-clipboard";
import { colors, type } from "../../theme";
import { api, type LoyaltyStatus, type ReferralInfo } from "@essentials/api-client";

/** Loyalty counter + personal referral link with reward tracking. */
export default function Loyalty() {
  const [loyalty, setLoyalty] = useState<LoyaltyStatus | null>(null);
  const [referral, setReferral] = useState<ReferralInfo | null>(null);

  useEffect(() => {
    api.get<LoyaltyStatus>("/loyalty").then(setLoyalty).catch(() => {});
    api.get<ReferralInfo>("/loyalty/referral").then(setReferral).catch(() => {});
  }, []);

  return (
    <ScrollView style={s.wrap} contentContainerStyle={{ paddingBottom: 40 }}>
      <Text style={[type.display, { color: colors.neon }]}>LOYALTY</Text>
      {loyalty && (
        <View style={s.card}>
          <Text style={{ color: colors.text, fontSize: 22, fontWeight: "900" }}>{loyalty.label}</Text>
          <View style={s.barTrack}>
            <View style={[s.barFill, { width: `${(loyalty.cycleVisits / loyalty.target) * 100}%` }]} />
          </View>
          {loyalty.freeEntries > 0 && <Text style={{ color: colors.neon, fontWeight: "800", marginTop: 10 }}>{loyalty.freeEntries} FREE ENTRY earned 🎉</Text>}
        </View>
      )}
      <Text style={[type.display, { color: colors.neon, marginTop: 28, fontSize: 26 }]}>INVITE FRIENDS</Text>
      {referral && (
        <View style={s.card}>
          <Text style={{ color: colors.muted }}>Your link</Text>
          <Pressable onPress={() => Clipboard.setStringAsync(referral.link)}>
            <Text style={{ color: colors.neon, fontWeight: "700", marginTop: 4 }}>{referral.link} (tap to copy)</Text>
          </Pressable>
          <Text style={{ color: colors.text, marginTop: 12 }}>Invited: {referral.invited} · Rewarded: {referral.rewarded}</Text>
        </View>
      )}
    </ScrollView>
  );
}

const s = StyleSheet.create({
  wrap: { flex: 1, backgroundColor: colors.bg, padding: 16 },
  card: { backgroundColor: colors.surface, borderColor: colors.border, borderWidth: 1, borderRadius: 14, padding: 16, marginTop: 12 },
  barTrack: { height: 8, backgroundColor: colors.border, borderRadius: 4, marginTop: 14 },
  barFill: { height: 8, backgroundColor: colors.neon, borderRadius: 4 },
});
