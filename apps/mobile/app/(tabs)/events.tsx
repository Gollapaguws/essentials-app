import { useEffect, useState, useCallback } from "react";
import { FlatList, Text, View, Pressable, StyleSheet, RefreshControl } from "react-native";
import { router } from "expo-router";
import { colors, type } from "../../theme";
import { api, type EventSummary } from "@essentials/api-client";

/** Events feed: upcoming ESSENTIALS events across venues, live headcount. */
export default function EventsFeed() {
  const [events, setEvents] = useState<EventSummary[]>([]);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setEvents(await api.get<EventSummary[]>("/events"));
      setError(null);
    } catch {
      setError("Couldn't load events. Pull to retry.");
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  return (
    <FlatList
      data={events}
      keyExtractor={(e) => e.id}
      contentContainerStyle={{ padding: 16, gap: 12 }}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={async () => { setRefreshing(true); await load(); setRefreshing(false); }} tintColor={colors.neon} />}
      ListHeaderComponent={<Text style={[type.display, { color: colors.neon, marginBottom: 8 }]}>UPCOMING</Text>}
      ListEmptyComponent={<Text style={{ color: colors.muted }}>{error ?? "No upcoming events yet."}</Text>}
      renderItem={({ item }) => (
        <Pressable style={s.card} onPress={() => router.push(`/event/${item.id}`)}>
          <Text style={[type.title, { color: colors.text }]}>{item.title}</Text>
          <Text style={{ color: colors.muted, marginTop: 4 }}>{item.venue.name} · {new Date(item.date).toDateString()}</Text>
          <Text style={{ color: colors.neon, fontWeight: "800", marginTop: 8 }}>{item.going}/{item.capacity} GOING</Text>
        </Pressable>
      )}
    />
  );
}

const s = StyleSheet.create({
  card: { backgroundColor: colors.surface, borderColor: colors.border, borderWidth: 1, borderRadius: 14, padding: 16 },
});
