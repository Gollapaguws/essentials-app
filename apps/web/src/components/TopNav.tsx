"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useAuth } from "@/components/AuthProvider";
import { signOutEverywhere } from "@/lib/signOut";

import type { AuthRole } from "@essentials/auth";

type NavGroup = "NIGHT OPS" | "AUDIENCE" | "STAGE" | "PLATFORM" | "YOU";
/** `hint` is the hover/focus title; `roles` decides who sees the item. */
type NavLink = { href: string; label: string; hint: string; group: NavGroup; roles?: readonly AuthRole[] };

const GROUP_ORDER: NavGroup[] = ["NIGHT OPS", "AUDIENCE", "STAGE", "PLATFORM", "YOU"];

const links: NavLink[] = [
  {
    href: "/",
    label: "Analytics",
    group: "NIGHT OPS",
    hint: "Tonight at a glance: RSVPs, check-ins and how each event is pacing against the last one.",
    roles: ["promoter", "admin"],
  },
  {
    href: "/events",
    label: "Events",
    group: "NIGHT OPS",
    hint: "Create an event, pick the venue from the list, set capacity and lineup, then clone a past night.",
    roles: ["promoter", "admin"],
  },
  {
    href: "/applications",
    label: "DJ Applications",
    group: "NIGHT OPS",
    hint: "Applications for your events — confirm, decline or move each slot.",
    roles: ["promoter", "admin"],
  },
  {
    href: "/gig-calendar",
    label: "Gig Calendar",
    group: "NIGHT OPS",
    hint: "Open DJ slots at venues: apply for a day, evening or late-night set.",
    roles: ["artist", "admin"],
  },
  {
    href: "/artists",
    label: "Artists",
    group: "NIGHT OPS",
    hint: "The DJ roster: stage name, bio, travel rate and the gigs each one is already confirmed for.",
    roles: ["promoter", "admin"],
  },
  {
    href: "/settlements",
    label: "Settlements",
    group: "NIGHT OPS",
    hint: "Per night: DJ fees agreed, invoiced, paid by the venue, and still outstanding.",
    roles: ["promoter", "admin"],
  },
  {
    href: "/email",
    label: "Email Engine",
    group: "AUDIENCE",
    hint: "Campaigns and guest segments, plus which RSVPs each send brought in.",
    roles: ["promoter", "admin"],
  },
  {
    href: "/promotions",
    label: "Promotions",
    group: "AUDIENCE",
    hint: "Promo campaigns per event and the RSVPs they are tracked against.",
    roles: ["promoter", "admin"],
  },
  {
    href: "/insights",
    label: "Insights",
    group: "AUDIENCE",
    hint: "Guest lifetime value and cohort retention across previous nights.",
    roles: ["promoter", "admin"],
  },
  {
    href: "/door",
    label: "Door",
    group: "AUDIENCE",
    hint: "Search the guest list by name or email and check people in without a scanner.",
    roles: ["promoter", "venue_manager", "door", "admin"],
  },
  {
    href: "/artist",
    label: "Artist Portal",
    group: "STAGE",
    hint: "DJ profile and stage name, gigs, invoices with payment links, and the day-by-day route plan.",
    roles: ["artist", "admin"],
  },
  {
    href: "/earnings",
    label: "Earnings",
    group: "STAGE",
    hint: "Played gigs and their money: raise the venue invoice, remind the venue, and track what is paid.",
    roles: ["artist", "admin"],
  },
  {
    href: "/artist/profile",
    label: "My Profile",
    group: "STAGE",
    hint: "Your DJ profile: stage name, bio, and the travel costs used for routing and invoices.",
    roles: ["artist", "admin"],
  },
  {
    href: "/bookings",
    label: "Live Calendar",
    group: "STAGE",
    hint: "Your live-stream calendar: book the windows you will broadcast in — Go Live only works inside a booked session.",
    roles: ["artist", "admin"],
  },
  {
    href: "/go-live",
    label: "Go Live",
    group: "STAGE",
    hint: "Stream from this browser — camera or screen plus your mixer input, no OBS or extra software.",
    roles: ["artist", "admin"],
  },
  {
    href: "/simulcast",
    label: "Streaming",
    group: "STAGE",
    hint: "Restream one broadcast to every platform, with live status refreshed every few seconds.",
    roles: ["admin"],
  },
  {
    href: "/social",
    label: "Social Hub",
    group: "STAGE",
    hint: "Generate copy, queue posts per platform, republish or publish immediately.",
    roles: ["promoter", "admin"],
  },
  {
    href: "/venue",
    label: "Venue Portal",
    group: "PLATFORM",
    hint: "Add the rooms you run nights at, set their address and coordinates, then approve the events booked there.",
    roles: ["promoter", "venue_manager", "admin"],
  },
  {
    href: "/editor",
    label: "Front Page",
    group: "PLATFORM",
    hint: "Edit the public front page: lineup, broadcasts and site copy.",
    roles: ["admin"],
  },
  {
    href: "/mailboxes",
    label: "Mailboxes",
    group: "PLATFORM",
    hint: "Inboxes the API watches for replies, and the password for each mailbox.",
    roles: ["admin"],
  },
  {
    href: "/users",
    label: "Users",
    group: "PLATFORM",
    hint: "Every registered account: make someone a DJ, venue manager or promoter.",
    roles: ["admin"],
  },
  {
    href: "/audit",
    label: "Audit",
    group: "PLATFORM",
    hint: "Security trail: sign-ins, linked accounts, role changes and MFA activity.",
    roles: ["admin"],
  },
  {
    href: "/settings",
    label: "Settings",
    group: "PLATFORM",
    hint: "Platform rates every DJ and invoice is priced from — the standard travel rate per kilometre.",
    roles: ["admin"],
  },
  {
    href: "/notifications",
    label: "Notifications",
    group: "YOU",
    hint: "Your bell feed: DJ calls, applications, confirmations and invoice notices, with unread counts.",
  },
  {
    href: "/account",
    label: "Account",
    group: "YOU",
    hint: "The browsers signed in to your account, and a way to sign one out if you lose it.",
  },
  {
    href: "/help",
    label: "Help",
    group: "YOU",
    hint: "The manual for your role: what each screen is for, how the money works, and what to do when something looks wrong.",
  },
];

