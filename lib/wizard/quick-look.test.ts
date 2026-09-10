import { describe, expect, it } from "vitest";
import {
  CONDITION_BANDS, COLOUR_INTENTS, DEFAULT_QUICK_LOOK, SCOPE_PRESETS,
  assumedList, quickLookToState, restatement, stepsFor, type QuickLook,
} from "./quick-look";
import { defaultWizardState, wizardStateSchema } from "./state";
import { answersFromState, evaluateGuardrails } from "./policy";

const q = (over: Partial<QuickLook> = {}): QuickLook => ({ ...DEFAULT_QUICK_LOOK, ...over });

/**
 * The plan's first target (§1): under a minute, under ten taps. If the quick
 * look cannot produce a state the engine will price, none of the rest matters.
 */
describe("the quick look produces a priceable job", () => {
  it("passes the full submit schema on defaults alone", () => {
    const state = quickLookToState(q(), { ...defaultWizardState(), mode: "customer" });
    const parsed = wizardStateSchema.safeParse({
      ...state,
      customer: { ...state.customer!, suburb: "Murrumbeena", postcode: "3163" },
      contact: { ...state.contact, name: "A Customer", email: "a@example.com", phone: "0400 000 000" },
    });
    expect(parsed.success, JSON.stringify(parsed.success ? {} : parsed.error.issues)).toBe(true);
  });

  it("takes the no-plan path, so the starter list builds the rooms", () => {
    const state = quickLookToState(q({ bedrooms: 4, storeys: "double" }));
    expect(state.noPlan).toBe(true);
    expect(state.basics?.bedrooms).toBe(4);
    expect(state.basics?.storeys).toBe("double");
  });

  it("clamps a silly bedroom count rather than failing the schema", () => {
    expect(quickLookToState(q({ bedrooms: 99 })).basics?.bedrooms).toBe(8);
    expect(quickLookToState(q({ bedrooms: 0 })).basics?.bedrooms).toBe(1);
  });
});

/**
 * ⚑ The safety question this whole design rests on: we stop asking four
 * hazard questions, so we must be certain that not asking them cannot produce
 * a confident price over an asbestos ceiling.
 */
describe("the questions we stopped asking", () => {
  it("leaves all four hazard answers at 'unsure', never at 'no'", () => {
    const c = quickLookToState(q()).customer!;
    expect(c.asbestosSuspected).toBe("unsure");
    expect(c.heritageListed).toBe("unsure");
    expect(c.bodyCorporate).toBe("unsure");
    expect(c.builtPre1970).toBe("unsure");
  });

  it("still reveals a range — an unasked question is not a dead end", () => {
    const state = quickLookToState(q(), { ...defaultWizardState(), mode: "customer" });
    state.customer!.postcode = "3163";
    const out = evaluateGuardrails(answersFromState(state), 900_000, 62, false);
    expect(out.outcome).toBe("reveal");
  });

  it("but never lets that job accept itself online", () => {
    const state = quickLookToState(q(), { ...defaultWizardState(), mode: "customer" });
    state.customer!.postcode = "3163";
    const out = evaluateGuardrails(answersFromState(state), 900_000, 62, false);
    // Soft flags: the price shows, a person still settles the hazards.
    expect(out.reasons).toContain("asbestos_unsure");
    expect(out.canAccept).toBe(false);
  });

  it("a definite yes from elsewhere still hard-stops", () => {
    const base = { ...defaultWizardState(), mode: "customer" as const };
    const state = quickLookToState(q(), base);
    state.customer!.postcode = "3163";
    state.customer!.asbestosSuspected = "yes";
    expect(evaluateGuardrails(answersFromState(state), 900_000, 62, false).outcome).toBe("hard_stop");
  });
});

describe("the eight answers map onto the engine's fields", () => {
  it("turns colour intent into the stored tier", () => {
    expect(quickLookToState(q({ colour: "same" })).condition.tier).toBe("fresh");
    expect(quickLookToState(q({ colour: "new" })).condition.tier).toBe("change");
    expect(quickLookToState(q({ colour: "bold" })).condition.tier).toBe("dark_to_light");
  });

  it("turns the three condition bands into damage tiers, never tier 3", () => {
    expect(quickLookToState(q({ condition: "good" })).details.damageTier).toBe(0);
    expect(quickLookToState(q({ condition: "wear" })).details.damageTier).toBe(1);
    // "Needs work" is 2 on purpose — tier 3 is earned by a photographed spot
    // in the tighten stage, not claimed from a chip.
    expect(quickLookToState(q({ condition: "needs_work" })).details.damageTier).toBe(2);
  });

  it("narrows the surfaces for the partial presets and not for 'some rooms'", () => {
    expect(quickLookToState(q({ scope: "walls_ceilings" })).surfaces).toEqual(["walls", "ceilings", "cornices"]);
    expect(quickLookToState(q({ scope: "trims_doors" })).surfaces).toEqual(["doors", "architraves", "skirting"]);
    // "Some rooms" is about ROOMS; ticking fewer surfaces would answer a
    // different question than the one they were asked.
    expect(quickLookToState(q({ scope: "some_rooms" })).surfaces)
      .toEqual(quickLookToState(q({ scope: "whole" })).surfaces);
  });

  it("leaves the three unanswerable details unsure", () => {
    const d = quickLookToState(q()).details;
    expect(d.doorStyle).toBe("unsure");
    expect(d.windowStyle).toBe("unsure");
    expect(d.ceilingHeight).toBe("unsure");
  });

  it("carries the occupied answer through to the staging modifier", () => {
    expect(quickLookToState(q({ occupied: "yes" })).details.occupied).toBe("yes");
  });
});

