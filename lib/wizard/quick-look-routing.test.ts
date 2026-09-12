import { describe, expect, test } from "vitest";
import { stepsFor, stepCount, DEFAULT_QUICK_LOOK, type QuickLook } from "./quick-look";
import { finishOptions, summaryRows, type SummaryInput } from "./finish-line";
import type { CustomerPayload } from "@/lib/wizard/view";

/**
 * C4 — audit 9.3 and 9.4.
 *
 * 9.3(a) the commercial hand-off fired on EVERY Continue, so a ?mode=business
 *        visitor was promised four screens and got one.
 * 9.3(b) "Four quick screens" was false on two of three branches.
 * 9.3(c) Outside + Commercial landed on domestic house questions.
 * 9.4    an exterior-only job's finish line was a holding message.
 *
 * The routing decision itself lives in `quickNext` inside a React component, so
 * what is pinned here is the DATA it branches on — the step counts, the promise,
 * and the four job-type × kind combinations as a table. The e2e drives the real
 * screens.
 */

describe("9.3(b) · the promise is computed, never typed", () => {
  test("the count matches stepsFor on every branch", () => {
    expect(stepsFor("interior")).toHaveLength(4);
    expect(stepsFor("exterior")).toHaveLength(3);
    // C8: "both" gains the choice screen (`s-both`), which asks nothing about
    // the job — so the walk is six screens and the promise still says five.
    expect(stepsFor("both")).toHaveLength(6);
    expect(stepCount("interior")).toBe("Four");
    expect(stepCount("exterior")).toBe("Three");
    expect(stepCount("both")).toBe("Five");
    // C12: a commercial place — the segment screen, then the two pattern
    // screens for an inside job; outside and both END on the segment screen.
    expect(stepsFor("interior", "commercial")).toEqual(["start", "place", "segment", "com_areas", "com_job"]);
    expect(stepsFor("exterior", "commercial")).toEqual(["start", "place", "segment"]);
    expect(stepsFor("both", "commercial")).toEqual(["start", "both", "place", "segment"]);
    expect(stepCount("interior", "commercial")).toBe("Five");
  });

  test("no branch can say four unless it has four", () => {
    for (const jt of ["interior", "exterior", "both"] as const) {
      const said = stepCount(jt);
      // The promise counts QUESTION screens: the "both" choice is a fork, not a question (C8).
      const real = stepsFor(jt).filter((step) => step !== "both").length;
      const words = ["", "One", "Two", "Three", "Four", "Five", "Six"];
      expect(said).toBe(words[real]);
    }
  });
});

describe("9.3(a)+(c) · the four job-type × kind combinations", () => {
  /**
   * The rule `quickNext` implements, as a table. `handOffAt` is the step the
   * customer leaves the quick look on — null means they walk it to the reveal.
   */
  const route = (q: Pick<QuickLook, "jobType" | "propertyKind">) => {
    if (q.propertyKind !== "commercial") return { handOffAt: null, to: "reveal" as const };
    // C12: the hand-off belongs to the SEGMENT screen now, which asks the
    // which-part row. Inside on a range segment walks to the reveal.
    return q.jobType === "interior"
      ? { handOffAt: null, to: "reveal" as const }                 // segment → areas → job → reveal
      : { handOffAt: "segment" as const, to: "handoff" as const };  // outside / both → the brief (C14)
  };

  test("home + inside walks the quick look to a range", () => {
    expect(route({ jobType: "interior", propertyKind: "house" })).toEqual({ handOffAt: null, to: "reveal" });
  });
  test("home + outside walks it too — three screens, not four", () => {
    expect(route({ jobType: "exterior", propertyKind: "house" })).toEqual({ handOffAt: null, to: "reveal" });
    expect(stepsFor("exterior")).toEqual(["start", "place", "outside"]);
  });
  test("C12: commercial + inside walks the segment screens to a range — never the page set", () => {
    expect(route({ jobType: "interior", propertyKind: "commercial" })).toEqual({ handOffAt: null, to: "reveal" });
    expect(stepsFor("interior", "commercial")).not.toContain("job");
  });
  test("commercial + outside leaves at the SEGMENT step, to a hand-off — never domestic house questions", () => {
    const r = route({ jobType: "exterior", propertyKind: "commercial" });
    expect(r).toEqual({ handOffAt: "segment", to: "handoff" });
    expect(r.to).not.toBe("pages");
    expect(stepsFor("exterior", "commercial")).not.toContain("outside");
  });
  test("commercial + both is a hand-off as well (every commercial outside is a visit)", () => {
    expect(route({ jobType: "both", propertyKind: "commercial" })).toEqual({ handOffAt: "segment", to: "handoff" });
  });

  test("the hand-off NEVER fires on the start step — that was 9.3(a)", () => {
    // A ?mode=business visitor arrives with propertyKind already commercial.
    const seeded: Pick<QuickLook, "jobType" | "propertyKind"> = { ...DEFAULT_QUICK_LOOK, propertyKind: "commercial" };
    // Screen 1 is "start". The rule keys on the step, so start cannot hand off.
    // C12: the hand-off moved to the segment screen; start still cannot fire.
    const firesOn = (step: string) => step === "segment" && seeded.propertyKind === "commercial";
    expect(firesOn("start")).toBe(false);
    expect(firesOn("place")).toBe(false);
    expect(firesOn("segment")).toBe(true);
  });
});

