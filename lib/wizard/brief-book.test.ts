import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { briefBookSchema, briefEmailIntro, briefOutcomeNote, briefTitle } from "./brief-book";
import { DEFAULT_SEGMENTS, briefConfigFor, checklistFromBrief, defaultBriefAnswers } from "./segments";
import { stepsFor } from "./quick-look";

/**
 * C14 — the brief path never prices (§4.16), and the checklist is data.
 */

describe("the brief path never prices", () => {
  it("neither the contract module nor the booking route imports the pricing engine", () => {
    for (const file of ["lib/wizard/brief-book.ts", "app/api/wizard/brief-book/route.ts"]) {
      const src = readFileSync(new URL(`../../${file}`, import.meta.url), "utf8");
      // Imports and calls, not prose — the route's own comment says "nothing from lib/pricing".
      expect(src, file).not.toMatch(/from "[^"]*lib\/pricing|editorPayload\(|customerPayload\(|priceEstimateTotals\(|wizard-edit\/|applyWizardAnswers\(|buildDraft\(/);
    }
  });

  it("the brief screens never sit beside the reveal in the step list", () => {
    for (const door of ["brief", "brief_after_areas"] as const) {
      const steps = stepsFor("interior", "commercial", "areas", door);
      expect(steps).toContain("com_brief");
      expect(steps).toContain("com_book");
      expect(steps).not.toContain("com_job");
    }
    expect(stepsFor("exterior", "commercial")).toEqual(["start", "place", "segment", "com_brief", "com_book"]);
  });
});

describe("the brief config and its checklist map", () => {
  it("finds the five brief configs: the segment's own row, the health row for a hospital, the exterior row", () => {
    expect(briefConfigFor(DEFAULT_SEGMENTS, "strata")?.brief.kick).toBe("STRATA OR COMMON PROPERTY");
    expect(briefConfigFor(DEFAULT_SEGMENTS, "shopfront")?.brief.kick).toBe("SHOP FRONT — THE FACADE");
    expect(briefConfigFor(DEFAULT_SEGMENTS, "other")?.brief.kick).toBe("SOMETHING ELSE");
    expect(briefConfigFor(DEFAULT_SEGMENTS, "hospital")?.row.key).toBe("health");
    expect(briefConfigFor(DEFAULT_SEGMENTS, "hospital")?.brief.kick).toBe("HOSPITAL");
    expect(briefConfigFor(DEFAULT_SEGMENTS, "exterior")?.brief.kick).toBe("COMMERCIAL — OUTSIDE");
    expect(briefConfigFor(DEFAULT_SEGMENTS, "office")).toBeNull();
    expect(briefConfigFor(DEFAULT_SEGMENTS, null)).toBeNull();
  });

  it("every brief raises hazmat_check (v2.5: the hazard questions moved here); strata's timing raises the meeting date", () => {
    const strata = briefConfigFor(DEFAULT_SEGMENTS, "strata")!.brief;
    const a = { ...defaultBriefAnswers("strata", strata), answers: { ...defaultBriefAnswers("strata", strata).answers, Timing: "Before the next meeting" }, date: "2026-10-05" };
    const items = checklistFromBrief(strata, a);
    expect(items).toEqual(expect.arrayContaining([{ key: "hazmat_check", value: null }, { key: "meeting_date", value: "2026-10-05" }]));
    expect(items).toHaveLength(2);
    // No date given: the timing answer still raises the key, without a date.
    const noDate = checklistFromBrief(strata, { ...a, date: null });
    expect(noDate.find((i) => i.key === "meeting_date")?.value).toBe("Before the next meeting");
    // "No rush" raises nothing beyond the hazmat check.
    expect(checklistFromBrief(strata, { ...a, date: null, answers: { ...a.answers, Timing: "No rush" } })).toEqual([{ key: "hazmat_check", value: null }]);
  });

  it("a shop front in a centre raises centre_rules; a hospital raises induction and low odour", () => {
    const shop = briefConfigFor(DEFAULT_SEGMENTS, "shopfront")!.brief;
    const centre = checklistFromBrief(shop, { ...defaultBriefAnswers("shopfront", shop), answers: { "Where is it?": "Shopping centre" } });
    expect(centre.map((i) => i.key)).toEqual(["hazmat_check", "centre_rules"]);
    const strip = checklistFromBrief(shop, { ...defaultBriefAnswers("shopfront", shop), answers: { "Where is it?": "Strip shop" } });
    expect(strip.map((i) => i.key)).toEqual(["hazmat_check"]);
    const hospital = briefConfigFor(DEFAULT_SEGMENTS, "hospital")!.brief;
    expect(checklistFromBrief(hospital, defaultBriefAnswers("hospital", hospital)).map((i) => i.key)).toEqual(["hazmat_check", "induction", "low_odour"]);
  });

  it("every checklist key the configs name is one the table accepts", () => {
    const allowed = new Set(["induction", "swms", "wwcc", "police_check", "security", "loading_dock", "centre_rules", "coc_required", "meeting_date", "hazmat_check", "low_odour"]);
    for (const s of DEFAULT_SEGMENTS) {
      if (!s.brief) continue;
      for (const k of s.brief.checklist?.always ?? []) expect(allowed.has(k), `${s.key}: ${k}`).toBe(true);
      for (const byOpt of Object.values(s.brief.checklist?.rows ?? {})) for (const k of Object.values(byOpt)) expect(allowed.has(k), `${s.key}: ${k}`).toBe(true);
      if (s.brief.date) expect(allowed.has(s.brief.date.key)).toBe(true);
    }
  });

  it("defaults pick the first tile and the first option of every row — the prototype's pre-selection", () => {
    const strata = briefConfigFor(DEFAULT_SEGMENTS, "strata")!.brief;
    const d = defaultBriefAnswers("strata", strata);
    expect(d.what).toEqual(["Lobbies and corridors"]);
    expect(d.answers["Levels"]).toBe("1–3");
    expect(d.date).toBeNull();
  });
});

describe("the contract", () => {
  it("accepts a booking with or without a slot, and rejects a bad date or email", () => {
    const ok = briefBookSchema.safeParse({ email: "a@b.co", brief: { segment: "strata", briefKey: "strata", what: ["Lobbies"], answers: { Levels: "1–3" }, date: "2026-10-05" } });
    expect(ok.success).toBe(true);
    expect(ok.success && ok.data.screen).toBe("com_book");
    expect(briefBookSchema.safeParse({ email: "nope", brief: { segment: "strata", briefKey: "strata" } }).success).toBe(false);
    expect(briefBookSchema.safeParse({ email: "a@b.co", brief: { segment: "strata", briefKey: "strata", date: "5/10/2026" } }).success).toBe(false);
  });

  it("titles the estimate from the street, else the suburb, else the segment", () => {
    expect(briefTitle({ address: { street: "12 Acacia St" } }, "Strata")).toBe("12 Acacia St");
    expect(briefTitle({ address: null, customer: { suburb: "Northcote", postcode: "3070" } }, "Strata")).toBe("Northcote 3070");
    expect(briefTitle(null, "Strata or common property")).toBe("Strata or common property — brief");
  });

  it("words the outcome and the email without a number in them", () => {
    expect(briefOutcomeNote("Mon 14 Sep · 9:00", "strata")).toBe("Booked: Mon 14 Sep · 9:00 (brief: strata)");
    expect(briefOutcomeNote(undefined, "exterior")).toBe("Call me back (brief: exterior)");
    expect(briefEmailIntro("Mon 14 Sep · 9:00", "Strata or common property")).toMatch(/We've got you down for Mon 14 Sep/);
    expect(briefEmailIntro(undefined, "Shop front")).toMatch(/within one working day/);
    expect(briefEmailIntro(undefined, "Shop front")).not.toMatch(/\$\d/);
  });
});
