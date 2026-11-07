import { BadRequestException } from "@nestjs/common";
import { buildSlots, normalizePlan, slotFee } from "./slots";

const eventDate = new Date("2027-03-13T00:00:00.000Z");

describe("normalizePlan", () => {
  it("returns null when no slot plan was sent (legacy events still work)", () => {
    expect(normalizePlan({})).toBeNull();
    expect(normalizePlan({ budget: 5000 })).toBeNull();
  });

  it("requires the DJ fee per hour, because that is what the DJ invoices", () => {
    expect(() => normalizePlan({ slotCount: 4, slotMinutes: 60, slotStart: "20:00" })).toThrow(BadRequestException);
    expect(() => normalizePlan({ djFeePerHour: 0, slotCount: 4, slotMinutes: 60, slotStart: "20:00" })).toThrow(
      /DJ fee per hour/,
    );
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

  it("rounds to whole currency units", () => {
    expect(slotFee(333, 60)).toBe(333);
    expect(slotFee(100, 20)).toBe(33);
  });
});

describe("buildSlots", () => {
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
