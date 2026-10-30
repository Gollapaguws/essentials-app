"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const links = [
  { href: "/dashboard", label: "Analytics" },
  { href: "/dashboard/events", label: "Events" },
  { href: "/dashboard/email", label: "Email Engine" },
  { href: "/dashboard/venue", label: "Venue Portal" },
  { href: "/dashboard/promotions", label: "Promotions" },
  { href: "/dashboard/artist", label: "Artist Portal" },
  { href: "/dashboard/insights", label: "Insights" },
  { href: "/dashboard/editor", label: "Front Page" },
  { href: "/dashboard/invites", label: "Invites" },
];

export function TopNav() {
  const path = usePathname();
  return (
    <nav className="border-b border-line bg-surface/60 backdrop-blur sticky top-0 z-10">
      <div className="max-w-6xl mx-auto flex items-center gap-6 px-6 py-4">
        <Link href="/" className="text-neon font-black tracking-widest">ESSENTIALS</Link>
        {links.map((l) => (
          <Link
            key={l.href}
            href={l.href}
            className={`text-sm ${path === l.href ? "text-neon font-bold" : "text-neutral-400 hover:text-white"}`}
          >
            {l.label}
          </Link>
        ))}
      </div>
    </nav>
  );
}
