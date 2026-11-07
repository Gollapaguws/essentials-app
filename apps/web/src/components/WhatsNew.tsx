"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useAuth } from "@/components/AuthProvider";

/**
 * Dismissible "what's new" card for the people who use the new event economics:
 * promoters plan and confirm (spending), DJs apply, play and invoice (earning).
 * Dismissal is per browser and per RELEASE version, so a future release shows a
 * fresh card without needing a server-side read.
 */
const KEY = "essentials-whatsnew-event-budgets-2026-11";

const copy = {
  promoter: {
    lead: "This week: the night's DJ pay is now planned and capped before you confirm anyone.",
    points: [
      "Slots: pick how many, how long and when they start — each slot pays the hourly DJ fee for its length.",
      "Budget: confirmations stop at the budget instead of just warning. Raise the budget on Events to unblock one.",
      "Completion: after the set, confirm the gig happened before the DJ can invoice the venue.",
      "Completed gigs stay counted against the budget.",
    ],
    href: "/events",
    label: "OPEN EVENTS",
  },
  artist: {
    lead: "This week: you apply for a specific slot, know the fee up front, and invoice once the promoter confirms you played.",
    points: [
      "Each slot on the gig calendar shows its exact start, end and fee.",
      "Invoice the venue only after the promoter's completion confirmation for a gig you played.",
      "New Earnings view: what completed gigs have earned, without travel, matching what venues are billed.",
      "Travel is the flat R4.95/km rate set by ESSENTIALS — DJs and promoters can't change it.",
    ],
    href: "/earnings",
    label: "SEE EARNINGS",
  },
} as const;

export function WhatsNew() {
  const { me } = useAuth();
  const role = me?.user.role;
  const [hidden, setHidden] = useState(true);

  useEffect(() => {
    if (role !== "promoter" && role !== "artist") return;
    if (localStorage.getItem(KEY) === "1") return;
    setHidden(false);
  }, [role]);

  if (hidden || (role !== "promoter" && role !== "artist")) return null;
  const note = copy[role];

  return (
    <aside
      aria-label="What's new"
      className="fixed bottom-4 right-4 left-4 sm:left-auto z-40 sm:max-w-sm rounded-xl border border-neon/40 bg-bg/95 backdrop-blur p-4 shadow-lg space-y-3 text-sm"
    >
      <div className="flex items-start justify-between gap-3">
        <h2 className="text-xs font-black tracking-widest text-neon">WHAT&apos;S NEW</h2>
        <button
          onClick={() => {
            localStorage.setItem(KEY, "1");
            setHidden(true);
          }}
          className="text-neutral-500 hover:text-neutral-300 text-xs font-bold"
          aria-label="Dismiss what's new"
        >
          GOT IT
        </button>
      </div>
      <p className="text-neutral-300">{note.lead}</p>
      <ul className="space-y-1.5 text-xs text-neutral-400">
        {note.points.map((p) => (
          <li key={p} className="flex gap-2">
            <span className="text-neon">·</span>
            <span>{p}</span>
          </li>
        ))}
      </ul>
      <Link
        href={note.href}
        onClick={() => {
          localStorage.setItem(KEY, "1");
          setHidden(true);
        }}
        className="inline-block bg-neon text-bg text-xs font-black tracking-widest rounded-lg px-3 py-1.5"
      >
        {note.label}
      </Link>
    </aside>
  );
}
