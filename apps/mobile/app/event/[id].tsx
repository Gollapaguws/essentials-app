import { useEffect, useState } from "react";
import { ScrollView, Text, View, Pressable, StyleSheet } from "react-native";
import { router, useLocalSearchParams } from "expo-router";
import { colors, type } from "../../theme";
import { api, type EventSummary, type RsvpResult } from "@essentials/api-client";

/** Event detail: lineup, capacity, live headcount, RSVP + waitlist. */
export default function EventDetail() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const [event, setEvent] = useState<EventSummary & { status?: string } | null>(null);
  const [rsvpState, setRsvpState] = useState<string | null>(null);
  const [matches, setMatches] = useState<{ userId: string; name: string | null; sharedTastes: string[]; score: number }[]>([]);
  const [error, setError] = useState<string | null>(null);

  const load = async () => {
    try {
      const detail = await api.get<any>(`/events/${id}`);
      setEvent(detail);
      if (detail.myRsvp) setRsvpState(detail.myRsvp.status);
    } catch { setError("Couldn't load this event."); }
  };
  useEffect(() => { load(); }, [id]);

  useEffect(() => {
    api.get<any[]>(`/social/events/${id}/matches`).then(setMatches).catch(() => {});
  }, [id, rsvpState]);

  const rsvp = async () => {
    try {
      const res = await api.post<RsvpResult>(`/events/${id}/rsvp`);
      setRsvpState(res.status);
      load();
    } catch { setError("RSVP failed — maybe you're already on the list."); }
  };

  if (!event) return <View style={s.wrap}><Text style={{ color: colors.muted }}>{error ?? "Loading…"}</Text></View>;

  return (
    <ScrollView style={s.wrap} contentContainerStyle={{ paddingBottom: 120 }}>
      <Text style={[type.display, { color: colors.neon }]}>{event.title}</Text>
      <Text style={{ color: colors.muted, marginTop: 6 }}>{event.venue.name} · {new Date(event.date).toDateString()}</Text>
      <Text style={{ color: colors.text, marginTop: 16, fontWeight: "800", fontSize: 18 }}>{event.going}/{event.capacity} GOING</Text>
      {event.description && <Text style={{ color: colors.text, marginTop: 12 }}>{event.description}</Text>}
      <Text style={[s.section, { color: colors.muted }]}>LINEUP</Text>
      {(event.lineup ?? []).map((l, i) => (
        <View key={i} style={s.lineupRow}>
          <Text style={{ color: colors.text, fontWeight: "700" }}>{l.artistName}</Text>
          <Text style={{ color: colors.neon }}>{l.slot}</Text>
        </View>
      ))}
      {event.dressCode && <><Text style={[s.section, { color: colors.muted }]}>DRESS CODE</Text><Text style={{ color: colors.text }}>{event.dressCode}</Text></>}

      <View style={{ flexDirection: "row", gap: 10, marginTop: 24 }}>
        {!rsvpState ? (
          <Pressable style={[s.button, { flex: 1 }]} onPress={rsvp}>
            <Text style={s.buttonText}>RSVP</Text>
          </Pressable>
        ) : (
          <Pressable style={[s.button, rsvpState === "waitlisted" && { backgroundColor: colors.border }, { flex: 1 }]} onPress={() => router.push(`/event/${id}/pass`)} disabled={rsvpState === "waitlisted"}>
            <Text style={s.buttonText}>{rsvpState === "waitlisted" ? "WAITLISTED" : "DOOR PASS"}</Text>
          </Pressable>
        )}
        <Pressable style={[s.button, { backgroundColor: colors.border, flex: 1 }]} onPress={() => router.push(`/event/${id}/tables`)}>
          <Text style={[s.buttonText, { color: colors.neon }]}>VIP TABLES</Text>
        </Pressable>
      </View>
      {error && <Text style={{ color: colors.danger, marginTop: 12 }}>{error}</Text>}

      <Text style={[s.section, { color: colors.muted }]}>PEOPLE LIKE YOU ARE GOING</Text>
      {(matches.length ? matches : []).map((m) => (
        <View key={m.userId} style={s.matchRow}>
          <Text style={{ color: colors.text, fontWeight: "700", flex: 1 }}>{m.name ?? "Guest"}</Text>
          <Text style={{ color: colors.neon, fontSize: 12 }}>{m.sharedTastes.join(" · ")}</Text>
        </View>
      ))}
      {!matches.length && <Text style={{ color: colors.muted }}>RSVP to see who else is going.</Text>}

      <Pressable style={[s.button, { backgroundColor: colors.border, marginTop: 16 }]} onPress={() => router.push(`/event/${id}/chat`)}>
        <Text style={[s.buttonText, { color: colors.neon }]}>EVENT CHAT</Text>
      </Pressable>
    </ScrollView>
  );
}

const s = StyleSheet.create({
  wrap: { flex: 1, backgroundColor: colors.bg, padding: 20 },
  section: { marginTop: 20, marginBottom: 6, fontWeight: "800", letterSpacing: 1, fontSize: 12 },
  lineupRow: { flexDirection: "row", justifyContent: "space-between", paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: colors.border },
  matchRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingVertical: 8, borderBottomWidth: 1, borderBottomColor: colors.border },
  button: { backgroundColor: colors.neon, borderRadius: 10, padding: 16, alignItems: "center" },
  buttonText: { color: colors.bg, fontWeight: "900", letterSpacing: 2 },
});
