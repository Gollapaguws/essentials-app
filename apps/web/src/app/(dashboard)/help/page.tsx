"use client";

import { useState } from "react";
import { TopNav } from "@/components/TopNav";
import { useAuth } from "@/components/AuthProvider";
import {
  HELP_LABELS,
  HELP_MANUALS,
  HELP_ORDER,
  isHelpRole,
  type HelpManual,
  type HelpRole,
} from "@/lib/help";

/**
 * The manual for the role you are signed in as. Admins can read the other three
 * because they hold every screen; everyone else sees only their own, which is
 * all that applies to them.
 */
export default function Help() {
  const { me } = useAuth();
  const role = me?.user.role ?? "guest";
  const own = isHelpRole(role) ? role : null;
  const [picked, setPicked] = useState<HelpRole | null>(null);
  const shown = picked ?? own;
  const manual = shown ? HELP_MANUALS[shown] : null;

  return (
    <>
      <TopNav />
      <main className="max-w-4xl mx-auto px-6 py-8 space-y-8">
        <div>
          <h1 className="text-2xl font-black tracking-wide">HELP</h1>
          <p className="text-neutral-500 text-xs mt-1 max-w-2xl">
            The manual for your role: what each screen is for, how the money works, and the answer
            to most &ldquo;it will not work&rdquo; moments. It is written from the app, not from a
            template &mdash; when a screen changes, this changes with it.
          </p>
        </div>

        {own === "admin" && (
          <div className="flex flex-wrap gap-2">
            {HELP_ORDER.map((r) => (
              <button
                key={r}
                type="button"
                onClick={() => setPicked(r)}
                aria-pressed={shown === r}
                className={`text-[11px] font-bold tracking-widest rounded-full border px-3 py-1.5 ${
                  shown === r
                    ? "border-neon text-neon"
                    : "border-line text-neutral-500 hover:text-white"
                }`}
              >
                {HELP_LABELS[r].toUpperCase()}
              </button>
            ))}
          </div>
        )}

        {manual ? (
          <Manual manual={manual} />
        ) : (
          <div className="border border-line rounded-xl p-6 space-y-2">
            <h2 className="text-lg font-bold">No manual for this account</h2>
            <p className="text-sm text-neutral-400 max-w-xl">
              The dashboard is for DJs, promoters, venue managers and admins. A guest account has no
              dashboard screens to document &mdash; an admin sets the role on the Users page, and the
              manual appears here on the next sign-in.
            </p>
          </div>
        )}
      </main>
    </>
  );
}

function Manual({ manual }: { manual: HelpManual }) {
  return (
    <article className="space-y-8">
      <div className="border border-line rounded-xl px-6 py-5">
        <h2 className="text-lg font-black tracking-wide">{manual.title}</h2>
        <p className="text-sm text-neutral-400 mt-2">{manual.summary}</p>
        <p className="text-[11px] uppercase tracking-widest text-neutral-600 mt-4">
          {manual.screens}
        </p>
      </div>

      {manual.topics.map((topic, i) => (
        <section key={topic.title} className="space-y-3">
          <h3 className="text-sm font-bold tracking-widest text-neon">
            {String(i + 1).padStart(2, "0")} · {topic.title.toUpperCase()}
          </h3>
          {topic.intro && <p className="text-sm text-neutral-400 max-w-2xl">{topic.intro}</p>}
          <ul className="space-y-2 max-w-2xl">
            {topic.points.map((point) => (
              <li key={point} className="text-sm text-neutral-300 leading-relaxed pl-4 relative">
                <span className="absolute left-0 text-neutral-600">–</span>
                {point}
              </li>
            ))}
          </ul>
        </section>
      ))}
    </article>
  );
}
