import { useEffect, useState } from "react";
import { FlatList, Text, View, Pressable, StyleSheet } from "react-native";
import { useLocalSearchParams } from "expo-router";
import { colors, type } from "../../../theme";
import { api, type VenueTableDto } from "@essentials/api-client";

/** Table booking: reserve VIP tables from venue inventory. */
export default function TablesScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const [tables, setTables] = useState<VenueTableDto[]>([]);
  const [booked, setBooked] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = () => api.get<VenueTableDto[]>(`/tables/inventory/${id}`).then(setTables).catch(() => setError("Couldn't load tables."));
  useEffect(() => { load(); }, [id]);

  const book = async (venueTableId: string) => {
    try {
      await api.post("/tables/book", { eventId: id, venueTableId });
      setBooked(venueTableId);
      load();
    } catch (e: any) {
      setError(String(e?.message ?? "").includes("already reserved") ? "Table already reserved." : "Booking failed.");
    }
  };

  return (
    <FlatList
      data={tables}
      keyExtractor={(t) => t.id}
      contentContainerStyle={{ padding: 16, gap: 12 }}
      ListHeaderComponent={<Text style={[type.display, { color: colors.neon }]}>VIP TABLES</Text>}
      ListEmptyComponent={<Text style={{ color: colors.muted }}>{error ?? "No tables configured for this venue."}</Text>}
      renderItem={({ item }) => (
        <View style={s.card}>
          <View>
            <Text style={{ color: colors.text, fontWeight: "800", fontSize: 18 }}>{item.tableNumber}</Text>
            <Text style={{ color: colors.muted }}>Seats {item.capacity} · min spend R{item.minSpend}</Text>
          </View>
          <Pressable
            style={[s.button, (!item.available || booked === item.id) && { backgroundColor: colors.border }]}
            disabled={!item.available || booked === item.id}
            onPress={() => book(item.id)}
          >
            <Text style={[s.buttonText, (!item.available || booked === item.id) && { color: colors.muted }]}>
              {item.available ? "RESERVE" : "TAKEN"}
            </Text>
          </Pressable>
        </View>
      )}
    />
  );
}

const s = StyleSheet.create({
  card: { backgroundColor: colors.surface, borderColor: colors.border, borderWidth: 1, borderRadius: 14, padding: 16, flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  button: { backgroundColor: colors.neon, borderRadius: 10, paddingHorizontal: 18, paddingVertical: 12 },
  buttonText: { color: colors.bg, fontWeight: "900", letterSpacing: 1 },
});
