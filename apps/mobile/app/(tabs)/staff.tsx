import { useCallback, useEffect, useState } from "react";
import { FlatList, StyleSheet, Text, View, RefreshControl } from "react-native";
import { ApiError, api } from "@essentials/api-client";
import { colors, type } from "../../theme";

interface StaffEvent {
  id: string;
  title: string;
  date: string;
  status: string;
  capacity: number;
  venue: { name: string };
  _count: { guestLists: number; tableBookings: number };
}

/**
 * Staff tab: the nights this promoter owns, with list fill at a glance.
 * `(tabs)/_layout` only mounts the tab for promoter/admin, but the endpoint
 * answers 403 to everyone else, so a direct link still gets the gate message.
 */
export default function Staff() {
  const [events, setEvents] = useState<StaffEvent[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    try {
      setEvents(await api.get<StaffEvent[]>("/events/manage/list"));
      setError(null);
    } catch (err) {
      setError(
        err instanceof ApiError && err.status === 403
          ? "Staff access only: this account is not a promoter yet. An admin sets roles on the Users page of the dashboard."
          : "Couldn't load your events. Pull to retry.",
      );
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const upcoming = events.filter((e) => new Date(e.date) >= new Date());
  const onList = events.reduce((sum, e) => sum + e._count.guestLists, 0);
  const capacity = events.reduce((sum, e) => sum + e.capacity, 0);
  const fill = capacity > 0 ? Math.round((onList / capacity) * 100) : 0;

  return (
    <FlatList
      style={{ backgroundColor: colors.bg }}
      contentContainerStyle={s.wrap}
      data={events}
      keyExtractor={(e) => e.id}
      refreshControl={
        <RefreshControl
          refreshing={refreshing}
          onRefresh={async () => {
            setRefreshing(true);
            await load();
            setRefreshing(false);
          }}
          tintColor={colors.neon}
        />
      }
      ListHeaderComponent={
        <View style={{ gap: 12 }}>
          <Text style={[type.display, { color: colors.neon }]}>STAFF</Text>
          {error ? (
            <Text style={{ color: colors.muted }}>{error}</Text>
          ) : (
            <View style={s.card}>
              <Text style={{ color: colors.neon, fontWeight: "800", letterSpacing: 1 }}>
                YOUR NIGHTS
              </Text>
              <View style={s.stats}>
                <View style={s.stat}>
                  <Text style={s.statValue}>{events.length}</Text>
                  <Text style={s.statLabel}>EVENTS</Text>
                </View>
                <View style={s.stat}>
                  <Text style={s.statValue}>{upcoming.length}</Text>
                  <Text style={s.statLabel}>UPCOMING</Text>
                </View>
                <View style={s.stat}>
                  <Text style={s.statValue}>{fill}%</Text>
                  <Text style={s.statLabel}>LIST FILL</Text>
                </View>
              </View>
              <Text style={{ color: colors.muted, marginTop: 12 }}>
                {onList} on the list of {capacity} seats. Door passes and table revenue live in the
                dashboard.
              </Text>
            </View>
          )}
        </View>
      }
      ListEmptyComponent={
        error ? null : <Text style={{ color: colors.muted }}>No events yet — create one in the dashboard.</Text>
      }
      renderItem={({ item }) => (
        <View style={s.card}>
          <Text style={{ color: colors.text, fontWeight: "800", fontSize: 16 }}>{item.title}</Text>
          <Text style={{ color: colors.muted, marginTop: 4 }}>
            {item.venue.name} · {new Date(item.date).toDateString()}
          </Text>
          <View style={s.row}>
            <Text style={{ color: colors.neon, fontWeight: "800" }}>
              {item._count.guestLists}/{item.capacity} ON THE LIST
            </Text>
            <Text style={{ color: colors.muted, letterSpacing: 1, fontSize: 12 }}>
              {item.status.toUpperCase()}
            </Text>
          </View>
          <View style={s.barTrack}>
            <View
              style={[
                s.barFill,
                { width: `${Math.min(100, Math.round((item._count.guestLists / Math.max(1, item.capacity)) * 100))}%` },
              ]}
            />
          </View>
          <Text style={{ color: colors.muted, marginTop: 8 }}>
            {item._count.tableBookings} table bookings
          </Text>
        </View>
      )}
    />
  );
}

const s = StyleSheet.create({
  wrap: { padding: 16, gap: 12, paddingBottom: 40 },
  card: {
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderWidth: 1,
    borderRadius: 14,
    padding: 16,
  },
  stats: { flexDirection: "row", gap: 12, marginTop: 12 },
  stat: { flex: 1 },
  statValue: { color: colors.text, fontSize: 22, fontWeight: "900" },
  statLabel: { color: colors.muted, fontSize: 11, letterSpacing: 1, marginTop: 2 },
  row: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 12, marginTop: 12 },
  barTrack: { height: 8, backgroundColor: colors.border, borderRadius: 4, marginTop: 8 },
  barFill: { height: 8, backgroundColor: colors.neon, borderRadius: 4 },
});