const ROLE_LABEL: Record<string, string> = {
  admin: "ADMIN",
  promoter: "PROMOTER",
  artist: "ARTIST",
  venue_manager: "VENUE",
  door: "DOOR",
  guest: "GUEST",
};

export function TopNav() {
  const path = usePathname();
  const { me } = useAuth();
  const [open, setOpen] = useState(false);
  const user = me?.user ?? null;
  // Admins see the whole dashboard; everyone else only the sections their role owns.
  const role = user?.role ?? "guest";
  const visible = links.filter((l) => role === "admin" || !l.roles || l.roles.includes(role));
  const roleLabel = ROLE_LABEL[role] ?? "MEMBER";

  const signOut = () => {
    void signOutEverywhere();
  };

  // Nested pages (a DJ profile, an event tool) keep their section highlighted.
  const isActive = (href: string) => path === href || (href !== "/" && path.startsWith(`${href}/`));

  useEffect(() => {
    setOpen(false);
  }, [path]);

  useEffect(() => {
    if (!open) return;
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    window.addEventListener("keydown", closeOnEscape);
    return () => {
      document.body.style.overflow = previous;
      window.removeEventListener("keydown", closeOnEscape);
    };
  }, [open]);

  const search = () => {
    setOpen(false);
    window.dispatchEvent(new Event("essentials:search"));
  };

  const navigation = (onNavigate?: () => void) => (
    <nav className="flex-1 overflow-y-auto px-3 pb-4" aria-label="Console sections">
      {GROUP_ORDER.map((group) => {
        const items = visible.filter((link) => link.group === group);
        if (!items.length) return null;
        return (
          <div key={group} className="mt-5 first:mt-2">
            <p className="px-3 pb-1.5 text-[9px] font-black tracking-[0.26em] text-neutral-700">{group}</p>
            <div className="space-y-0.5">
              {items.map((link) => {
                const active = isActive(link.href);
                return (
                  <Link
                    key={link.href}
                    href={link.href}
                    onClick={onNavigate}
                    title={link.hint}
                    aria-current={active ? "page" : undefined}
                    className={`group relative flex items-center rounded-lg px-3 py-2 text-[12px] font-semibold transition ${
                      active
                        ? "bg-white/[0.065] text-white"
                        : "text-neutral-500 hover:bg-white/[0.035] hover:text-neutral-200"
                    }`}
                  >
                    <span
                      className={`absolute left-0 h-4 w-0.5 rounded-r-full transition ${
                        active ? "bg-neon" : "bg-transparent group-hover:bg-line"
                      }`}
                    />
                    <span className="truncate">{link.label}</span>
                    {active && <span className="ml-auto h-1 w-1 rounded-full bg-neon" />}
                  </Link>
                );
              })}
            </div>
          </div>
        );
      })}
    </nav>
  );

  const account = (
    <div className="space-y-2 border-t border-line/70 p-3">
      <div className="rounded-xl border border-line/70 bg-white/[0.02] px-3 py-2.5">
        <div className="flex items-center justify-between gap-2">
          <span className="text-[9px] font-black tracking-[0.2em] text-neutral-600">SIGNED IN</span>
          <span className="rounded-full border border-neon/25 bg-neon/5 px-1.5 py-0.5 text-[8px] font-black tracking-[0.14em] text-neon/80">
            {roleLabel}
          </span>
        </div>
        <p className="mt-1.5 truncate text-[11px] text-neutral-400" title={user?.email ?? undefined}>
          {user?.email ?? "—"}
        </p>
      </div>
      <button
        onClick={signOut}
        title="Ends the Supabase session in this browser and returns to the sign-in screen."
        className="w-full rounded-lg border border-line/70 px-3 py-2 text-[9px] font-black tracking-[0.2em] text-neutral-500 transition hover:border-red-500/30 hover:text-red-400"
      >
        SIGN OUT
      </button>
    </div>
  );

  return (
    <>
      <aside className="fixed inset-y-0 left-0 z-40 hidden w-[17rem] flex-col border-r border-line/80 bg-[#0b0b0b]/95 backdrop-blur-xl lg:flex">
        <div className="border-b border-line/70 px-4 pb-4 pt-5">
          <Link href="/" className="group flex items-baseline gap-2">
            <span className="text-[15px] font-black tracking-[0.2em] text-neon transition group-hover:opacity-80">ESSENTIALS</span>
            <span className="text-[8px] font-black tracking-[0.22em] text-neutral-700">/ EDM</span>
          </Link>
          <p className="mt-1 text-[9px] font-bold tracking-[0.3em] text-neutral-600">CONTROL ROOM</p>
          <button
            onClick={search}
            title="Find an event, a DJ or a guest without leaving this page. ⌘K (Ctrl-K) opens it anywhere."
            className="mt-4 flex w-full items-center gap-2 rounded-lg border border-line/80 bg-white/[0.02] px-3 py-2 text-left text-[10px] font-bold tracking-[0.12em] text-neutral-500 transition hover:border-neon/35 hover:text-neon"
          >
            <span className="text-sm leading-none">⌕</span>
            <span>SEARCH EVERYTHING</span>
            <span className="ml-auto text-[9px] text-neutral-700">⌘K</span>
          </button>
        </div>
        {navigation()}
        {account}
      </aside>

      <header className="sticky top-0 z-40 border-b border-line/80 bg-bg/90 backdrop-blur-xl lg:hidden">
        <div className="flex h-14 items-center gap-3 px-4">
          <button
            onClick={() => setOpen(true)}
            aria-label="Open console menu"
            aria-expanded={open}
            className="flex h-9 w-9 flex-col items-center justify-center gap-1 rounded-lg border border-line/80 text-neutral-400"
          >
            <span className="h-px w-4 bg-current" />
            <span className="h-px w-4 bg-current" />
          </button>
          <Link href="/" className="text-sm font-black tracking-[0.18em] text-neon">ESSENTIALS</Link>
          <span className="rounded-full border border-line px-2 py-0.5 text-[8px] font-black tracking-[0.18em] text-neutral-600">CONSOLE</span>
          <button
            onClick={search}
            aria-label="Search events, DJs and guests"
            className="ml-auto flex h-9 w-9 items-center justify-center rounded-lg border border-line/80 text-sm text-neutral-400"
          >
            ⌕
          </button>
        </div>
      </header>

      {open && (
        <div className="fixed inset-0 z-50 lg:hidden" role="dialog" aria-modal="true" aria-label="Console menu">
          <button className="absolute inset-0 bg-black/75 backdrop-blur-sm" onClick={() => setOpen(false)} aria-label="Close console menu" />
          <aside className="relative flex h-full w-[min(19rem,88vw)] flex-col border-r border-line bg-[#0b0b0b] shadow-2xl">
            <div className="flex items-center justify-between border-b border-line/70 px-4 py-4">
              <div>
                <Link href="/" onClick={() => setOpen(false)} className="text-sm font-black tracking-[0.18em] text-neon">ESSENTIALS</Link>
                <p className="mt-0.5 text-[8px] font-bold tracking-[0.28em] text-neutral-600">CONTROL ROOM</p>
              </div>
              <button
                onClick={() => setOpen(false)}
                aria-label="Close console menu"
                className="flex h-9 w-9 items-center justify-center rounded-lg border border-line/80 text-lg text-neutral-500"
              >
                ×
              </button>
            </div>
            {navigation(() => setOpen(false))}
            {account}
          </aside>
        </div>
      )}
    </>
  );
}
