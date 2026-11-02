import { useEffect, useState } from "react";
import { View, Text, TextInput, Pressable, FlatList, StyleSheet, KeyboardAvoidingView, Platform } from "react-native";
import { useLocalSearchParams } from "expo-router";
import { colors, type } from "../../../theme";
import { api } from "@essentials/api-client";

interface Msg { id: string; body: string; user: { id: string; name: string | null; avatar: string | null } }

/** Phase 2: per-event group chat with AI icebreakers. */
export default function GroupChat() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const [messages, setMessages] = useState<Msg[]>([]);
  const [icebreakers, setIcebreakers] = useState<string[]>([]);
  const [draft, setDraft] = useState("");
  const [error, setError] = useState<string | null>(null);

  const load = () => {
    api.get<{ messages: Msg[] }>(`/social/events/${id}/chat`).then((r) => setMessages(r.messages)).catch(() => setError("Join the guest list to chat."));
    api.get<string[]>(`/social/events/${id}/icebreakers`).then(setIcebreakers).catch(() => {});
  };
  useEffect(() => { load(); }, [id]);

  const send = async (body: string) => {
    if (!body.trim()) return;
    try {
      await api.post(`/social/events/${id}/chat`, { body });
      setDraft("");
      load();
    } catch { setError("Message failed."); }
  };

  return (
    <KeyboardAvoidingView style={s.wrap} behavior={Platform.OS === "ios" ? "padding" : undefined}>
      <Text style={[type.display, { color: colors.neon, fontSize: 24 }]}>EVENT CHAT</Text>
      {!!icebreakers.length && !messages.length && (
        <View style={{ marginTop: 12, gap: 8 }}>
          <Text style={{ color: colors.muted, fontWeight: "700" }}>ICEBREAKERS</Text>
          {icebreakers.map((ib) => (
            <Pressable key={ib} style={s.ice} onPress={() => send(ib)}>
              <Text style={{ color: colors.text }}>{ib}</Text>
            </Pressable>
          ))}
        </View>
      )}
      <FlatList
        data={messages}
        keyExtractor={(m) => m.id}
        contentContainerStyle={{ paddingVertical: 12, gap: 8 }}
        renderItem={({ item }) => (
          <View style={[s.bubble, item.user.id === "me" && { alignSelf: "flex-end" }]}>
            <Text style={{ color: colors.neon, fontSize: 12, fontWeight: "800" }}>{item.user.name ?? "Guest"}</Text>
            <Text style={{ color: colors.text }}>{item.body}</Text>
          </View>
        )}
        ListEmptyComponent={<Text style={{ color: colors.muted }}>{error ?? "Be the first to say hi."}</Text>}
      />
      <View style={{ flexDirection: "row", gap: 8 }}>
        <TextInput style={s.input} placeholder="Say something…" placeholderTextColor={colors.muted} value={draft} onChangeText={setDraft} />
        <Pressable style={s.send} onPress={() => send(draft)}>
          <Text style={{ color: colors.bg, fontWeight: "900" }}>SEND</Text>
        </Pressable>
      </View>
      {error && <Text style={{ color: colors.danger, marginTop: 8 }}>{error}</Text>}
    </KeyboardAvoidingView>
  );
}

const s = StyleSheet.create({
  wrap: { flex: 1, backgroundColor: colors.bg, padding: 16 },
  ice: { backgroundColor: colors.surface, borderColor: colors.neon, borderWidth: 1, borderRadius: 12, padding: 12 },
  bubble: { backgroundColor: colors.surface, borderRadius: 12, padding: 10, alignSelf: "flex-start", maxWidth: "85%" },
  input: { flex: 1, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surface, color: colors.text, borderRadius: 10, padding: 12 },
  send: { backgroundColor: colors.neon, borderRadius: 10, paddingHorizontal: 16, justifyContent: "center" },
});
