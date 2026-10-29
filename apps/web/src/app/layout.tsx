import "./globals.css";
import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "ESSENTIALS · Promoter Dashboard",
  description: "Nightlife promoter platform — events, guest lists, tables, email engine.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className="dark">
      <body className="bg-bg text-white min-h-screen font-sans">{children}</body>
    </html>
  );
}
