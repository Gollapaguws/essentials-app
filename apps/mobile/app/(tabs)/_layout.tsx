import { useEffect, useState } from "react";
import { Tabs } from "expo-router";
import { Briefcase, Calendar, Disc3, Ticket, User, Users } from "lucide-react-native";
import { api } from "@essentials/api-client";
import { colors } from "../../theme";

/** Roles that own events; the API gates /events/manage/list the same way. */
const STAFF_ROLES = ["promoter", "admin"];
/** Roles that have a DJ profile; the gig endpoints gate the same way. */
const DJ_ROLES = ["artist", "admin"];

export default function TabsLayout() {
  const [role, setRole] = useState<string | null>(null);

  // The staff tab is a promoter surface, so guests must not see it. /auth/me is
  // the canonical role source — the token claim is stale after a role change.
  useEffect(() => {
    api
      .get<{ user: { role: string | null } }>("/auth/me")
      .then((me) => setRole(me.user.role))
      .catch(() => setRole(null));
  }, []);

  const staff = role !== null && STAFF_ROLES.includes(role);
  const dj = role !== null && DJ_ROLES.includes(role);

  return (
    <Tabs
      screenOptions={{
        headerStyle: { backgroundColor: colors.bg },
        headerTintColor: colors.neon,
        tabBarStyle: { backgroundColor: colors.bg, borderTopColor: colors.border },
        tabBarActiveTintColor: colors.neon,
        tabBarInactiveTintColor: colors.muted,
      }}
    >
      <Tabs.Screen name="events" options={{ title: "EVENTS", tabBarIcon: ({ color }) => <Calendar color={color} size={22} /> }} />
      {/* DJs apply for slots and check what they are owed from the phone. */}
      <Tabs.Screen
        name="gigs"
        options={
          dj
            ? { title: "GIGS", tabBarIcon: ({ color }) => <Disc3 color={color} size={22} /> }
            : { href: null }
        }
      />
      {/* The file becomes a tab whether or not it is declared here, so non-staff
          accounts get `href: null` rather than no declaration at all. */}
      <Tabs.Screen
        name="staff"
        options={
          staff
            ? { title: "STAFF", tabBarIcon: ({ color }) => <Briefcase color={color} size={22} /> }
            : { href: null }
        }
      />
      <Tabs.Screen name="passes" options={{ title: "DOOR PASS", tabBarIcon: ({ color }) => <Ticket color={color} size={22} /> }} />
      <Tabs.Screen name="loyalty" options={{ title: "LOYALTY", tabBarIcon: ({ color }) => <Users color={color} size={22} /> }} />
      <Tabs.Screen name="account" options={{ title: "ACCOUNT", tabBarIcon: ({ color }) => <User color={color} size={22} /> }} />
    </Tabs>
  );
}