/**
 * Every seed-shaped function in this codebase has, at least once, thrown away
 * something the customer had already typed. This is the guard against it.
 */
describe("it replaces what it asked and nothing else", () => {
  it("keeps a typed address, a prefilled email and a resumed contact", () => {
    const base = defaultWizardState();
    base.address = { street: "14 Acacia St", suburb: "Northcote", state: "VIC", postcode: "3070", formatted: "14 Acacia Street, Northcote VIC 3070" };
    base.contact = { ...base.contact, name: "Tom", email: "tom@example.com", phone: "0400 111 222" };
    base.customer = { ...base.customer!, suburb: "Northcote", postcode: "3070" };
    const out = quickLookToState(q({ bedrooms: 2 }), base);
    expect(out.address?.formatted).toBe("14 Acacia Street, Northcote VIC 3070");
    expect(out.contact.email).toBe("tom@example.com");
    expect(out.customer?.suburb).toBe("Northcote");
    expect(out.basics?.bedrooms).toBe(2);
  });

  it("does not stamp over hazard answers a detailed page already settled", () => {
    const base = defaultWizardState();
    base.customer = { ...base.customer!, asbestosSuspected: "no", heritageListed: "no" };
    const out = quickLookToState(q(), base);
    expect(out.customer?.asbestosSuspected).toBe("no");
    expect(out.customer?.heritageListed).toBe("no");
  });
});

describe("what the customer reads back", () => {
  it("restates their own answers so a mis-tap is catchable", () => {
    const line = restatement(q({ bedrooms: 3, storeys: "single", propertyKind: "house", scope: "whole", colour: "new", condition: "wear" }));
    expect(line).toContain("3-bedroom");
    expect(line).toContain("single-storey house");
    expect(line).toContain("the whole interior");
    expect(line).toContain("new colours");
    expect(line).toContain("some wear");
  });

  it("names a unit a unit, not a unit_apartment", () => {
    expect(restatement(q({ propertyKind: "unit_apartment" }))).toContain("single-storey unit");
    expect(restatement(q({ propertyKind: "unit_apartment" }))).not.toContain("_");
  });

  it("lists every assumption with somewhere to go and change it", () => {
    const list = assumedList(q());
    expect(list.length).toBeGreaterThanOrEqual(5);
    for (const a of list) {
      expect(a.what.length, a.key).toBeGreaterThan(0);
      expect(a.why.length, a.key).toBeGreaterThan(0);
    }
    // The two we cannot fix from a screen must still be SAID, not hidden.
    expect(list.map((a) => a.key)).toContain("hazards");
    expect(list.map((a) => a.key)).toContain("excluded");
  });

  it("does not promise an interior assumption on an outside-only job", () => {
    const keys = assumedList(q({ jobType: "exterior" })).map((a) => a.key);
    expect(keys).not.toContain("systems");
    expect(keys).not.toContain("height");
  });
});

describe("the screens", () => {
  it("walks four for an inside job — no outside screen to answer", () => {
    expect(stepsFor("interior")).toEqual(["start", "place", "job", "condition"]);
  });

  it("sends an outside-only job to the exterior screen, skipping the rooms", () => {
    // No scope preset and no colour question: there are no rooms to apply them
    // to, and asking anyway is the toll §2 is about.
    expect(stepsFor("exterior")).toEqual(["start", "place", "outside"]);
  });

  it("walks a both job through the inside and then the outside", () => {
    expect(stepsFor("both")).toEqual(["start", "place", "job", "condition", "outside"]);
  });

  it("offers every choice with a label, and a hint where one is needed", () => {
    for (const c of [...SCOPE_PRESETS, ...COLOUR_INTENTS, ...CONDITION_BANDS]) {
      expect(c.label.length, c.value).toBeGreaterThan(0);
    }
  });
});
