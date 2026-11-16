import { useCallback, useEffect, useMemo, useState } from "react";
import {
  FlatList,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { ApiError, api } from "@essentials/api-client";
import { colors, type } from "../../theme";

interface StaffEvent {
  id: string;
  title: string;
  date: string;
  status: string;
  capacity: number;
  venue: { name: string };
  _count: { guestLists: number };
}

interface Guest {
  id: string;
  name: string | null;
  email: string;
  headcount: number;
  status: string;
  checkedInAt: string | null;
}

const USABLE = ["approved", "live", "completed"];

/**
 * Check-in tab: one night, one search box, one action per guest. Mirrors the
 * dashboard's Door page, built for a phone at the entrance. `(tabs)/_layout`
 * only mounts it for door-capable roles, and the API gates the same endpoints.
 */
export default function DoorCheckIn() {
  const [events, setEvents] = useState<StaffEvent[]>([]);
  const [eventId, setEventId] = useState("");
  const [guests, setGuests] = useState<Guest[]>([]);
  const [query, setQuery] = useState("");
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  const loadEvents = useCallback(async () => {
    try {
      const rows = await api.get<StaffEvent[]>("/events/manage/list");
      const usable = rows.filter((e) => USABLE.includes(e.status));
      setEvents(usable);
      setEventId((current) =>
        current && usable.some((e) => e.id === current) ? current : (usable[0]?.id ?? ""),
      );
      setError(null);
    } catch (err) {
      setError(
        err instanceof ApiError && err.status === 403
          ? "Door access only: this account does not have the door role. An admin sets roles on the Users page of the dashboard."
          : "Couldn't load the nights. Pull to retry.",
      );
    }
  }, []);

  const loadGuests = useCallback(async () => {
    if (!eventId) {
      setGuests([]);
      return;
    }
    try {
      setGuests(await api.get<Guest[]>(`/events/${eventId}/guest-list`));
      setError(null);
    } catch (err) {
      setError(
        err instanceof ApiError && err.status === 403
          ? "This account cannot open the guest list for that night."
          : "Couldn't load the door list. Pull to retry.",
      );
    }
  }, [eventId]);

  useEffect(() => {
    loadEvents();
  }, [loadEvents]);

  useEffect(() => {
    loadGuests();
  }, [loadGuests]);

  const checkIn = async (guest: Guest) => {
    setBusyId(guest.id);
    setError(null);
    setNotice(null);
    try {
      const res = await api.post<{ result: string; guest: string | null }>(
        `/events/${eventId}/check-in-guest`,
        { guestListId: guest.id },
      );
      setNotice(
        res.result === "duplicate"
          ? `${res.guest ?? "That guest"} is already inside.`
          : `${res.guest ?? "Guest"} checked in.`,
      );
      await loadGuests();
    } catch (err) {
      setError(
        err instanceof ApiError && err.status === 403
          ? "This account cannot check guests in."
          : "Could not check that guest in. Try again.",
      );
    } finally {
      setBusyId(null);
    }
  };

  const selected = events.find((e) => e.id === eventId) ?? null;
  const onList = guests.filter((g) => g.status !== "waitlisted");
  const inside = guests.filter((g) => g.status === "checked_in");
  const insidePeople = inside.reduce((n, g) => n + (g.headcount || 1), 0);
  const today = new Date().toDateString();
  const todayEntries = inside.filter(
    (g) => g.checkedInAt && new Date(g.checkedInAt).toDateString() === today,
  ).length;
  const recent = useMemo(
    () =>
      [...inside]
        .filter((g) => g.checkedInAt)
        .sort((a, b) => +new Date(b.checkedInAt!) - +new Date(a.checkedInAt!))
        .slice(0, 5),
    [inside],
  );

  const term = query.trim().toLowerCase();
  const filtered = term
    ? onList.filter(
        (g) => (g.name ?? "").toLowerCase().includes(term) || g.email.toLowerCase().includes(term),
      )
    : onList;

  return (
    <FlatList
      style={{ backgroundColor: colors.bg }}
      contentContainerStyle={s.wrap}
      data={filtered}
      keyExtractor={(g) => g.id}
      keyboardShouldPersistTaps="handled"
      refreshControl={
        <RefreshControl
          refreshing={refreshing}
          onRefresh={async () => {
            setRefreshing(true);
            await loadEvents();
            await loadGuests();
            setRefreshing(false);
          }}
          tintColor={colors.neon}
        />
      }
      ListHeaderComponent={
        <View style={{ gap: 12 }}>
          <Text style={[type.display, { color: colors.neon }]}>CHECK-IN</Text>
          <Text style={{ color: colors.muted }}>
            Search the list by name or email and check guests in. Counters cover the whole night,
            not the search.
          </Text>

          {events.length > 1 && (
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={s.chips}>
              {events.map((e) => {
                const active = e.id === eventId;
                return (
                  <Pressable
                    key={e.id}
                    onPress={() => {
                      setEventId(e.id);
                      setQuery("");
                      setNotice(null);
                    }}
                    style={[s.chip, active && s.chipActive]}
                  >
                    <Text style={{ color: active ? colors.bg : colors.text, fontWeight: "800" }}>
                      {e.title}
                    </Text>
                    <Text style={{ color: active ? colors.bg : colors.muted, fontSize: 11 }}>
                      {new Date(e.date).toLocaleDateString([], { month: "short", day: "numeric" })}
                    </Text>
                  </Pressable>
                );
              })}
            </ScrollView>
          )}

          {selected && (
            <View style={s.card}>
              <Text style={{ color: colors.text, fontWeight: "800" }}>
                {selected.title} · {selected.venue.name}
              </Text>
              <Text style={{ color: colors.muted, marginTop: 2 }}>
                {new Date(selected.date).toDateString()} · {selected.status.toUpperCase()}
              </Text>
              <View style={s.stats}>
                <Stat label="ON LIST" value={String(onList.length)} />
                <Stat label="INSIDE" value={String(insidePeople)} />
                <Stat label="TODAY" value={String(todayEntries)} />
                <Stat label="CAPACITY" value={String(selected.capacity)} />
              </View>
            </View>
          )}

          {recent.length > 0 && (
            <View style={s.card}>
              <Text style={s.sectionLabel}>RECENT ENTRIES</Text>
              {recent.map((g) => (
                <View key={g.id} style={s.recentRow}>
                  <Text style={{ color: colors.text, flex: 1 }} numberOfLines={1}>
                    {g.name ?? g.email} · {g.headcount}
                  </Text>
                  <Text style={{ color: colors.muted, fontSize: 12 }}>
                    {new Date(g.checkedInAt!).toLocaleTimeString([], {
                      hour: "2-digit",
                      minute: "2-digit",
                    })}
                  </Text>
                </View>
              ))}
            </View>
          )}

          {notice && <Text style={{ color: colors.neon }}>{notice}</Text>}
          {error && <Text style={{ color: colors.danger }}>{error}</Text>}

          <TextInput
            style={s.input}
            placeholder="Search name or email"
            placeholderTextColor={colors.muted}
            autoCapitalize="none"
            autoCorrect={false}
            value={query}
            onChangeText={setQuery}
            accessibilityLabel="Search the guest list"
          />
        </View>
      }
      ListEmptyComponent={
        events.length === 0 ? null : (
          <Text style={{ color: colors.muted }}>
            {term ? "No guest on this list matches that search." : "No guests on this list yet."}
          </Text>
        )
      }
      renderItem={({ item }) => {
        const insideGuest = item.status === "checked_in";
        const waitlisted = item.status === "waitlisted";
        return (
          <View style={s.guestRow}>
            <View style={{ flex: 1 }}>
              <Text style={{ color: colors.text, fontWeight: "700" }} numberOfLines={1}>
                {item.name ?? item.email}
              </Text>
              <Text style={{ color: colors.muted, fontSize: 12 }} numberOfLines={1}>
                {item.name ? item.email : "no name"} · party of {item.headcount}
              </Text>
            </View>
            {waitlisted ? (
              <Text style={s.mutedTag}>WAITLISTED</Text>
            ) : insideGuest ? (
              <Text style={s.insideTag}>INSIDE</Text>
            ) : (
              <Pressable
                onPress={() => checkIn(item)}
                disabled={busyId === item.id}
                style={[s.button, busyId === item.id && { opacity: 0.5 }]}
              >
                <Text style={s.buttonText}>{busyId === item.id ? "…" : "CHECK IN"}</Text>
              </Pressable>
            )}
          </View>
        );
      }}
    />
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <View style={{ flex: 1 }}>
      <Text style={{ color: colors.text, fontSize: 20, fontWeight: "900" }}>{value}</Text>
      <Text style={{ color: colors.muted, fontSize: 10, letterSpacing: 1 }}>{label}</Text>
    </View>
  );
}

const s = StyleSheet.create({
  wrap: { padding: 16, gap: 12, paddingBottom: 40 },
  card: {
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderWidth: 1,
    borderRadius: 14,
    padding: 14,
    gap: 8,
  },
  chips: { gap: 8 },
  chip: {
    borderColor: colors.border,
    borderWidth: 1,
    backgroundColor: colors.surface,
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 8,
    gap: 2,
  },
  chipActive: { backgroundColor: colors.neon, borderColor: colors.neon },
  stats: { flexDirection: "row", gap: 8, marginTop: 4 },
  sectionLabel: { color: colors.neon, fontWeight: "800", letterSpacing: 1, fontSize: 12 },
  recentRow: { flexDirection: "row", alignItems: "center", gap: 8 },
  input: {
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
    color: colors.text,
    borderRadius: 10,
    padding: 14,
    fontSize: 16,
  },
  guestRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderWidth: 1,
    borderRadius: 12,
    padding: 14,
  },
  button: {
    backgroundColor: colors.neon,
    borderRadius: 8,
    paddingHorizontal: 14,
    paddingVertical: 10,
  },
  buttonText: { color: colors.bg, fontWeight: "900", letterSpacing: 1 },
  insideTag: { color: colors.neon, fontWeight: "800", letterSpacing: 1, fontSize: 12 },
  mutedTag: { color: colors.muted, fontWeight: "800", letterSpacing: 1, fontSize: 11 },
});
