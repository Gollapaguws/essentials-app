import { BadRequestException } from "@nestjs/common";

export interface SlotPlan {
  /** What the promoter pays a DJ per hour; every slot is priced off it. */
  djFeePerHour: number;
  /** Planning ceiling for the night's DJ spend. */
  budget: number;
  slotCount: number;
  slotMinutes: number;
  /** Minutes after midnight, on the event's date, when the first slot starts. */
  slotStartMinute: number;
}

/**
 * The arc of an eight-hour night, in order. Each slot is tagged with the phase
 * its start time falls in (offsets run from the first slot), so the promoter and
 * the DJ both see what the set is for: a warm-up is not a closing set.
 */
export interface SlotPhase {
  /** How long the phase runs before the next one starts. */
  minutes: number;
  readonly role: string;
  readonly bpmRange: string;
  readonly genres: string;
}

export const SLOT_PHASES: readonly SlotPhase[] = [
  {
    minutes: 100,
    role: "The Setter (Warm-Up)",
    bpmRange: "124–128",
    genres: "Minimal · Deep Progressive · Understated Tech House",
  },
  {
    minutes: 100,
    role: "The Deep Bridge",
    bpmRange: "128–133",
    genres: "Progressive · Rolling Tech House · Minimal",
  },
  {
    minutes: 100,
    role: "The Rising Builder",
    bpmRange: "133–139",
    genres: "Tech House · Progressive · Psy Tech · Techno",
  },
  {
    minutes: 100,
    role: "The Peak Architect",
    bpmRange: "139–148",
    genres: "Techno · Psy Tech · Peak Tech House",
  },
  {
    minutes: 80,
    role: "The Closer (Euphoric)",
    bpmRange: "145 → 140 → 132",
    genres: "Melodic · Trance · Progressive",
  },
];

/** The phase covering `offsetMinutes` after the first slot. A night longer than
 * the whole arc stays in the closing phase rather than falling off the table. */
export function phaseForOffset(
  offsetMinutes: number,
  phases: readonly SlotPhase[] = SLOT_PHASES,
): SlotPhase {
  let remaining = Math.max(0, offsetMinutes);
  for (const phase of phases) {
    if (remaining < phase.minutes) return phase;
    remaining -= phase.minutes;
  }
  return phases[phases.length - 1] ?? SLOT_PHASES[SLOT_PHASES.length - 1];
}

/** What one slot pays: the hourly rate times its length in hours. */
export function slotFee(djFeePerHour: number, slotMinutes: number) {
  return Math.round((djFeePerHour * slotMinutes) / 60);
}

export const SLOT_COUNT_RANGE = { min: 1, max: 12 } as const;
export const SLOT_MINUTES_RANGE = { min: 30, max: 480 } as const;

/** "HH:MM" (24-hour) → minutes after midnight. */
export function parseSlotStart(value: string | undefined): number {
  const match = /^([01]\d|2[0-3]):([0-5]\d)$/.exec((value ?? "").trim());
  if (!match) throw new BadRequestException("slotStart must be HH:MM (24-hour)");
  return Number(match[1]) * 60 + Number(match[2]);
}

/**
 * Normalise the promoter's slot plan. Returns null when no plan was sent at all,
 * which keeps events without slots (and their legacy day/evening/late-night flow)
 * working.
 */
export function normalizePlan(input: {
  djFeePerHour?: number | null;
  budget?: number | null;
  slotCount?: number | null;
  slotMinutes?: number | null;
  slotStart?: string | null;
}): SlotPlan | null {
  const given = input.slotCount != null || input.slotMinutes != null || input.slotStart != null;
  if (!given) return null;

  const djFeePerHour = Math.round(Number(input.djFeePerHour ?? 0));
  const budget = Math.round(Number(input.budget ?? 0));
  const slotCount = Math.round(Number(input.slotCount ?? 0));
  const slotMinutes = Math.round(Number(input.slotMinutes ?? 0));

  // Zero is a deliberate choice: a free (unpaid) night. Negative rates are not.
  if (!Number.isFinite(djFeePerHour) || djFeePerHour < 0) {
    throw new BadRequestException("DJ fee per hour cannot be negative (set 0 for a free gig)");
  }
  if (!Number.isFinite(budget) || budget < 0) throw new BadRequestException("Budget cannot be negative");
  if (slotCount < SLOT_COUNT_RANGE.min || slotCount > SLOT_COUNT_RANGE.max) {
    throw new BadRequestException(`Slot count must be between ${SLOT_COUNT_RANGE.min} and ${SLOT_COUNT_RANGE.max}`);
  }
  if (slotMinutes < SLOT_MINUTES_RANGE.min || slotMinutes > SLOT_MINUTES_RANGE.max) {
    throw new BadRequestException(`Slot length must be between ${SLOT_MINUTES_RANGE.min} and ${SLOT_MINUTES_RANGE.max} minutes`);
  }

  return { djFeePerHour, budget, slotCount, slotMinutes, slotStartMinute: parseSlotStart(input.slotStart ?? undefined) };
}

const hhmm = (date: Date) =>
  `${String(date.getUTCHours()).padStart(2, "0")}:${String(date.getUTCMinutes()).padStart(2, "0")}`;

/**
 * Cut the night into `slotCount` back-to-back slots of `slotMinutes` from
 * `slotStartMinute`. Every slot pays the same hourly rate for its length, so the
 * promoter's budget is a ceiling to compare against, not a pot to divide.
 */
export function buildSlots(
  eventDate: Date,
  plan: SlotPlan,
  phases: readonly SlotPhase[] = SLOT_PHASES,
) {
  const dayStart = Date.UTC(eventDate.getUTCFullYear(), eventDate.getUTCMonth(), eventDate.getUTCDate());
  const firstStart = dayStart + plan.slotStartMinute * 60_000;
  const fee = slotFee(plan.djFeePerHour, plan.slotMinutes);

  return Array.from({ length: plan.slotCount }, (_, index) => {
    const startsAt = new Date(firstStart + index * plan.slotMinutes * 60_000);
    const endsAt = new Date(startsAt.getTime() + plan.slotMinutes * 60_000);
    const phase = phaseForOffset(index * plan.slotMinutes, phases);
    return {
      startsAt,
      endsAt,
      label: `${hhmm(startsAt)}–${hhmm(endsAt)}`,
      role: phase.role,
      bpmRange: phase.bpmRange,
      genres: phase.genres,
      fee,
    };
  });
}
