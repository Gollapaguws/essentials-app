import { useEffect, useState } from "react";
import { ScrollView, Text, View, Pressable, StyleSheet, Linking, Platform } from "react-native";
import { router, useLocalSearchParams } from "expo-router";
import { colors, type } from "../../theme";
import { api, type EventSummary, type RsvpResult } from "@essentials/api-client";

/** Native maps when the platform has one, Google Maps in the browser otherwise. */
function mapsUrl(name: string, lat: number, lng: number) {
  const label = encodeURIComponent(name);
  if (Platform.OS === "ios") return `maps://?q=${label}&ll=${lat},${lng}`;
  if (Platform.OS === "android") return `geo:${lat},${lng}?q=${lat},${lng}(${label})`;
  return `https://www.google.com/maps/search/?api=1&query=${lat},${lng}`;
}

interface Match {
  userId: string;
  name: string | null;
  sharedTastes: string[];
  score: number;
}

/** `GET /events/:id`: the feed summary plus the guest's own RSVP and full venue. */
interface EventDetailResponse extends EventSummary {
  status?: string;
  myRsvp?: { status: string };
  venue: EventSummary["venue"] & { address?: string | null };
}

/** Event detail: venue + map link, lineup, capacity, live headcount, RSVP + waitlist. */
export default function EventDetail() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const [event, setEvent] = useState<EventDetailResponse | null>(null);
  const [rsvpState, setRsvpState] = useState<string | null>(null);
  const [matches, setMatches] = useState<Match[]>([]);
  const [error, setError] = useState<string | null>(null);

  const load = async () => {
    try {
      const detail = await api.get<EventDetailResponse>(`/events/${id}`);
      setEvent(detail);
      if (detail.myRsvp) setRsvpState(detail.myRsvp.status);
    } catch { setError("Couldn't load this event."); }
  };
  useEffect(() => { load(); }, [id]);

  useEffect(() => {
    api.get<Match[]>(`/social/events/${id}/matches`).then(setMatches).catch(() => {});
  }, [id, rsvpState]);

  const rsvp = async () => {
    try {
      const res = await api.post<RsvpResult>(`/events/${id}/rsvp`);
      setRsvpState(res.status);
      load();
    } catch { setError("RSVP failed - maybe you're already on the list."); }
  };

  const venue = event?.venue;
  // 0,0 is the "never geocoded" sentinel the venue portal and route planner use.
  const hasLocation = typeof venue?.lat === "number" && typeof venue?.lng === "number" && (venue.lat !== 0 || venue.lng !== 0);

  const openMap = async () => {
    if (!venue || !hasLocation) return;
    const fallback = `https://www.google.com/maps/search/?api=1&query=${venue.lat},${venue.lng}`;
    try {
      await Linking.openURL(mapsUrl(venue.name, venue.lat, venue.lng));
    } catch {
      await Linking.openURL(fallback).catch(() => setError("Could not open a map on this device."));
    }
  };

  if (!event || !venue) return <View style={s.wrap}><Text style={{ color: colors.muted }}>{error ?? "Loading…"}</Text></View>;

  return (
    <ScrollView style={s.wrap} contentContainerStyle={{ paddingBottom: 120 }}>
      <Text style={[type.display, { color: colors.neon }]}>{event.title}</Text>
      <Text style={{ color: colors.muted, marginTop: 6 }}>{venue.name}{" \u00b7 "}{new Date(event.date).toDateString()}</Text>

      <View style={s.venueCard}>
        <Text style={s.venueLabel}>VENUE</Text>
        <Text style={{ color: colors.text, marginTop: 4 }}>{venue.address || "Address not set yet."}</Text>
        {hasLocation ? (
          <Pressable style={s.mapButton} onPress={openMap}>
            <Text style={s.mapButtonText}>OPEN IN MAPS</Text>
          </Pressable>
        ) : (
          <Text style={{ color: colors.muted, marginTop: 10, fontSize: 12 }}>Location coming soon.</Text>
        )}
      </View>

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

      <View style={{ marginTop: 24 }}>
        {!rsvpState ? (
          <Pressable style={[s.button]} onPress={rsvp}>
            <Text style={s.buttonText}>RSVP</Text>
          </Pressable>
        ) : (
          <Pressable style={[s.button, rsvpState === "waitlisted" && { backgroundColor: colors.border }]} onPress={() => router.push(`/event/${id}/pass`)} disabled={rsvpState === "waitlisted"}>
            <Text style={s.buttonText}>{rsvpState === "waitlisted" ? "WAITLISTED" : "DOOR PASS"}</Text>
          </Pressable>
        )}
      </View>
      {error && <Text style={{ color: colors.danger, marginTop: 12 }}>{error}</Text>}

      <Text style={[s.section, { color: colors.muted }]}>PEOPLE LIKE YOU ARE GOING</Text>
      {(matches.length ? matches : []).map((m) => (
        <View key={m.userId} style={s.matchRow}>
          <Text style={{ color: colors.text, fontWeight: "700", flex: 1 }}>{m.name ?? "Guest"}</Text>
          <Text style={{ color: colors.neon, fontSize: 12 }}>{m.sharedTastes.join(" \u00b7 ")}</Text>
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
  venueCard: { marginTop: 16, padding: 14, borderRadius: 12, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surface },
  venueLabel: { color: colors.muted, fontWeight: "800", letterSpacing: 1, fontSize: 12 },
  mapButton: { marginTop: 12, borderWidth: 1, borderColor: colors.neon, borderRadius: 10, paddingVertical: 10, alignItems: "center" },
  mapButtonText: { color: colors.neon, fontWeight: "900", letterSpacing: 2, fontSize: 12 },
  lineupRow: { flexDirection: "row", justifyContent: "space-between", paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: colors.border },
  matchRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingVertical: 8, borderBottomWidth: 1, borderBottomColor: colors.border },
  button: { backgroundColor: colors.neon, borderRadius: 10, padding: 16, alignItems: "center" },
  buttonText: { color: colors.bg, fontWeight: "900", letterSpacing: 2 },
});
