import "./globals.css";
import type { Metadata } from "next";
import { AuthProvider } from "@/components/AuthProvider";
import { AgentChat } from "@/components/AgentChat";
import { BuildGuard } from "@/components/BuildGuard";
import { PageTitle } from "@/components/PageTitle";

// Inlined by next.config.js at build time; the guard compares it with what the
// server is serving now.
export const BUILD_ID = process.env.NEXT_PUBLIC_BUILD_ID ?? "dev";

// The dashboard is served from the same host as the public site, so one URL
// names it in share previews. Absolute, not relative: metadataBase is not set,
// and a relative image would resolve against /dashboard.
const SITE_URL = process.env.NEXT_PUBLIC_SITE_URL ?? "https://sonus.essentialsedm.com";
const TITLE = "Promoter dashboard · SONUS";
const DESCRIPTION =
  "SONUS — the promoter dashboard for events, guest lists, door operations and settlements.";

export const metadata: Metadata = {
  title: TITLE,
  description: DESCRIPTION,
  applicationName: "SONUS",
  openGraph: {
    type: "website",
    siteName: "SONUS",
    title: TITLE,
    description: DESCRIPTION,
    url: `${SITE_URL}/dashboard`,
    images: [{ url: `${SITE_URL}/og-default.png`, width: 1200, height: 630, alt: "SONUS" }],
  },
  twitter: {
    card: "summary_large_image",
    title: TITLE,
    description: DESCRIPTION,
    images: [`${SITE_URL}/og-default.png`],
  },
  other: { "essentials-build": BUILD_ID },
};

export default function RootLayout({ children }: { children: import("react").ReactNode }) {
  return (
    <html lang="en" className="dark">
      <body className="bg-bg text-white min-h-screen font-sans">
        <AuthProvider>
          <PageTitle />
          {children}
          <AgentChat />
          <BuildGuard />
        </AuthProvider>
      </body>
    </html>
  );
}
