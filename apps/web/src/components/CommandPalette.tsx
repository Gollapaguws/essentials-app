"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { api } from "@essentials/api-client";

/**
 * ⌘K over the whole dashboard: events, DJs and guests in one list, scoped by
 * the API to what this account may see. Opening it is a window event so any
 * screen (or the nav) can trigger it without owning its state.
 */
interface Results {
  events: { id: string; title: string; date: string; status: string; venue: string }[];
  artists: { id: string; name: string }[];
  guests: { id: string; name: string | null; email: string; status: string; eventId: string; eventTitle: string }[];
}

const EMPTY: Results = { events: [], artists: [], guests: [] };

interface Item {
  key: string;
  group: "Events" | "DJs" | "Guests";
  label: string;
  detail: string;
  href: string;
}

function flatten(results: Results): Item[] {
  const items: Item[] = [];
  for (const e of results.events) {
    items.push({
      key: `event:${e.id}`,
      group: "Events",
      label: e.title,
      detail: `${new Date(e.date).toLocaleDateString()} · ${e.venue} · ${e.status.replace(/_/g, " ")}`,
      href: `/events?focus=${encodeURIComponent(e.id)}`,
    });
  }
  for (const a of results.artists) {
    items.push({ key: `artist:${a.id}`, group: "DJs", label: a.name, detail: "Artist profile", href: `/artists/${a.id}` });
  }
  for (const g of results.guests) {
    items.push({
      key: `guest:${g.id}`,
      group: "Guests",
      label: g.name || g.email,
      detail: `${g.eventTitle} · ${g.status.replace(/_/g, " ")}`,
      href: `/door?event=${encodeURIComponent(g.eventId)}&q=${encodeURIComponent(g.name || g.email)}`,
    });
  }
  return items;
}

const GROUP_ORDER: Item["group"][] = ["Events", "DJs", "Guests"];

export function CommandPalette() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<Results>(EMPTY);
  const [active, setActive] = useState(0);
  const [busy, setBusy] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  // Results can land out of order; only the newest request may write state.
  const latest = useRef(0);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setOpen((o) => !o);
      } else if (e.key === "Escape") {
        setOpen(false);
      }
    };
    const onOpen = () => setOpen(true);
    window.addEventListener("keydown", onKey);
    window.addEventListener("essentials:search", onOpen);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("essentials:search", onOpen);
    };
  }, []);

  useEffect(() => {
    if (!open) return;
    const t = setTimeout(() => input.current?.focus(), 0);
    return () => clearTimeout(t);
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const term = query.trim();
    if (term.length < 2) {
      setResults(EMPTY);
      setBusy(false);
      return;
    }
    const mine = ++latest.current;
    setBusy(true);
    const t = setTimeout(() => {
      api
        .get<Results>(`/search?q=${encodeURIComponent(term)}`)
        .then((r) => mine === latest.current && setResults(r))
        .catch(() => mine === latest.current && setResults(EMPTY))
        .finally(() => mine === latest.current && setBusy(false));
    }, 180);
    return () => clearTimeout(t);
  }, [query, open]);

  const items = useMemo(() => flatten(results), [results]);

  useEffect(() => setActive(0), [items.length, query]);

  const close = () => {
    setOpen(false);
    setQuery("");
  };

  const go = (item: Item) => {
    close();
    router.push(item.href);
  };

  if (!open) return null;

  const grouped = GROUP_ORDER.map((group) => ({
    group,
    rows: items.filter((i) => i.group === group),
  })).filter((g) => g.rows.length);

  return (
    <div
      className="fixed inset-0 z-50 bg-black/70 backdrop-blur-sm px-4 pt-24"
      onClick={close}
      role="dialog"
      aria-modal="true"
      aria-label="Search the dashboard"
    >
      <div
        className="max-w-xl mx-auto rounded-2xl border border-line bg-surface shadow-2xl overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        <input
          ref={input}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "ArrowDown") {
              e.preventDefault();
              setActive((i) => (items.length ? (i + 1) % items.length : 0));
            } else if (e.key === "ArrowUp") {
              e.preventDefault();
              setActive((i) => (items.length ? (i - 1 + items.length) % items.length : 0));
            } else if (e.key === "Enter" && items[active]) {
              e.preventDefault();
              go(items[active]);
            }
          }}
          placeholder="Search events, DJs or guests…"
          aria-label="Search events, DJs or guests"
          className="w-full bg-transparent px-5 py-4 text-sm outline-none placeholder:text-neutral-600"
        />

        <div className="border-t border-line max-h-80 overflow-y-auto">
          {grouped.map(({ group, rows }) => (
            <div key={group}>
              <p className="px-5 pt-3 pb-1 text-[10px] tracking-[0.2em] text-neutral-600">{group.toUpperCase()}</p>
              {rows.map((item) => {
                const index = items.indexOf(item);
                return (
                  <button
                    key={item.key}
                    onClick={() => go(item)}
                    onMouseEnter={() => setActive(index)}
                    className={`w-full text-left px-5 py-2 flex items-baseline gap-3 ${
                      index === active ? "bg-neon/10 text-neon" : "text-neutral-300"
                    }`}
                  >
                    <span className="text-sm truncate">{item.label}</span>
                    <span className="ml-auto text-[11px] text-neutral-600 truncate max-w-[55%] text-right">
                      {item.detail}
                    </span>
                  </button>
                );
              })}
            </div>
          ))}

          {!grouped.length && (
            <p className="px-5 py-6 text-xs tracking-widest text-neutral-600">
              {query.trim().length < 2
                ? "TYPE AT LEAST TWO LETTERS"
                : busy
                  ? "SEARCHING…"
                  : `NOTHING MATCHES “${query.trim()}”`}
            </p>
          )}
        </div>

        <div className="border-t border-line px-5 py-2 flex items-center gap-4 text-[10px] tracking-widest text-neutral-600">
          <span>↑↓ MOVE</span>
          <span>↵ OPEN</span>
          <span>ESC CLOSE</span>
          {busy && <span className="ml-auto text-neon/70">…</span>}
        </div>
      </div>
    </div>
  );
}
