import { describe, expect, it } from "vitest";
import {
  DEFAULT_HOUR_ALLOWANCES, OCCUPANCY_MODIFIERS, applySiteAccess, asksLift,
  hourAllowancesFrom, type SiteAccess,
} from "./site-access";

const seeded = (...codes: string[]) => codes.map((code) => ({ code, multiplier: 1.02 }));
const allSeeded = seeded(...Object.values(OCCUPANCY_MODIFIERS).map((o) => o.code));

describe("occupancy is a percentage — it scales with the job (Tom, 9 Sep)", () => {
  it("prices empty and mostly empty at 2%, furnished at 4%", () => {
    expect(OCCUPANCY_MODIFIERS.yes.pct).toBe(2);
    expect(OCCUPANCY_MODIFIERS.some.pct).toBe(2);
    expect(OCCUPANCY_MODIFIERS.no.pct).toBe(4);
  });

  it("selects the occupancy modifier once Tom has seeded it", () => {
    expect(applySiteAccess({ cleared: "no" }, allSeeded).modSel).toEqual({ Staging: "STG-FURNISHED" });
    expect(applySiteAccess({ cleared: "yes" }, allSeeded).modSel).toEqual({ Staging: "STG-EMPTY" });
  });

  /**
   * One selection per group is how jobModifier works, so occupancy sits in
   * Staging — the group the lived-in-home modifier already uses — and the two
   * can never compound into a double allowance.
   */
  it("never returns more than one Staging selection", () => {
    const out = applySiteAccess({ cleared: "no", parking: "hard", lift: "yes" }, allSeeded);
    expect(Object.keys(out.modSel)).toEqual(["Staging"]);
  });

  it("names the code and the multiplier to seed when it does not exist yet", () => {
    const out = applySiteAccess({ cleared: "no" }, []);
    expect(out.modSel).toEqual({});
    expect(out.deferred[0].needs).toContain("STG-FURNISHED");
    expect(out.deferred[0].needs).toContain("1.04");
    expect(out.deferred[0].needs).toContain("about 4%");
  });
});

describe("parking and a lift are FLAT HOURS — they do not scale (Tom, 9 Sep)", () => {
  /**
   * Carrying gear from a side street costs the same two hours whether it is
   * one room or ten. A percentage would under-price the small job it hurts
   * most and over-price the big one.
   */
  it("allows 2.5 hours for difficult parking and 1 for a lift", () => {
    const out = applySiteAccess({ parking: "hard", lift: "yes" }, []);
    expect(out.hours.map((h) => [h.key, h.hours])).toEqual([["parking:hard", 2.5], ["lift:yes", 1]]);
  });

  it("needs no seeded modifier — hours price on their own", () => {
    expect(applySiteAccess({ parking: "hard" }, []).deferred).toEqual([]);
  });

  it("allows nothing for a driveway, the street, or no lift", () => {
    expect(applySiteAccess({ parking: "drive", lift: "no" }, []).hours).toEqual([]);
    expect(applySiteAccess({ parking: "street" }, []).hours).toEqual([]);
  });

  it("takes Tom's hours from Settings when he changes them", () => {
    const tuned = hourAllowancesFrom({ "parking:hard": { hours: 3 } });
    expect(applySiteAccess({ parking: "hard" }, [], tuned).hours[0].hours).toBe(3);
    // …and keeps the shipped value for anything he has not touched.
    expect(tuned["lift:yes"].hours).toBe(DEFAULT_HOUR_ALLOWANCES["lift:yes"].hours);
  });

  it("ignores a junk hours value rather than pricing it", () => {
    const junk = hourAllowancesFrom({ "parking:hard": { hours: "lots" }, "lift:yes": { hours: -4 } });
    expect(junk["parking:hard"].hours).toBe(2.5);
    expect(junk["lift:yes"].hours).toBe(1);
  });
});

describe("what Tom does NOT price", () => {
  /** The floors allowance is already inside the empty/furnished figure. */
  it("prices floors at nothing, whatever the answer", () => {
    for (const floors of ["carpet", "hard", "mixed"] as const) {
      const out = applySiteAccess({ floors }, allSeeded);
      expect(out.modSel, floors).toEqual({});
      expect(out.hours, floors).toEqual([]);
      expect(out.deferred, floors).toEqual([]);
    }
  });

  /** Not allowed for today — but the painter still has to know. */
  it("makes a stairwell a note, not a price", () => {
    const out = applySiteAccess({ stairwell: "yes" }, allSeeded);
    expect(out.modSel).toEqual({});
    expect(out.hours).toEqual([]);
    expect(out.notes.join(" ")).toMatch(/trestles or a platform/);
  });

  it("makes pets a note, not a price", () => {
    expect(applySiteAccess({ pets: "yes" }, []).notes.join(" ")).toMatch(/doors and gates/);
    expect(applySiteAccess({ pets: "no" }, []).notes).toEqual([]);
  });
});

describe("an unanswered screen costs nothing", () => {
  it("returns nothing at all", () => {
    const out = applySiteAccess({}, allSeeded);
    expect(out).toEqual({ modSel: {}, hours: [], notes: [], deferred: [] });
  });
});

describe("the lift question", () => {
  it("is asked in a unit or apartment only", () => {
    expect(asksLift("unit_apartment")).toBe(true);
    expect(asksLift("house")).toBe(false);
    expect(asksLift(null)).toBe(false);
  });
});

describe("a whole answer set", () => {
  it("prices the percentage and the hours together, and notes the rest", () => {
    const a: SiteAccess = {
      cleared: "no", floors: "hard", stairwell: "yes", parking: "hard", lift: "yes", pets: "yes",
    };
    const out = applySiteAccess(a, allSeeded);
    expect(out.modSel).toEqual({ Staging: "STG-FURNISHED" });
    expect(out.hours.reduce((n, h) => n + h.hours, 0)).toBe(3.5);
    expect(out.notes).toHaveLength(2);
    expect(out.deferred).toEqual([]);
  });
});
