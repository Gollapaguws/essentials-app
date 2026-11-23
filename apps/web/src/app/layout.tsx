import "./globals.css";
import type { Metadata } from "next";
import { AuthProvider } from "@/components/AuthProvider";
import { AgentChat } from "@/components/AgentChat";
import { BuildGuard } from "@/components/BuildGuard";

// Inlined by next.config.js at build time; the guard compares it with what the
// server is serving now.
export const BUILD_ID = process.env.NEXT_PUBLIC_BUILD_ID ?? "dev";

export const metadata: Metadata = {
  title: "SONUS · Promoter Dashboard",
  description: "Nightlife promoter platform — events, guest lists and door operations.",
  other: { "essentials-build": BUILD_ID },
};

export default function RootLayout({ children }: { children: import("react").ReactNode }) {
  return (
    <html lang="en" className="dark">
      <body className="bg-bg text-white min-h-screen font-sans">
        <AuthProvider>
          {children}
          <AgentChat />
          <BuildGuard />
        </AuthProvider>
      </body>
    </html>
  );
}
