import { useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { colors } from "../theme";

/**
 * Tap-to-reveal field hint for the mobile app.
 *
 * Phones have no hover, and a floating bubble can fall off-screen or sit under
 * the keyboard, so the marker expands an ordinary text line in the flow. The
 * whole row is the touch target (plus hitSlop), which keeps it comfortably
 * above the 44 pt minimum.
 */
export function FieldHint({ label, hint }: { label: string; hint: string }) {
  const [open, setOpen] = useState(false);

  return (
    <View>
      <Pressable
        onPress={() => setOpen((value) => !value)}
        hitSlop={10}
        style={({ pressed }) => (pressed ? s.pressed : null)}
        accessibilityRole="button"
        accessibilityLabel={label}
        accessibilityHint={open ? "Hides the explanation" : "Shows the explanation"}
        accessibilityState={{ expanded: open }}
      >
        <Text style={s.trigger}>
          <Text style={s.mark}>? </Text>
          {label}
        </Text>
      </Pressable>
      {open && <Text style={s.hint}>{hint}</Text>}
    </View>
  );
}

const s = StyleSheet.create({
  pressed: { opacity: 0.6 },
  trigger: {
    color: colors.muted,
    fontSize: 12,
    paddingVertical: 8,
    alignSelf: "flex-start",
  },
  mark: { color: colors.neon, fontWeight: "900" },
  hint: {
    color: colors.muted,
    fontSize: 12,
    lineHeight: 18,
    marginBottom: 6,
  },
});
