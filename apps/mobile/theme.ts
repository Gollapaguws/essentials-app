/** ESSENTIALS dark nightlife theme — #0A0A0A / #00FF66, high-energy type. */
export const colors = {
  bg: "#0A0A0A",
  surface: "#141414",
  border: "#222222",
  neon: "#00FF66",
  text: "#FFFFFF",
  muted: "#888888",
  danger: "#FF3B5C",
};

export const type = { display: { fontSize: 34, fontWeight: "900", letterSpacing: 2 } as const, title: { fontSize: 20, fontWeight: "800" } as const, body: { fontSize: 15 } as const };

export const spacing = (n: number) => n * 4;
