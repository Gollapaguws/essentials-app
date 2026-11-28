"use client";

import Link from "next/link";
import { useAuth } from "@/components/AuthProvider";
import { useResource } from "@/hooks/useResource";
import { Panel } from "@/components/console/Panel";
import { Badge } from "@/components/console/Badge";

interface Onboarding {
  organisation: { id: string; name: string; slug: string } | null;
  steps: {
    venue: boolean;
    event: boolean;
    slots: boolean;
    lineup: boolean;
  };
  complete: boolean;
}

type StepKey = keyof Onboarding["steps"];

const STEPS: {
  key: StepKey;
  title: string;
  body: string;
  href: string;
  cta: string;
}[] = [
  {
    key: "venue",
    title: "Set up your venue",
    body: "Add the room you run, or pick an existing one when you create your first night.",
    href: "/venue",
    cta: "VENUE PORTAL",
  },
  {
    key: "event",
    title: "Create your first night",
    body: "Name the night, pick the date and set the room, capacity and budget.",
    href: "/events",
    cta: "CREATE A NIGHT",
  },
  {
    key: "slots",
    title: "Open the DJ slots",
    body: "Plan the set times and fees. DJs apply from the Gig Calendar and the public event page.",
    href: "/events",
    cta: "PLAN THE LINEUP",
  },
  {
    key: "lineup",
    title: "Confirm your first DJ",
    body: "Review the applications, confirm a slot and lock the agreed fee.",
    href: "/applications",
    cta: "REVIEW APPLICATIONS",
  },
];

/**
 * First-run guide on the promoter dashboard. Progress is read from the
 * workspace's real data rather than stored locally, so it survives a new
 * browser and cannot claim a step is done when the linked page is still empty.
 * It renders nothing for other roles or once every step is complete.
 */
export function PromoterOnboarding() {
  const { me } = useAuth();
  const path =
    me?.user.role === "promoter" && !me.mfaRequired ? "/platform/onboarding" : null;
  const { data } = useResource<Onboarding>(path);

  if (!data || data.complete) return null;

  const done = STEPS.filter((step) => data.steps[step.key]).length;
  const percent = Math.round((done / STEPS.length) * 100);

  return (
    <Panel
      title={data.organisation ? `Welcome, ${data.organisation.name}` : "Welcome to your workspace"}
      description="Four steps from an empty workspace to your first confirmed DJ. The checklist disappears when it is done."
      actions={<Badge tone="info">{done} / {STEPS.length} COMPLETE</Badge>}
    >
      <div className="space-y-4">
        <div className="space-y-1.5">
          <div className="flex items-center justify-between text-[9px] font-black uppercase tracking-[0.18em] text-muted">
            <span>Setup progress</span>
            <span className="tabular-nums">{percent}%</span>
          </div>
          <div
            role="progressbar"
            aria-label="Promoter setup progress"
            aria-valuemin={0}
            aria-valuemax={STEPS.length}
            aria-valuenow={done}
            className="h-1.5 overflow-hidden rounded-full bg-surface"
          >
            <div
              className="h-full rounded-full bg-neon transition-[width] duration-300"
              style={{ width: `${percent}%` }}
            />
          </div>
        </div>

        <ol className="divide-y divide-line/70">
          {STEPS.map((step, index) => {
            const complete = data.steps[step.key];
            return (
              <li
                key={step.key}
                className="flex flex-wrap items-start gap-3 py-3 first:pt-0 last:pb-0"
              >
                <span
                  aria-hidden="true"
                  className={`mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full border text-[10px] font-black ${
                    complete
                      ? "border-neon/40 bg-neon/10 text-neon"
                      : "border-line bg-surface text-muted"
                  }`}
                >
                  {complete ? "✓" : index + 1}
                </span>
                <div className="min-w-0 flex-1">
                  <p
                    className={`text-sm font-bold ${
                      complete ? "text-muted" : "text-muted"
                    }`}
                  >
                    {step.title}
                    {complete && (
                      <span className="ml-2 text-[9px] font-black uppercase tracking-[0.18em] text-neon">
                        Done
                      </span>
                    )}
                  </p>
                  <p className="mt-0.5 text-xs leading-5 text-muted">{step.body}</p>
                </div>
                {!complete && (
                  <Link href={step.href} className="console-btn console-btn-secondary">
                    {step.cta}
                  </Link>
                )}
              </li>
            );
          })}
        </ol>

        <p className="text-[11px] text-muted">
          Want the longer version?{" "}
          <Link href="/help" className="text-muted underline hover:text-neon">
            Read the first-night walkthrough
          </Link>
          .
        </p>
      </div>
    </Panel>
  );
}
