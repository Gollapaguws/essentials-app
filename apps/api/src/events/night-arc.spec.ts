import { BadRequestException } from "@nestjs/common";
import { normalizeNightArc, parseNightArc } from "./night-arc";
import { phaseForOffset, SLOT_PHASES } from "./slots";

const phase = (over: Record<string, unknown> = {}) => ({
  minutes: 100,
  role: "The Setter (Warm-Up)",
  bpmRange: "124–128",
  genres: "Minimal",
  ...over,
});

describe("normalizeNightArc", () => {
  it("keeps a valid five-phase arc, trimming labels", () => {
    const arc = normalizeNightArc([phase({ role: "  Opening  " }), phase(), phase(), phase(), phase({ minutes: 80 })]);

    expect(arc).toHaveLength(5);
    expect(arc[0].role).toBe("Opening");
    expect(arc[4].minutes).toBe(80);
  });

  it("rejects the wrong number of phases", () => {
    expect(() => normalizeNightArc([phase(), phase()])).toThrow(BadRequestException);
    expect(() => normalizeNightArc(undefined)).toThrow(BadRequestException);
  });

  it("rejects lengths outside 15–240 minutes and empty labels", () => {
    expect(() => normalizeNightArc([phase({ minutes: 5 }), phase(), phase(), phase(), phase()])).toThrow(
      /between 15 and 240/,
    );
    expect(() =>
      normalizeNightArc([phase(), phase({ role: " " }), phase(), phase(), phase()]),
    ).toThrow(/role cannot be empty/);
  });
});

describe("parseNightArc", () => {
  it("falls back to the default when stored json is unusable", () => {
    expect(parseNightArc(null)).toBe(SLOT_PHASES);
    expect(parseNightArc([{ minutes: "oops" }])).toBe(SLOT_PHASES);
  });

  it("returns a saved arc as-is", () => {
    const saved = [phase({ minutes: 45 }), phase(), phase(), phase(), phase()];
    expect(parseNightArc(saved)).toEqual(saved);
  });
});

describe("a custom arc drives slot tagging", () => {
  it("hands over at the promoter's own boundaries", () => {
    const arc = [
      phase({ minutes: 45, role: "Warm-up" }),
      phase({ minutes: 45, role: "Bridge" }),
      phase({ minutes: 60, role: "Builder" }),
      phase({ minutes: 60, role: "Peak" }),
      phase({ minutes: 30, role: "Closer" }),
    ];

    expect(phaseForOffset(44, arc).role).toBe("Warm-up");
    expect(phaseForOffset(45, arc).role).toBe("Bridge");
    expect(phaseForOffset(150, arc).role).toBe("Peak");
    expect(phaseForOffset(500, arc).role).toBe("Closer");
    // The default arc is untouched.
    expect(phaseForOffset(150).role).toBe("The Deep Bridge");
  });
});
