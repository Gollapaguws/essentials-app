import "./globals.css";
import type { Metadata } from "next";
import { AuthProvider } from "@/components/AuthProvider";

export const metadata: Metadata = {
  title: "ESSENTIALS · Promoter Dashboard",
  description: "Nightlife promoter platform — events, guest lists, tables, email engine.",
};

export default function RootLayout({ children }: { children: import("react").ReactNode }) {
  return (
    <html lang="en" className="dark">
      <body className="bg-bg text-white min-h-screen font-sans">
        <AuthProvider>{children}</AuthProvider>
      </body>
    </html>
  );
}
