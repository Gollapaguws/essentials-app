"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useAuth } from "@/components/AuthProvider";
import { session } from "@/lib/session";
import { resetAgentUser } from "@/lib/agent";
import { Tooltip } from "@/components/Tooltip";

import type { AuthRole } from "@essentials/auth";

/** `hint` is the hover/focus tooltip; `roles` decides who sees the item. */
type NavLink = { href: string; label: string; hint: string; roles?: readonly AuthRole[] };

/**
 * Drop the site's Supabase session from this browser.
 *
 * supabase-js stores under `sb-<ref>-auth-token` (plus a PKCE verifier key), and
 * the dashboard shares the origin with the site, so signing out here has to
 * clear it too — the API has already ended the session behind the tokens.
 */
function forgetSiteSession(): void {
  for (const key of Object.keys(window.localStorage)) {
    if (/^sb-.*-auth-token/.test(key)) window.localStorage.removeItem(key);
  }
}

const links: NavLink[] = [
  {
    href: "/",
    label: "Analytics",
    hint: "Tonight at a glance: RSVPs, check-ins and how each event is pacing against the last one.",
    roles: ["promoter", "admin"],
  },
  {
    href: "/events",
    label: "Events",
    hint: "Create an event, pick the venue from the list, set capacity and lineup, then clone a past night.",
    roles: ["promoter", "admin"],
  },
  {
    href: "/email",
    label: "Email Engine",
    hint: "Campaigns and guest segments, plus which RSVPs each send brought in.",
    roles: ["promoter", "admin"],
  },
  {
    href: "/venue",
    label: "Venue Portal",
    hint: "Add the rooms you run nights at, set their address and coordinates, then approve the events booked there.",
    roles: ["promoter", "venue_manager", "admin"],
  },
  {
    href: "/artists",
    label: "Artists",
    hint: "The DJ roster: stage name, bio, travel rate and the gigs each one is already confirmed for.",
    roles: ["promoter", "admin"],
  },
  {
    href: "/promotions",
    label: "Promotions",
    hint: "Promo campaigns per event and the RSVPs they are tracked against.",
    roles: ["promoter", "admin"],
  },
  {
    href: "/artist",
    label: "Artist Portal",
    hint: "DJ profile and stage name, gigs, invoices with payment links, and the day-by-day route plan.",
    roles: ["artist", "admin"],
  },
  {
    href: "/artist/profile",
    label: "My Profile",
    hint: "Your DJ profile: stage name, bio, and the travel costs used for routing and invoices.",
    roles: ["artist", "admin"],
  },
  {
    href: "/insights",
    label: "Insights",
    hint: "Guest lifetime value and cohort retention across previous nights.",
    roles: ["promoter", "admin"],
  },
  {
    href: "/editor",
    label: "Front Page",
    hint: "Edit the public front page: lineup, broadcasts and site copy.",
    roles: ["admin"],
  },
  {
    href: "/mailboxes",
    label: "Mailboxes",
    hint: "Inboxes the API watches for replies, and the password for each mailbox.",
    roles: ["admin"],
  },
  {
    href: "/simulcast",
    label: "Streaming",
    hint: "Restream one broadcast to every platform, with live status refreshed every few seconds.",
    roles: ["admin"],
  },
  {
    href: "/social",
    label: "Social Hub",
    hint: "Generate copy, queue posts per platform, republish or publish immediately.",
    roles: ["promoter", "admin"],
  },
  {
    href: "/gig-calendar",
    label: "Gig Calendar",
    hint: "Open DJ slots at venues: apply for a day, evening or late-night set.",
    roles: ["artist", "admin"],
  },
  {
    href: "/earnings",
    label: "Earnings",
    hint: "Played gigs: the fee agreed for each, what you have invoiced the venue, and what is still owed.",
    roles: ["artist", "admin"],
  },
  {
    href: "/applications",
    label: "DJ Applications",
    hint: "Applications for your events — confirm or decline each slot.",
    roles: ["promoter", "admin"],
  },
  {
    href: "/door",
    label: "Door",
    hint: "Search the guest list by name or email and check people in without a scanner.",
    roles: ["promoter", "venue_manager", "admin"],
  },
  {
    href: "/settlements",
    label: "Settlements",
    hint: "Per night: DJ fees agreed, invoiced, paid by the venue, and still outstanding.",
    roles: ["promoter", "admin"],
  },
  {
    href: "/notifications",
    label: "Notifications",
    hint: "Your bell feed: DJ calls, applications, confirmations and invoice notices, with unread counts.",
  },
  {
    href: "/account",
    label: "Account",
    hint: "The browsers signed in to your account, and a way to sign one out if you lose it.",
  },
  {
    href: "/users",
    label: "Users",
    hint: "Every registered account: make someone a DJ, venue manager or promoter.",
    roles: ["admin"],
  },
  {
    href: "/audit",
    label: "Audit",
    hint: "Security trail: sign-ins, linked accounts, role changes and MFA activity.",
    roles: ["admin"],
  },
  {
    href: "/settings",
    label: "Settings",
    hint: "Platform rates every DJ and invoice is priced from — the standard travel rate per kilometre.",
    roles: ["admin"],
  },
  {
    href: "/help",
    label: "Help",
    hint: "The manual for your role: what each screen is for, how the money works, and what to do when something looks wrong.",
  },
];

export function TopNav() {
  const path = usePathname();
  const { me } = useAuth();
  const user = me?.user ?? null;
  // Admins see the whole dashboard; everyone else only the sections their role owns.
  const role = user?.role ?? "guest";
  const visible = links.filter((l) => role === "admin" || !l.roles || l.roles.includes(role));

  const signOut = async () => {
    await session.logout().catch(() => undefined);
    // The chat widget must forget the account that just signed out.
    resetAgentUser();
    // The public site keeps its Supabase session in this browser's storage on
    // the same origin. Left there, it swaps itself for a new dashboard session
    // the moment anyone clicks Dashboard — a sign-out that signs straight back in.
    forgetSiteSession();
    // Leave the dashboard rather than routing to its root: every dashboard page
    // is signed-in only, so "home" would render the login card a moment after
    // signing out. The public site is what a DJ expects to land on.
    window.location.replace("/");
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