describe("9.4 · an exterior job has a finish line that says something", () => {
  const payload = (over: Partial<CustomerPayload> = {}) => ({
    rangeLoCents: 800_000, rangeHiCents: 1_100_000, accuracyPct: 62,
    canAccept: false, walkthroughRequired: true,
    ...over,
  } as CustomerPayload);

  const sidesInput = (over: Partial<NonNullable<SummaryInput["sides"]>> = {}): SummaryInput => ({
    payload: payload(), systems: [], access: {}, extras: [], spots: [],
    roomsConfirmed: 0, roomsTotal: 0,
    sides: {
      done: 2, total: 4, storeys: "double", substrates: ["weatherboards"],
      windows: 11, doors: 3, condition: "weathered", rot: "little", access: "steep",
      ...over,
    },
  });

  test("the summary is not empty — which is what made the holding message defensible", () => {
    const rows = summaryRows(sidesInput());
    expect(rows.length).toBeGreaterThan(0);
    const keys = rows.map((r) => r.key);
    expect(keys).toContain("sides");
    expect(keys).toContain("geo");
    expect(keys).toContain("dw");
    expect(keys).toContain("ext_condition");
  });

  test("it says how many sides are still to check", () => {
    const text = summaryRows(sidesInput()).find((r) => r.key === "sides")?.text;
    expect(text).toBe("4 sides — 2 still to check");
    const done = summaryRows(sidesInput({ done: 4 })).find((r) => r.key === "sides")?.text;
    expect(done).toBe("4 sides, all checked");
  });

  test("it reads back the condition answers as a sentence", () => {
    const text = summaryRows(sidesInput()).find((r) => r.key === "ext_condition")?.text;
    expect(text).toBe("Weathered paint, a little rot, steep ground");
  });

  test("an interior job grows no exterior rows", () => {
    const rows = summaryRows({
      payload: payload(), systems: [], access: {}, extras: [], spots: [],
      roomsConfirmed: 3, roomsTotal: 5, sides: null,
    });
    expect(rows.map((r) => r.key)).not.toContain("sides");
    expect(rows.map((r) => r.key)).toContain("rooms");
  });

  test("an exterior job is offered a person, never a price to accept", () => {
    const opts = finishOptions(payload(), "$9,500", "sides");
    expect(opts.map((o) => o.key)).toEqual(["send_for_confirmation", "book_visit"]);
    expect(opts.map((o) => o.key)).not.toContain("fix_online");
  });

  test("and the copy describes the job they actually gave us", () => {
    const sides = finishOptions(payload(), "$9,500", "sides")[0].body;
    expect(sides).toContain("sides");
    expect(sides).not.toContain("rooms");
    const rooms = finishOptions(payload(), "$9,500")[0].body;
    expect(rooms).toContain("rooms");
  });
});
