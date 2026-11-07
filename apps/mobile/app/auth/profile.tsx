import { useState } from "react";
import { ActivityIndicator, View, Text, TextInput, Pressable, StyleSheet, Image } from "react-native";
import * as ImagePicker from "expo-image-picker";
import { router } from "expo-router";
import { api } from "@essentials/api-client";
import { colors, type } from "../../theme";

const TASTES = ["House", "Techno", "Hip-Hop", "Afro", "Amapiano"];
const VIBES = ["Chill", "Party", "Networking"];
const MAX_PHOTO_BYTES = 5 * 1024 * 1024;

/** 4/4 — Profile setup: name, photo, music taste multi-select, vibe tag. */
export default function Profile() {
  const [name, setName] = useState("");
  const [avatar, setAvatar] = useState<string | null>(null);
  const [tastes, setTastes] = useState<string[]>([]);
  const [vibe, setVibe] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const toggle = (t: string) => setTastes((prev) => (prev.includes(t) ? prev.filter((x) => x !== t) : [...prev, t]));

  const finish = () => {
    // TODO(phase-1 polish): PATCH /api/me with profile; local state kept until then.
    router.replace("/(tabs)/events");
  };

  const choosePhoto = async () => {
    setError(null);
    const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!permission.granted) {
      setError("Allow photo access to choose a profile picture.");
      return;
    }

    const picked = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ImagePicker.MediaTypeOptions.Images,
      allowsEditing: true,
      aspect: [1, 1],
      quality: 0.8,
    });
    const asset = picked.canceled ? null : picked.assets?.[0];
    if (!asset) return;
    if (asset.fileSize && asset.fileSize > MAX_PHOTO_BYTES) {
      setError("Photos must be 5 MB or smaller.");
      return;
    }

    // The picked file keeps its extension so the API can accept or reject it by type.
    const ext = (asset.fileName ?? asset.uri).split(".").pop()?.toLowerCase() ?? "jpg";
    setUploading(true);
    try {
      const { url } = await api.upload<{ ok: boolean; url: string }>("/auth/me/avatar", {
        uri: asset.uri,
        name: `avatar.${ext}`,
        type: asset.mimeType ?? (ext === "jpg" ? "image/jpeg" : `image/${ext}`),
      });
      setAvatar(url);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not upload that photo. Try again.");
    } finally {
      setUploading(false);
    }
  };

  return (
    <View style={s.wrap}>
      <Text style={[type.title, { color: colors.text }]}>Make it yours.</Text>
      <TextInput style={s.input} placeholder="Your name" placeholderTextColor={colors.muted} value={name} onChangeText={setName} />
      <Pressable style={s.avatarBox} onPress={choosePhoto} disabled={uploading} accessibilityLabel="Choose profile photo">
        {avatar ? (
          <Image source={{ uri: avatar }} style={s.avatar} />
        ) : uploading ? (
          <ActivityIndicator color={colors.neon} />
        ) : (
          <Text style={{ color: colors.muted }}>Add photo</Text>
        )}
      </Pressable>
      {uploading && <Text style={s.hint}>Uploading…</Text>}
      {error && <Text style={s.error}>{error}</Text>}
      <Text style={[s.section, { color: colors.muted }]}>MUSIC TASTES</Text>
      <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
        {TASTES.map((t) => (
          <Pressable key={t} onPress={() => toggle(t)} style={[s.chip, tastes.includes(t) && s.chipOn]}>
            <Text style={{ color: tastes.includes(t) ? colors.bg : colors.text, fontWeight: "700" }}>{t}</Text>
          </Pressable>
        ))}
      </View>
      <Text style={[s.section, { color: colors.muted }]}>VIBE</Text>
      <View style={{ flexDirection: "row", gap: 8 }}>
        {VIBES.map((v) => (
          <Pressable key={v} onPress={() => setVibe(v)} style={[s.chip, vibe === v && s.chipOn]}>
            <Text style={{ color: vibe === v ? colors.bg : colors.text, fontWeight: "700" }}>{v}</Text>
          </Pressable>
        ))}
      </View>
      <Pressable style={s.button} onPress={finish} disabled={!name || !vibe || uploading}>
        <Text style={s.buttonText}>ENTER</Text>
      </Pressable>
    </View>
  );
}

const s = StyleSheet.create({
  wrap: { flex: 1, backgroundColor: colors.bg, padding: 24, paddingTop: 80 },
  input: { borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surface, color: colors.text, borderRadius: 10, padding: 14, marginTop: 20 },
  avatarBox: { width: 72, height: 72, borderRadius: 36, borderWidth: 1, borderColor: colors.neon, alignItems: "center", justifyContent: "center", marginTop: 16, overflow: "hidden" },
  avatar: { width: 72, height: 72, borderRadius: 36 },
  hint: { color: colors.muted, marginTop: 6, fontSize: 12 },
  error: { color: colors.danger, marginTop: 8, fontSize: 13 },
  section: { marginTop: 24, marginBottom: 8, fontWeight: "800", letterSpacing: 1, fontSize: 12 },
  chip: { borderWidth: 1, borderColor: colors.border, borderRadius: 20, paddingHorizontal: 14, paddingVertical: 8 },
  chipOn: { backgroundColor: colors.neon, borderColor: colors.neon },
  button: { backgroundColor: colors.neon, borderRadius: 10, padding: 16, alignItems: "center", marginTop: "auto" },
  buttonText: { color: colors.bg, fontWeight: "900", letterSpacing: 2 },
});
