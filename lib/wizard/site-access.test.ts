import { describe, expect, it } from "vitest";
import { SITE_ACCESS_RULES, applySiteAccess, asksLift, petsNote, type SiteAccess } from "./site-access";

const seeded = (...codes: string[]) => codes.map((code) => ({ code, multiplier: 1.2 }));

describe("answers that cost nothing raise nothing", () => {
  /**
   * A screen that flags every answer teaches the estimator to ignore the
   * flags. Only answers that imply extra work may raise one.
   */
  it("is silent on cleared rooms, carpet, a driveway and no pets", () => {
    const a: SiteAccess = { cleared: "yes", floors: "carpet", stairwell: "no", parking: "drive", pets: "no" };
    const out = applySiteAccess(a, []);
    expect(out.deferred).toEqual([]);
    expect(out.modSel).toEqual({});
    expect(out.because).toEqual([]);
  });

  it("is silent on an unanswered screen", () => {
    expect(applySiteAccess({}, []).deferred).toEqual([]);
  });
});

describe("an answer with no seeded modifier becomes an amber note, never a guess", () => {
  /**
   * The allowances spec §4 is not in the repository, so there are no
   * multipliers to ship. An answer must still never vanish.
   */
  it("defers furniture-stays and names the modifier Tom should seed", () => {
    const out = applySiteAccess({ cleared: "no" }, []);
    expect(out.modSel).toEqual({});
    expect(out.deferred).toHaveLength(1);
    expect(out.deferred[0].what).toBe("cleared — no");
    expect(out.deferred[0].needs).toContain("ACC-FURNITURE-STAYS");
    expect(out.deferred[0].needs).toContain("Settings → Pricing → Modifiers");
  });

  it("prices it the moment the modifier exists, and stops deferring", () => {
    const out = applySiteAccess({ cleared: "no" }, seeded("ACC-FURNITURE-STAYS"));
    expect(out.modSel).toEqual({ Staging: "ACC-FURNITURE-STAYS" });
    expect(out.deferred).toEqual([]);
  });

  it("defers each costly answer separately", () => {
    const out = applySiteAccess({ cleared: "no", stairwell: "yes", parking: "hard" }, []);
    expect(out.deferred.map((d) => d.what).sort())
      .toEqual(["cleared — no", "parking — hard", "stairwell — yes"]);
  });

  it("mixes seeded and unseeded without losing either", () => {
    const out = applySiteAccess({ cleared: "no", stairwell: "yes" }, seeded("ACC-STAIRWELL"));
    expect(out.modSel).toEqual({ Access: "ACC-STAIRWELL" });
    expect(out.deferred.map((d) => d.what)).toEqual(["cleared — no"]);
  });
});

describe("modifier groups", () => {
  /** jobModifier applies ONE selection per group, so a group must not collide. */
  it("keeps staging and access in their own groups", () => {
    const out = applySiteAccess(
      { cleared: "no", stairwell: "yes" },
      seeded("ACC-FURNITURE-STAYS", "ACC-STAIRWELL"),
    );
    expect(out.modSel).toEqual({ Staging: "ACC-FURNITURE-STAYS", Access: "ACC-STAIRWELL" });
  });

  it("gives hard and mixed floors the same code, and says why once", () => {
    expect(SITE_ACCESS_RULES["floors:hard"].code).toBe(SITE_ACCESS_RULES["floors:mixed"].code);
    const out = applySiteAccess({ floors: "mixed" }, []);
    expect(out.because).toHaveLength(1);
  });
});

describe("the things that are notes, not prices", () => {
  it("turns pets into a note for the painter", () => {
    expect(petsNote({ pets: "yes" })).toContain("doors and gates");
    expect(petsNote({ pets: "no" })).toBeNull();
    expect(petsNote({})).toBeNull();
  });

  it("asks about the lift only in a unit or apartment", () => {
    expect(asksLift("unit_apartment")).toBe(true);
    expect(asksLift("house")).toBe(false);
    expect(asksLift(null)).toBe(false);
  });
});

describe("every rule is answerable and explains itself", () => {
  it("names a code, a group, a need and a reason", () => {
    for (const [key, rule] of Object.entries(SITE_ACCESS_RULES)) {
      expect(key, key).toMatch(/^[a-z]+:[a-z]+$/);
      expect(rule.code, key).toMatch(/^ACC-[A-Z-]+$/);
      expect(rule.group.length, key).toBeGreaterThan(2);
      expect(rule.needs.length, key).toBeGreaterThan(20);
      expect(rule.because.length, key).toBeGreaterThan(15);
    }
  });
});
