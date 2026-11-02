"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { supabase } from "@/lib/supabase";
import { useAuth } from "@/components/AuthProvider";
import { Tooltip } from "@/components/Tooltip";

/** `hint` is the hover/focus tooltip under each item. */
const links = [
  {
    href: "/dashboard",
    label: "Analytics",
    hint: "Tonight at a glance: RSVPs, check-ins, table revenue, venue and promoter splits, plus events pacing off target.",
  },
  {
    href: "/dashboard/events",
    label: "Events",
    hint: "Create an event, pick the venue from the list, set capacity and lineup, then clone a past night.",
  },
  {
    href: "/dashboard/email",
    label: "Email Engine",
    hint: "Campaigns and guest segments, plus which RSVPs each send brought in.",
  },
  {
    href: "/dashboard/venue",
    label: "Venue Portal",
    hint: "Venue address and coordinates, pending event approvals, table inventory, door scans and revenue splits.",
  },
  {
    href: "/dashboard/promotions",
    label: "Promotions",
    hint: "Promo campaigns per event and the RSVPs they are tracked against.",
  },
  {
    href: "/dashboard/artist",
    label: "Artist Portal",
    hint: "DJ profile and stage name, gigs, invoices with payment links, and the day-by-day route plan.",
  },
  {
    href: "/dashboard/insights",
    label: "Insights",
    hint: "Guest lifetime value and cohort retention across previous nights.",
  },
  {
    href: "/dashboard/editor",
    label: "Front Page",
    hint: "Edit the public front page: lineup, broadcasts and site copy.",
  },
  {
    href: "/dashboard/mailboxes",
    label: "Mailboxes",
    hint: "Inboxes the API watches for replies, and the password for each mailbox.",
  },
  {
    href: "/dashboard/simulcast",
    label: "Streaming",
    hint: "Restream one broadcast to every platform, with live status refreshed every few seconds.",
  },
  {
    href: "/dashboard/social",
    label: "Social Hub",
    hint: "Generate copy, queue posts per platform, republish or publish immediately.",
  },
  {
    href: "/dashboard/gig-calendar",
    label: "Gig Calendar",
    hint: "Open DJ slots at venues: apply for a day, evening or late-night set.",
  },
  {
    href: "/dashboard/applications",
    label: "DJ Applications",
    hint: "Applications for your events — confirm or decline each slot.",
  },
  {
    href: "/dashboard/users",
    label: "Users",
    hint: "Every registered account: make someone a DJ, venue manager or promoter.",
    adminOnly: true,
  },
];

export function TopNav() {
  const path = usePathname();
  const router = useRouter();
  const { me } = useAuth();
  const user = me?.user ?? null;
  const visible = links.filter((l) => !l.adminOnly || user?.role === "admin");

  const signOut = async () => {
    await supabase.auth.signOut();
    router.replace("/");
  };

  return (
    <nav className="border-b border-line bg-surface/60 backdrop-blur sticky top-0 z-10">
      <div className="max-w-6xl mx-auto flex flex-wrap items-center gap-6 px-6 py-4">
        <Link href="/" className="text-neon font-black tracking-widest">ESSENTIALS</Link>
        {visible.map((l) => (
          <Tooltip key={l.href} label={l.hint}>
            <Link
              href={l.href}
              className={`text-sm ${path === l.href ? "text-neon font-bold" : "text-neutral-400 hover:text-white"}`}
            >
              {l.label}
            </Link>
          </Tooltip>
        ))}
        {user && (
          <div className="ml-auto flex items-center gap-3">
            <Tooltip label="The account you are signed in as. Roles are set by an admin on the Users page." className="hidden sm:inline-flex" align="right">
              <span className="text-xs text-neutral-500">{user.email}</span>
            </Tooltip>
            <Tooltip label="Ends the Supabase session in this browser and returns to the sign-in screen." align="right">
              <button
                onClick={signOut}
                className="text-xs tracking-widest text-neutral-400 hover:text-neon"
              >
                SIGN OUT
              </button>
            </Tooltip>
          </div>
        )}
      </div>
    </nav>
  );
}
