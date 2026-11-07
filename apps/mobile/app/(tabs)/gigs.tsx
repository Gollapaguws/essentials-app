import { useCallback, useEffect, useState } from "react";
import { Pressable, RefreshControl, ScrollView, StyleSheet, Text, View } from "react-native";
import { api, ApiError } from "@essentials/api-client";
import { colors, type } from "../../theme";

interface Gig {
  id: string;
  slot: string | null;
  status: string;
  startAt: string;
  performanceFee: number;
  event: { title: string; date: string; venue?: { name: string } };
  invoice?: { id: string; number: string; status: string } | null;
}

interface OpenSlot {
  id: string;
  label: string;
  fee: number;
  taken: boolean;
  applicants: number;
}

interface OpenEvent {
  id: string;
  title: string;
  date: string;
  venue: { name: string };
  slots: OpenSlot[];
}

interface Earnings {
  totals: { earned: number; invoiced: number; paid: number; outstanding: number; gigs: number };
}

const rand = (v: number) => `R${v.toLocaleString()}`;

const statusColor = (status: string) =>
  status === "confirmed" || status === "completed" || status === "paid"
    ? colors.neon
    : status === "pending" || status === "sent"
      ? "#FACC15"
      : colors.muted;

/**
 * DJ tab: open slots to apply for, the gigs already agreed, and the money those
 * gigs have earned. Promoters see the Staff tab instead; admins see both.
 */
