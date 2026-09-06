import { readFileSync } from "node:fs";
import { test } from "vitest";
import assert from "node:assert/strict";
import { emptyDoc } from "./scope-store";
import { applyAnswer, docAnswers, type ScopeDeps } from "./scope-doc";
import type { TreeRefs } from "@/lib/wizard/build-tree";
import type { PricingContext } from "@/lib/pricing/estimate";

/**
 * Phase 4 (6 Sep plan): the address the assistant refused — "14 Murrumbeena
 * Rd, Murrumbeena 3163", typed as one line — is an answer. The structured
 * form still works; a line with neither suburb nor postcode is still refused.
 */
type Refs = TreeRefs & { rateItems: PricingContext["rateItems"] };
const refsFile = JSON.parse(readFileSync(new URL("./__fixtures__/scope-refs.json", import.meta.url), "utf8")) as Refs;
const golden = JSON.parse(readFileSync(new URL("../pricing/__fixtures__/golden-estimates.json", import.meta.url), "utf8")) as {
  reference: { products: PricingContext["products"]; modifiers: PricingContext["modifiers"]; settings: PricingContext["settings"] };
};
const refs: TreeRefs = { rules: refsFile.rules, aliases: refsFile.aliases, defectRates: refsFile.defectRates, typicals: refsFile.typicals };
const ctx: PricingContext = { rateItems: refsFile.rateItems, products: golden.reference.products, modifiers: golden.reference.modifiers, settings: golden.reference.settings };
const deps: ScopeDeps = { refs, ctx, actor: "customer" };

test("a typed address line records street, suburb and postcode", () => {
  const r = applyAnswer(emptyDoc("e1", "residential"), "q.address", "14 Murrumbeena Rd, Murrumbeena 3163", "customer_stated", deps);
  assert.equal(r.ok, true);
  if (!r.ok) return;
  const a = docAnswers(r.doc);
  assert.equal(a.address?.suburb, "Murrumbeena");
  assert.equal(a.address?.postcode, "3163");
  assert.equal(a.address?.street, "14 Murrumbeena Rd");
  assert.equal(a.customer?.suburb, "Murrumbeena");
});

test("the structured form still works, and a line with no suburb or postcode is refused in plain words", () => {
  const ok = applyAnswer(emptyDoc("e2", "residential"), "q.address", { street: "9 Elm St", suburb: "Bentleigh", postcode: "3204" }, "customer_stated", deps);
  assert.equal(ok.ok, true);
  const bad = applyAnswer(emptyDoc("e3", "residential"), "q.address", "the house near the station", "customer_stated", deps);
  assert.equal(bad.ok, false);
  if (!bad.ok) assert.match(bad.reason, /suburb or postcode/);
});
