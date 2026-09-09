import { describe, expect, it } from "vitest";
import {
  ALWAYS_APPOINTMENT, COMMERCIAL_GATES, COMMERCIAL_SEGMENTS, SEGMENT_LABEL,
  gateMessage, routeCommercial, type GateAnswers,
} from "./commercial";
import { guardrailWhy } from "./policy";

/** Every gate answered "no" — the only way a job prices online. */
const allNo: GateAnswers = Object.fromEntries(COMMERCIAL_GATES.map((g) => [g.key, "no"]));

describe("any single gate sends it to an appointment", () => {
  it("prices online only when every gate is a no", () => {
    const r = routeCommercial("office", allNo);
    expect(r.canPriceOnline).toBe(true);
    expect(r.tripped).toEqual([]);
    expect(r.complete).toBe(true);
  });

  /** No scoring, no override — one yes is enough, whichever it is. */
  it("closes on any one gate, on its own", () => {
    for (const g of COMMERCIAL_GATES) {
      const r = routeCommercial("office", { ...allNo, [g.key]: "yes" });
      expect(r.canPriceOnline, g.key).toBe(false);
      expect(r.tripped, g.key).toEqual([g.key]);
      expect(r.reasons[0], g.key).toBe(g.needs);
    }
  });

  it("reports every gate that tripped, not just the first", () => {
    const r = routeCommercial("office", { ...allNo, height: "yes", hours: "yes", committee: "yes" });
    expect(r.tripped).toEqual(["height", "hours", "committee"]);
    expect(r.reasons).toHaveLength(3);
  });
});

describe("an unanswered gate is never a no", () => {
  /**
   * The brief's point is that we refuse to guess where the variables are
   * unbounded, and a blank is the least bounded answer there is.
   */
  it("cannot price online while a gate is unanswered", () => {
    const rest = { ...allNo };
    delete rest.height;
    const r = routeCommercial("office", rest);
    expect(r.canPriceOnline).toBe(false);
    expect(r.complete).toBe(false);
  });

  /** Unanswered is not the same as alarming — it says so differently. */
  it("does not call an unanswered gate 'tripped'", () => {
    const r = routeCommercial("office", {});
    expect(r.tripped).toEqual([]);
    expect(r.reasons.join(" ")).toMatch(/aren't answered yet/);
    expect(gateMessage(r)).toMatch(/Answer the few site questions/);
  });
});

describe("two segments trip before a question is asked", () => {
  it("sends healthcare and strata straight to a person", () => {
    for (const seg of ["healthcare", "strata"] as const) {
      const r = routeCommercial(seg, allNo);
      expect(r.canPriceOnline, seg).toBe(false);
      expect(r.tripped, seg).toContain(seg);
    }
    expect([...ALWAYS_APPOINTMENT].sort()).toEqual(["healthcare", "strata"]);
  });

  it("explains itself rather than saying 'we'll need to see it'", () => {
    expect(routeCommercial("healthcare", allNo).reasons[0]).toMatch(/infection control/);
    expect(routeCommercial("strata", allNo).reasons[0]).toMatch(/owners corporation/);
    expect(gateMessage(routeCommercial("strata", allNo))).toMatch(/a form can't price honestly/);
  });

  it("lets an office, shop front, industrial site or 'other' price online", () => {
    for (const seg of ["office", "shopfront", "industrial", "other"] as const) {
      expect(routeCommercial(seg, allNo).canPriceOnline, seg).toBe(true);
    }
  });
});

describe("before the segment is known", () => {
  it("prices nothing and says why", () => {
    const r = routeCommercial(null, allNo);
    expect(r.canPriceOnline).toBe(false);
    expect(r.complete).toBe(false);
    expect(r.reasons[0]).toMatch(/what sort of site/);
  });
});

describe("the questions are answerable by someone who has never let a job", () => {
  it("gives every gate a plain question and a worked example", () => {
    for (const g of COMMERCIAL_GATES) {
      expect(g.question.endsWith("?"), g.key).toBe(true);
      expect(g.hint.length, g.key).toBeGreaterThan(20);
      expect(g.needs.length, g.key).toBeGreaterThan(25);
      // No trade jargon in the QUESTION — it may appear in the hint's example.
      expect(g.question, g.key).not.toMatch(/SWMS|induction|mobilisation|EWP|swing stage/i);
    }
  });

  it("names every segment for a person", () => {
    for (const s of COMMERCIAL_SEGMENTS) expect(SEGMENT_LABEL[s].length).toBeGreaterThan(4);
  });
});

describe("no pricing lives here", () => {
  /**
   * The brief's first step is "routing, no pricing". The sector bands and the
   * per-segment caps need `commercial_rates` data this repo does not have, and
   * a number invented here would be exactly the guess the gate exists to refuse.
   */
  it("carries no dollar figure or multiplier in any customer-facing string", () => {
    const shown = [
      ...COMMERCIAL_GATES.map((g) => `${g.question} ${g.hint}`),
      ...Object.values(SEGMENT_LABEL),
      gateMessage(routeCommercial("office", {})),
      gateMessage(routeCommercial("strata", allNo)),
    ].join(" ");
    expect(shown).not.toMatch(/\$\d/);
  });
});

describe("every gate says why, in the customer's terms", () => {
  /**
   * The brief: "we'll need to see it" with no reason reads as a brush-off, and
   * a facilities manager who knows exactly why we're coming will trust us more
   * for saying it. A gate with no WHY line leaves the customer on the generic
   * handoff message — which is what shipped until an e2e caught it.
   */
  it("has a WHY line for every reason code the ladder can raise", () => {
    const codes = [
      ...COMMERCIAL_GATES.map((g) => `commercial_gate_${g.key}`),
      ...[...ALWAYS_APPOINTMENT].map((s) => `commercial_gate_${s}`),
      "commercial_gates_unanswered",
    ];
    for (const c of codes) {
      const why = guardrailWhy([c]);
      expect(why, c).toBeTruthy();
      expect(why!.length, c).toBeGreaterThan(40);
    }
  });
});