export default function Gigs() {
  const [gigs, setGigs] = useState<Gig[]>([]);
  const [open, setOpen] = useState<OpenEvent[]>([]);
  const [earnings, setEarnings] = useState<Earnings | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [applying, setApplying] = useState<string | null>(null);

  const load = useCallback(async () => {
    const [gigsRes, openRes, earnRes] = await Promise.allSettled([
      api.get<Gig[]>("/artists/gigs"),
      api.get<OpenEvent[]>("/artists/gig-calendar"),
      api.get<Earnings>("/artists/earnings"),
    ]);

    if (gigsRes.status === "fulfilled") setGigs(gigsRes.value);
    if (openRes.status === "fulfilled") setOpen(openRes.value);
    if (earnRes.status === "fulfilled") setEarnings(earnRes.value);

    const failed = [gigsRes, openRes, earnRes].find((r) => r.status === "rejected");
    if (failed && failed.status === "rejected") {
      const err = failed.reason;
      setError(
        err instanceof ApiError && err.status === 400
          ? "Create your DJ profile in the dashboard first — this tab needs one."
          : "Couldn't load your gigs. Pull to retry.",
      );
    } else {
      setError(null);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const apply = async (slotId: string) => {
    setApplying(slotId);
    setError(null);
    setNotice(null);
    try {
      await api.post("/artists/gig-calendar/apply", { slotId });
      setNotice("Application sent — the promoter will confirm.");
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not apply for that slot.");
    } finally {
      setApplying(null);
    }
  };

  const upcoming = gigs.filter((g) => g.status !== "cancelled");

  return (
    <ScrollView
      style={{ backgroundColor: colors.bg }}
      contentContainerStyle={s.wrap}
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
    >
      <Text style={[type.display, { color: colors.neon }]}>GIGS</Text>
      {notice && <Text style={{ color: colors.neon }}>{notice}</Text>}
      {error && <Text style={{ color: colors.muted }}>{error}</Text>}

      <View style={s.card}>
        <Text style={s.cardTitle}>MONEY</Text>
        <View style={s.row}>
          <Stat label="EARNED" value={rand(earnings?.totals.earned ?? 0)} />
          <Stat label="INVOICED" value={rand(earnings?.totals.invoiced ?? 0)} />
          <Stat label="PAID" value={rand(earnings?.totals.paid ?? 0)} />
          <Stat label="STILL OWED" value={rand(earnings?.totals.outstanding ?? 0)} />
        </View>
        <Text style={s.hint}>
          Only a gig the promoter confirms you played is billable — invoice it from the dashboard.
        </Text>
      </View>

      <View style={s.card}>
        <Text style={s.cardTitle}>OPEN SLOTS</Text>
        {open.map((event) => (
          <View key={event.id} style={s.block}>
            <Text style={s.eventTitle}>{event.title}</Text>
            <Text style={s.meta}>
              {event.venue.name} · {new Date(event.date).toDateString()}
            </Text>
            <View style={s.slots}>
              {event.slots.map((slot) => (
                <Pressable
                  key={slot.id}
                  disabled={slot.taken || applying === slot.id}
                  onPress={() => apply(slot.id)}
                  style={[
                    s.slot,
                    slot.taken ? s.slotTaken : applying === slot.id ? s.slotBusy : null,
                  ]}
                >
                  <Text style={[s.slotText, slot.taken && { color: colors.muted, textDecorationLine: "line-through" }]}>
                    {slot.label}
                  </Text>
                  <Text style={[s.slotFee, slot.taken && { color: colors.muted }]}>
                    {rand(slot.fee)}
                    {slot.applicants > 0 && !slot.taken ? ` · ${slot.applicants} applied` : ""}
                  </Text>
                </Pressable>
              ))}
            </View>
          </View>
        ))}
        {!open.length && <Text style={s.empty}>No open nights right now — you'll get a DJ call.</Text>}
      </View>

      <View style={s.card}>
        <Text style={s.cardTitle}>MY GIGS</Text>
        {upcoming.map((gig) => (
          <View key={gig.id} style={s.block}>
            <View style={s.spread}>
              <Text style={s.eventTitle}>{gig.event.title}</Text>
              <Text style={[s.status, { color: statusColor(gig.status) }]}>{gig.status}</Text>
            </View>
            <Text style={s.meta}>
              {gig.slot ?? "slot TBA"} · {new Date(gig.startAt).toDateString()}
              {gig.event.venue?.name ? ` · ${gig.event.venue.name}` : ""}
            </Text>
            <View style={s.spread}>
              <Text style={s.fee}>{rand(gig.performanceFee)}</Text>
              <Text style={[s.meta, { color: statusColor(gig.invoice?.status ?? "none") }]}>
                {gig.invoice
                  ? `${gig.invoice.number} · ${gig.invoice.status}`
                  : gig.status === "completed"
                    ? "ready to invoice"
                    : "not invoiced"}
              </Text>
            </View>
          </View>
        ))}
        {!upcoming.length && <Text style={s.empty}>No gigs yet. Apply for an open slot above.</Text>}
      </View>
    </ScrollView>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <View style={{ minWidth: "45%" }}>
      <Text style={s.statValue}>{value}</Text>
      <Text style={s.statLabel}>{label}</Text>
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
    padding: 16,
    gap: 10,
  },
  cardTitle: { color: colors.neon, fontWeight: "800", letterSpacing: 1, fontSize: 12 },
  row: { flexDirection: "row", flexWrap: "wrap", gap: 12 },
  block: { borderTopWidth: 1, borderTopColor: colors.border, paddingTop: 10, gap: 4 },
  spread: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", gap: 8 },
  eventTitle: { color: colors.text, fontWeight: "700", flexShrink: 1 },
  meta: { color: colors.muted, fontSize: 12 },
  hint: { color: colors.muted, fontSize: 11 },
  slots: { flexDirection: "row", flexWrap: "wrap", gap: 8, marginTop: 4 },
  slot: {
    borderWidth: 1,
    borderColor: colors.neon,
    borderRadius: 10,
    paddingVertical: 8,
    paddingHorizontal: 10,
    gap: 2,
  },
  slotTaken: { borderColor: colors.border },
  slotBusy: { opacity: 0.5 },
  slotText: { color: colors.text, fontWeight: "700", fontSize: 12 },
  slotFee: { color: colors.neon, fontSize: 11 },
  status: { fontSize: 11, fontWeight: "800", textTransform: "uppercase" },
  fee: { color: colors.text, fontWeight: "800" },
  empty: { color: colors.muted, fontSize: 12 },
  statValue: { color: colors.text, fontWeight: "800", fontSize: 18 },
  statLabel: { color: colors.muted, fontSize: 10, letterSpacing: 1 },
});
