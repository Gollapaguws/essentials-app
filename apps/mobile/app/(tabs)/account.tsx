import { useCallback, useEffect, useState } from "react";
import {
  View,
  Text,
  Pressable,
  StyleSheet,
  Linking,
  ScrollView,
  RefreshControl,
} from "react-native";
import { router } from "expo-router";
import { api } from "@essentials/api-client";
import { colors, type } from "../../theme";
import { supabase } from "../../lib/supabase";
import { FieldHint } from "../../components/FieldHint";

interface TelegramStatus {
  configured: boolean;
  bot: string | null;
  linked: boolean;
}

const ROLE_LABEL: Record<string, string> = {
  artist: "DJ",
  promoter: "PROMOTER",
  venue_manager: "VENUE",
  admin: "ADMIN",
  guest: "GUEST",
};

/**
 * Account tab: who this device is signed in as, and the Telegram link for DJs.
 * Linking is one tap — the deep link opens Telegram, Start binds the chat.
 */
export default function Account() {
  const [email, setEmail] = useState<string | null>(null);
  const [role, setRole] = useState<string | null>(null);
  const [telegram, setTelegram] = useState<TelegramStatus | null>(null);
  const [busy, setBusy] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    const { data } = await supabase.auth.getSession();
    setEmail(data.session?.user.email ?? null);

    try {
      const me = await api.get<{ user: { role: string } }>("/auth/me");
      setRole(me.user.role);
    } catch {
      setRole(null);
    }

    try {
      setTelegram(await api.get<TelegramStatus>("/telegram/status"));
      setError(null);
    } catch {
      // Guests have no dashboard role, so the endpoint answers 403 by design.
      setTelegram(null);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const connect = async () => {
    setBusy(true);
    setError(null);
    try {
      const { url } = await api.post<{ url: string | null }>("/telegram/link");
      if (url) await Linking.openURL(url);
      else setError("Telegram is not configured on the server yet — alerts arrive by email.");
    } catch {
      setError("Couldn't create a Telegram link. Try again.");
    } finally {
      setBusy(false);
    }
  };

  const disconnect = async () => {
    setBusy(true);
    setError(null);
    try {
      await api.post("/telegram/unlink");
      await load();
    } catch {
      setError("Couldn't disconnect Telegram.");
    } finally {
      setBusy(false);
    }
  };

  const signOut = async () => {
    await supabase.auth.signOut();
    router.replace("/");
  };

  const canLink = role !== null && role !== "guest";

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
      <Text style={[type.display, { color: colors.neon }]}>ACCOUNT</Text>

      <View style={s.card}>
        <Text style={{ color: colors.text, fontWeight: "800", fontSize: 16 }}>
          {email ?? "Not signed in"}
        </Text>
        <Text style={{ color: colors.muted, marginTop: 4 }}>
          {role ? ROLE_LABEL[role] ?? role.toUpperCase() : "—"} · roles are set by an admin
        </Text>
      </View>

      {canLink && (
        <View style={s.card}>
          <Text style={{ color: colors.neon, fontWeight: "800", letterSpacing: 1 }}>
            TELEGRAM GIG ALERTS
          </Text>
          <Text style={{ color: colors.muted, marginTop: 8 }}>
            {telegram?.linked
              ? "Linked — DJ calls, gig confirmations and invoices arrive in Telegram."
              : "Link Telegram once and DJ calls, confirmations and invoices reach your phone as messages."}
          </Text>

          <Pressable
            style={[s.button, busy && s.buttonDisabled]}
            onPress={telegram?.linked ? disconnect : connect}
            disabled={busy || (telegram ? !telegram.configured && !telegram.linked : false)}
          >
            <Text style={s.buttonText}>
              {busy ? "WORKING…" : telegram?.linked ? "DISCONNECT TELEGRAM" : "CONNECT TELEGRAM"}
            </Text>
          </Pressable>

          <FieldHint
            label="What happens next"
            hint={
              telegram?.linked
                ? "Disconnecting stops Telegram messages. In-app notifications and email keep working."
                : telegram && !telegram.configured
                  ? "The bot is not configured on this server yet, so alerts still arrive by email and in the app."
                  : "Opens Telegram with the ESSENTIALS bot. Press Start and this chat is linked to your account."
            }
          />
        </View>
      )}

      {error && <Text style={{ color: colors.danger, marginTop: 12 }}>{error}</Text>}

      <Pressable style={s.ghost} onPress={signOut}>
        <Text style={{ color: colors.text, fontWeight: "700", letterSpacing: 1 }}>SIGN OUT</Text>
      </Pressable>
    </ScrollView>
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
  button: {
    backgroundColor: colors.neon,
    borderRadius: 10,
    padding: 14,
    alignItems: "center",
    marginTop: 14,
  },
  buttonDisabled: { opacity: 0.5 },
  buttonText: { color: colors.bg, fontWeight: "900", letterSpacing: 2 },
  ghost: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 10,
    padding: 14,
    alignItems: "center",
    marginTop: 4,
  },
});
