import { BadRequestException } from "@nestjs/common";
import { buildSlots, normalizePlan, phaseForOffset, slotFee } from "./slots";

const eventDate = new Date("2027-03-13T00:00:00.000Z");

describe("normalizePlan", () => {
  it("returns null when no slot plan was sent (legacy events still work)", () => {
    expect(normalizePlan({})).toBeNull();
    expect(normalizePlan({ budget: 5000 })).toBeNull();
  });

  it("accepts a free night but rejects a negative rate", () => {
    expect(normalizePlan({ djFeePerHour: 0, slotCount: 4, slotMinutes: 60, slotStart: "20:00" })).toMatchObject({
      djFeePerHour: 0,
    });
    expect(() =>
      normalizePlan({ djFeePerHour: -1, slotCount: 4, slotMinutes: 60, slotStart: "20:00" }),
    ).toThrow(BadRequestException);
    // No rate sent at all is the same as free, not an error.
    expect(normalizePlan({ slotCount: 4, slotMinutes: 60, slotStart: "20:00" })).toMatchObject({
      djFeePerHour: 0,
    });
  });

  it("rejects impossible plans", () => {
    const base = { djFeePerHour: 500, slotMinutes: 60, slotStart: "20:00" };
    expect(() => normalizePlan({ ...base, slotCount: 0 })).toThrow(/Slot count/);
    expect(() => normalizePlan({ ...base, slotCount: 13 })).toThrow(/Slot count/);
    expect(() => normalizePlan({ ...base, slotCount: 4, slotMinutes: 15 })).toThrow(/Slot length/);
    expect(() => normalizePlan({ ...base, slotCount: 4, slotStart: "8pm" })).toThrow(/HH:MM/);
    expect(() => normalizePlan({ ...base, slotCount: 4, budget: -1 })).toThrow(/Budget/);
  });

  it("accepts a full plan", () => {
    expect(normalizePlan({ djFeePerHour: 500, budget: 5000, slotCount: 4, slotMinutes: 60, slotStart: "20:00" })).toEqual({
      djFeePerHour: 500,
      budget: 5000,
      slotCount: 4,
      slotMinutes: 60,
      slotStartMinute: 20 * 60,
    });
  });
});

describe("slotFee", () => {
  it("pays the hourly rate for the slot's length", () => {
    expect(slotFee(500, 60)).toBe(500);
    expect(slotFee(500, 90)).toBe(750);
    expect(slotFee(300, 45)).toBe(225);
    expect(slotFee(450, 30)).toBe(225);
  });

  it("pays nothing on a free night", () => {
    expect(slotFee(0, 60)).toBe(0);
    expect(slotFee(0, 90)).toBe(0);
  });

  it("rounds to whole currency units", () => {
    expect(slotFee(333, 60)).toBe(333);
    expect(slotFee(100, 20)).toBe(33);
  });
});

describe("phaseForOffset", () => {
  it("starts the night warm and climbs through the arc", () => {
    expect(phaseForOffset(0)).toMatchObject({ role: "The Setter (Warm-Up)", bpmRange: "124–128" });
    expect(phaseForOffset(99).role).toBe("The Setter (Warm-Up)");
    expect(phaseForOffset(100)).toMatchObject({ role: "The Deep Bridge", bpmRange: "128–133" });
    expect(phaseForOffset(200).role).toBe("The Rising Builder");
    expect(phaseForOffset(300)).toMatchObject({ role: "The Peak Architect", bpmRange: "139–148" });
    expect(phaseForOffset(400)).toMatchObject({ role: "The Closer (Euphoric)", bpmRange: "145 → 140 → 132" });
  });

  it("keeps a night longer than eight hours in the closing phase", () => {
    expect(phaseForOffset(600).role).toBe("The Closer (Euphoric)");
  });
});

describe("buildSlots", () => {
  it("tags every slot with the phase it starts in", () => {
    const slots = buildSlots(eventDate, {
      djFeePerHour: 500,
      budget: 0,
      slotCount: 8,
      slotMinutes: 60,
      slotStartMinute: 20 * 60,
    });

    expect(slots.map((s) => s.role)).toEqual([
      "The Setter (Warm-Up)",
      "The Setter (Warm-Up)",
      "The Deep Bridge",
      "The Deep Bridge",
      "The Rising Builder",
      "The Peak Architect",
      "The Peak Architect",
      "The Closer (Euphoric)",
    ]);
    expect(slots[7].bpmRange).toBe("145 → 140 → 132");
    expect(slots[5].genres).toContain("Peak Tech House");
  });

  it("cuts the night into back-to-back slots from the start time, all at the same fee", () => {
    const slots = buildSlots(eventDate, {
      djFeePerHour: 500,
      budget: 5000,
      slotCount: 4,
      slotMinutes: 60,
      slotStartMinute: 20 * 60,
    });

    expect(slots).toHaveLength(4);
    expect(slots[0].startsAt.toISOString()).toBe("2027-03-13T20:00:00.000Z");
    expect(slots[3].startsAt.toISOString()).toBe("2027-03-13T23:00:00.000Z");
    expect(slots[3].endsAt.toISOString()).toBe("2027-03-14T00:00:00.000Z");
    expect(slots.map((s) => s.label)).toEqual(["20:00–21:00", "21:00–22:00", "22:00–23:00", "23:00–00:00"]);
    expect(slots.every((s) => s.fee === 500)).toBe(true);
  });

  it("prices longer slots off the same hourly rate", () => {
    const slots = buildSlots(eventDate, {
      djFeePerHour: 400,
      budget: 0,
      slotCount: 3,
      slotMinutes: 90,
      slotStartMinute: 19 * 60 + 30,
    });

    expect(slots[0].label).toBe("19:30–21:00");
    expect(slots[2].endsAt.toISOString()).toBe("2027-03-14T00:00:00.000Z");
    expect(slots.map((s) => s.fee)).toEqual([600, 600, 600]);
  });
});
