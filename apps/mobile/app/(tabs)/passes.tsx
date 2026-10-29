import { useEffect, useState } from "react";
import { FlatList, Text, Pressable, StyleSheet } from "react-native";
import { router } from "expo-router";
import { colors, type } from "../../theme";
import { api, type EventSummary, type RsvpResult } from "@essentials/api-client";

/** Door passes for events you're attending. */
export default function Passes() {
  const [events, setEvents] = useState<(EventSummary & { myRsvp?: { status: string } })[]>([]);

  useEffect(() => {
    api.get<any[]>("/events")
      .then(setEvents)
      .catch(() => {});
  }, []);

  // fetch per-event rsvp status lazily in detail page; here show attending hint
  return (
    <FlatList
      data={events}
      keyExtractor={(e) => e.id}
      contentContainerStyle={{ padding: 16, gap: 12 }}
      ListHeaderComponent={<Text style={[type.display, { color: colors.neon }]}>PASSES</Text>}
      ListEmptyComponent={<Text style={{ color: colors.muted }}>RSVP to an event to get your door pass.</Text>}
      renderItem={({ item }) => (
        <Pressable style={s.card} onPress={() => router.push(`/event/${item.id}/pass`)}>
          <Text style={{ color: colors.text, fontWeight: "800", fontSize: 16 }}>{item.title}</Text>
          <Text style={{ color: colors.neon, marginTop: 6, fontWeight: "700" }}>OPEN PASS →</Text>
        </Pressable>
      )}
    />
  );
}

const s = StyleSheet.create({
  card: { backgroundColor: colors.surface, borderColor: colors.border, borderWidth: 1, borderRadius: 14, padding: 16 },
});
