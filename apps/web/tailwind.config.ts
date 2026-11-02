import type { Config } from "tailwindcss";

export default {
  content: ["./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: { bg: "#0A0A0A", surface: "#141414", line: "#222222", neon: "#00FF66" },
      fontFamily: { sans: ["Inter", "Helvetica", "sans-serif"] },
    },
  },
  plugins: [],
} satisfies Config;
