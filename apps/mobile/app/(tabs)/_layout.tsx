import { Tabs } from "expo-router";
import { Calendar, Ticket, User, Users } from "lucide-react-native";
import { colors } from "../../theme";

export default function TabsLayout() {
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
      <Tabs.Screen name="passes" options={{ title: "DOOR PASS", tabBarIcon: ({ color }) => <Ticket color={color} size={22} /> }} />
      <Tabs.Screen name="loyalty" options={{ title: "LOYALTY", tabBarIcon: ({ color }) => <Users color={color} size={22} /> }} />
      <Tabs.Screen name="account" options={{ title: "ACCOUNT", tabBarIcon: ({ color }) => <User color={color} size={22} /> }} />
    </Tabs>
  );
}
