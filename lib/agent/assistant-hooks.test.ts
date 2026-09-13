/**
 * C16 — the assistant hooks.
 *  (b) a plan-reader / brief proposal cannot change a confirmed (cyan) value
 *      — it lands beside it, amber, for the customer to take or leave.
 *  (c) the assistant asks the COMMERCIAL SEGMENT question and its answer
 *      routes through the same reasons the screen emits — never the older
 *      commercialKind fallback.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { heuristicExtract } from "./brief-extract";
import { proposeFromBrief } from "./propose";
import { emptyDoc } from "./scope-store";
import { applyAnswer, docAnswers, docBlocks, docFacts, isBuilt, segmentKeyFromAnswer, toWizardState, type ScopeDeps } from "./scope-doc";
import { gapsFor, segmentTileNames, type GraphInput } from "./question-graph";
import { answersFromState, evaluateGuardrails, DEFAULT_POLICY, type WizardPolicySettings } from "@/lib/wizard/policy";
import { DEFAULT_SEGMENTS } from "@/lib/wizard/segments";
import { routeCommercial } from "@/lib/wizard/commercial";
import { defaultWizardState, defaultCustomer } from "@/lib/wizard/state";
import { proposedOf } from "@/lib/wizard/proposals";
import type { TreeRefs } from "@/lib/wizard/build-tree";
import type { PricingContext } from "@/lib/pricing/estimate";

type Refs = TreeRefs & { rateItems: PricingContext["rateItems"] };
const refsFile = JSON.parse(readFileSync(new URL("./__fixtures__/scope-refs.json", import.meta.url), "utf8")) as Refs;
const golden = JSON.parse(readFileSync(new URL("../pricing/__fixtures__/golden-estimates.json", import.meta.url), "utf8")) as { reference: Pick<PricingContext, "products" | "modifiers" | "settings"> };
const refs: TreeRefs = { rules: refsFile.rules, aliases: refsFile.aliases, defectRates: refsFile.defectRates, typicals: refsFile.typicals };
const ctx: PricingContext = { rateItems: refsFile.rateItems, products: golden.reference.products, modifiers: golden.reference.modifiers, settings: golden.reference.settings };
const deps: ScopeDeps = { refs, ctx, actor: "customer" };

const INTAKE: Array<[string, unknown]> = [
  ["q.address", { suburb: "Kew", postcode: "3101" }], ["q.job_type", "interior"], ["q.property_type", "house"],
  ["q.property_flags", { builtPre1970: "no", heritageListed: "no", bodyCorporate: "no", asbestosSuspected: "no" }],
  ["q.email", "c16@example.com"], ["q.storeys", "single"],
];

function built() {
  let doc = emptyDoc("e1");
  for (const [k, v] of INTAKE) { const r = applyAnswer(doc, k, v, "customer_stated", deps); if (r.ok) doc = r.doc; }
  const brief = proposeFromBrief(doc, heuristicExtract("3 bedroom house, walls and ceilings throughout, one living room"), deps, { mode: "guided", gateCents: 15_000 });
  if (!brief.ok) throw new Error(brief.reason);
  return brief.working;
}

describe("(b) a proposal never overwrites a confirmation", () => {
  it("a stated size lands on an unconfirmed room as amber, and beside a confirmed room as a pending proposal", () => {
    const doc = built();
    expect(isBuilt(doc)).toBe(true);
    const living = docBlocks(doc).find((b) => String(b.roomType) === "living");
    expect(living, "the brief built a living room").toBeTruthy();
    // The customer confirmed the living room's size (cyan).
    const confirmed = {
      ...doc,
      builderState: { ...doc.builderState, blocks: docBlocks(doc).map((b) => (Number(b.id) === Number(living!.id) ? { ...b, origin: "customer_stated", confidence: 0.85, assumedFields: [] } : b)) },
    };
    const again = proposeFromBrief(confirmed, heuristicExtract("the living room is 6 by 4.5 metres"), deps, { mode: "guided", gateCents: 15_000 });
    expect(again.ok).toBe(true);
    if (!again.ok) return;
    const after = docBlocks(again.working).find((b) => Number(b.id) === Number(living!.id))!;
    expect(after.L).toBe(living!.L);           // unchanged
    expect(after.W).toBe(living!.W);
    expect(after.origin).toBe("customer_stated");
    const p = proposedOf(after as { proposed?: unknown });
    expect(p?.L).toBe(6);
    expect(p?.W).toBe(4.5);
    expect(p?.origin).toBe("ai_extracted");
  });
});

describe("(c) the assistant asks the segment question", () => {
  const policy: WizardPolicySettings = DEFAULT_POLICY;
  const graphInput = (customer: Partial<ReturnType<typeof defaultCustomer>>): GraphInput => ({
    mode: "guided", state: { ...defaultWizardState(), mode: "customer", customer: { ...defaultCustomer(), ...customer } },
    blocks: [], scopeRules: refs.rules, rateCodes: new Set<string>(), facts: { inServiceArea: true, email: "c@example.com", timing: "soon" }, accountType: "residential",
    interior: null, sides: null,
  } as unknown as GraphInput);

  it("is asked for a commercial place with no segment, and not otherwise", () => {
    const keys = (c: Partial<ReturnType<typeof defaultCustomer>>) => gapsFor(graphInput(c)).map((g) => g.key);
    expect(keys({ propertyKind: "commercial" })).toContain("q.commercial_segment");
    expect(keys({ propertyKind: "commercial", commercialSegment: "office" })).not.toContain("q.commercial_segment");
    expect(keys({ propertyKind: "house" })).not.toContain("q.commercial_segment");
    expect(segmentTileNames()).toContain("office");
  });

  it("takes the key, the name, or the customer's word for it", () => {
    expect(segmentKeyFromAnswer("office")).toBe("office");
    expect(segmentKeyFromAnswer("Strata or common property")).toBe("strata");
    expect(segmentKeyFromAnswer("it's a couple of offices")).toBe("office");
    expect(segmentKeyFromAnswer("a little café")).toBe("retail");
    expect(segmentKeyFromAnswer("")).toBeNull();
    expect(segmentKeyFromAnswer("a spaceship")).toBeNull();
  });

  it("emits the SAME routing reasons as the screen — a range segment and a brief segment", () => {
    for (const [answer, key] of [["offices", "office"], ["strata", "strata"]] as const) {
      let doc = emptyDoc("e2");
      for (const [k, v] of [["q.address", { suburb: "Kew", postcode: "3101" }], ["q.job_type", "interior"], ["q.property_type", "commercial"], ["q.commercial_segment", answer]] as Array<[string, unknown]>) {
        const r = applyAnswer(doc, k, v, "customer_stated", deps);
        expect(r.ok, k).toBe(true);
        if (r.ok) doc = r.doc;
      }
      // The assistant's answer lands on the SCREEN's own field (customer.commercialSegment)…
      const answered = docAnswers(doc).customer;
      expect(answered?.propertyKind).toBe("commercial");
      expect(answered?.commercialSegment).toBe(key);
      // …and the build's state mapping carries it (the same function tryBuild uses).
      const flags = { heritageListed: "no" as const, bodyCorporate: "no" as const, builtPre1970: "no" as const, asbestosSuspected: "no" as const };
      const mapped = toWizardState(
        { ...docAnswers(doc), customer: { ...answered, ...flags, email: "c16@example.com" }, basics: { bedrooms: 1, storeys: "single" }, condition: { tier: "change" }, details: { damageTier: 1 } },
        { ...docFacts(doc), email: "c16@example.com" },
      );
      expect(mapped, "the build's state mapping accepts the answers").not.toBeNull();
      expect(mapped?.customer?.commercialSegment).toBe(key);
      // The screen: the same state built by taps — identical routing reasons.
      const viaScreen = { ...defaultWizardState(), mode: "customer" as const, customer: { ...defaultCustomer(), propertyKind: "commercial" as const, commercialSegment: key } };
      const a1 = answersFromState({ ...viaScreen, customer: { ...viaScreen.customer, ...answered } }, DEFAULT_SEGMENTS);
      const a2 = answersFromState(viaScreen, DEFAULT_SEGMENTS);
      const d1 = evaluateGuardrails(a1, 800_000, 95, false, policy);
      const d2 = evaluateGuardrails(a2, 800_000, 95, false, policy);
      expect(d1.reasons).toEqual(d2.reasons);
      const expected = routeCommercial(key, { jobType: "interior" }).route === "range" ? "commercial_range" : "commercial_brief";
      expect(d1.reasons).toContain(expected);
      expect(d1.reasons).not.toContain("commercial_property");
    }
  });
});
