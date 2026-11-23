import { BadRequestException } from "@nestjs/common";
import { prisma } from "@essentials/db";
import { SLOT_PHASES, type SlotPhase } from "./slots";

/** Exactly five phases: warm-up, bridge, builder, peak, closer. */
export const NIGHT_ARC_PHASE_COUNT = 5;
export const NIGHT_ARC_LIMITS = {
  minutes: { min: 15, max: 240 },
  role: 60,
  bpmRange: 40,
  genres: 160,
} as const;

/**
 * Validate a promoter-submitted arc. Durations decide where one phase hands over
 * to the next, so they are what most promoters edit; the labels can be changed
 * too, but they must still say something.
 */
export function normalizeNightArc(input: unknown): SlotPhase[] {
  if (!Array.isArray(input) || input.length !== NIGHT_ARC_PHASE_COUNT) {
    throw new BadRequestException(`A night arc needs exactly ${NIGHT_ARC_PHASE_COUNT} phases`);
  }
  return input.map((raw, index) => {
    const phase = (raw ?? {}) as Record<string, unknown>;
    const minutes = Math.round(Number(phase.minutes));
    if (
      !Number.isFinite(minutes) ||
      minutes < NIGHT_ARC_LIMITS.minutes.min ||
      minutes > NIGHT_ARC_LIMITS.minutes.max
    ) {
      throw new BadRequestException(
        `Phase ${index + 1}: length must be between ${NIGHT_ARC_LIMITS.minutes.min} and ${NIGHT_ARC_LIMITS.minutes.max} minutes`,
      );
    }
    const text = (value: unknown, field: string, limit: number) => {
      const trimmed = String(value ?? "").trim();
      if (!trimmed) throw new BadRequestException(`Phase ${index + 1}: ${field} cannot be empty`);
      if (trimmed.length > limit) {
        throw new BadRequestException(`Phase ${index + 1}: ${field} is limited to ${limit} characters`);
      }
      return trimmed;
    };
    return {
      minutes,
      role: text(phase.role, "role", NIGHT_ARC_LIMITS.role),
      bpmRange: text(phase.bpmRange, "BPM range", NIGHT_ARC_LIMITS.bpmRange),
      genres: text(phase.genres, "genres", NIGHT_ARC_LIMITS.genres),
    };
  });
}

/** Stored arcs were validated on save; anything unreadable falls back to the default. */
export function parseNightArc(value: unknown): readonly SlotPhase[] {
  const phases = Array.isArray(value) ? value : [];
  if (phases.length !== NIGHT_ARC_PHASE_COUNT) return SLOT_PHASES;
  const valid = phases.every(
    (phase) =>
      phase &&
      typeof phase === "object" &&
      Number.isFinite(Number((phase as SlotPhase).minutes)) &&
      String((phase as SlotPhase).role ?? "").trim(),
  );
  return valid ? (phases as SlotPhase[]) : SLOT_PHASES;
}

/** The arc a promoter's nights are tagged with: theirs if saved, otherwise the default. */
export async function loadNightArc(promoterId: string): Promise<readonly SlotPhase[]> {
  const arc = await prisma.promoterNightArc.findUnique({ where: { promoterId } });
  return arc ? parseNightArc(arc.phases) : SLOT_PHASES;
}
