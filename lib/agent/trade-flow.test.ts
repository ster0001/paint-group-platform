/**
 * Addendum A2 — the trade "write it, we build it" flow through the real
 * tools: the paragraph builds at once on the customer's own draft, the range
 * shows for trade (R4/D21) with every assumption a chip, each answer narrows
 * the list, the safety flags are an honest chip, and residential sees the
 * chips but no number until confirmed.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { ScopeTools, priceScope } from "./scope-tools";
import { MemoryScopeStore, emptyDoc } from "./scope-store";
import { NoopTools } from "./noop";
import { StubModel } from "./model-stub";
import { MemoryAgentStore } from "./store";
import { runTurn } from "./turn";
import { DEFAULT_AGENT_SETTINGS } from "./settings";
import { heuristicExtract } from "./brief-extract";
import { docFacts, docWizard, isBuilt, type ScopeDeps } from "./scope-doc";
import { gapsFor, nextGap } from "./question-graph";
import { graphInput } from "./scope-doc";
import type { TreeRefs } from "@/lib/wizard/build-tree";
import type { PricingContext } from "@/lib/pricing/estimate";

type Refs = TreeRefs & { rateItems: PricingContext["rateItems"] };
const refsFile = JSON.parse(readFileSync(new URL("./__fixtures__/scope-refs.json", import.meta.url), "utf8")) as Refs;
const golden = JSON.parse(readFileSync(new URL("../pricing/__fixtures__/golden-estimates.json", import.meta.url), "utf8")) as { reference: Pick<PricingContext, "products" | "modifiers" | "settings"> };
const refs: TreeRefs = { rules: refsFile.rules, aliases: refsFile.aliases, defectRates: refsFile.defectRates, typicals: refsFile.typicals };
const ctx: PricingContext = { rateItems: refsFile.rateItems, products: golden.reference.products, modifiers: golden.reference.modifiers, settings: golden.reference.settings };
const deps: ScopeDeps = { refs, ctx, actor: "customer" };
const settings = DEFAULT_AGENT_SETTINGS;
const TOM = "3 bedroom 1 bathroom house requires painting with a colour match throughout. The walls are in good condition with a few minor cracks to the kitchen area, all trims including windows, doors, frames and skirtings to be painted.";

function harness(accountType: "trade" | "residential") {
  const scope = new MemoryScopeStore({ refs, ctx });
  const doc = emptyDoc("est-1", accountType);
  (doc.builderState.agent as { facts: Record<string, unknown> }).facts.email = "client@example.com";
  scope.seed(doc);
  const store = new MemoryAgentStore();
  const tools = new ScopeTools(scope, settings, new NoopTools(settings), () => new Date(), async (text) => ({ ok: true, extraction: heuristicExtract(text) }));
  return { scope, store, deps: { model: new StubModel(), tools, store, settings } };
}
/** The wizard page's address rides with the brief (start route). */
async function withAddress(h: ReturnType<typeof harness>, c: { id: string }) {
  const r = await h.deps.tools.execute("answer_gap", { key: "q.address", value: { street: "12 Test St", suburb: "Kew", postcode: "3101" }, provenance: "customer_stated" }, { conversationId: c.id, mode: "guided", view: "customer", estimateId: "est-1", accountId: "acc" });
  if (r.status !== "ok") throw new Error("address");
}
const conv = (h: ReturnType<typeof harness>) => h.store.createConversation({ accountId: "acc", propertyId: null, estimateId: "est-1", channel: "portal", mode: "guided", view: "customer", createdBy: "u", anonToken: null, externalThreadId: null });

describe("A2 — the trade build flow", () => {
  it("the paragraph builds the tree on the first turn; trade sees a wide range with every assumption a chip", async () => {
    const h = harness("trade"); const c = await conv(h); await withAddress(h, c);
    const r = await runTurn(h.deps, { conversationId: c.id, text: TOM, actor: "user", heavy: true });
    expect(r.toolCalls.map((t) => t.tool)).toContain("propose_diff");
    const doc = (await h.scope.load("est-1"))!;
    expect(isBuilt(doc)).toBe(true);
    const price = priceScope(doc, deps);
    expect(price.showNumber).toBe(true);
    expect(price.bandPct).toBe(15);
    const keys = price.assumptions.map((a) => a.key);
    expect(keys).toEqual(expect.arrayContaining(["door_style", "window_style", "ceiling_height", "q.property_flags"]));
    expect(keys.some((k) => k.endsWith("cupboard_interiors"))).toBe(true);
    expect(docFacts(doc).flagsAssumed).toBe(true);
    // Chips = open tightening gaps, exactly (§5).
    const open = gapsFor(graphInput(doc, deps)).filter((g) => g.kind === "tightening").map((g) => g.key).sort();
    expect(keys.sort()).toEqual(open);
    // Largest swing first.
    const first = nextGap(graphInput(doc, deps, "guided", Object.fromEntries(price.assumptions.map((a) => [a.key, a.swingCents]))));
    expect(first?.kind).toBe("tightening");
  });

  it("each answer removes its chip; the safety flags are answerable after the build", async () => {
    const h = harness("trade"); const c = await conv(h); await withAddress(h, c);
    await runTurn(h.deps, { conversationId: c.id, text: TOM, actor: "user", heavy: true });
    const before = priceScope((await h.scope.load("est-1"))!, deps).assumptions.map((a) => a.key);
    for (const [key, value] of [["door_style", "panel"], ["window_style", "sash"], ["ceiling_height", "2.7"], ["q.property_flags", { builtPre1970: "no", heritageListed: "no", bodyCorporate: "no", asbestosSuspected: "no" }]] as Array<[string, unknown]>) {
      const r = await runTurn(h.deps, { conversationId: c.id, text: "", actor: "user", answer: { key, value } });
      expect(r.toolCalls.find((t) => t.tool === "answer_gap")?.status, key).toBe("ok");
    }
    const doc = (await h.scope.load("est-1"))!;
    const after = priceScope(doc, deps).assumptions.map((a) => a.key);
    for (const k of ["door_style", "window_style", "ceiling_height", "q.property_flags"]) { expect(before).toContain(k); expect(after).not.toContain(k); }
    expect(docWizard(doc)?.details.doorStyle).toBe("panel");
    expect(docFacts(doc).flagsAssumed).toBe(false);
  });

  it("photos on file satisfy the photo gap; residential sees chips but no number until confirmed and swept", async () => {
    const h = harness("residential"); const c = await conv(h); await withAddress(h, c);
    await runTurn(h.deps, { conversationId: c.id, text: TOM, actor: "user", heavy: true });
    let doc = (await h.scope.load("est-1"))!;
    let price = priceScope(doc, deps);
    expect(price.showNumber).toBe(false);
    expect(price.assumptions.map((a) => a.key)).toContain("condition.photos");
    doc = { ...doc, builderState: { ...doc.builderState, agent: { ...(doc.builderState.agent as object), facts: { ...docFacts(doc), photoCount: 1 } } } };
    await h.scope.save(doc);
    price = priceScope(doc, deps);
    expect(price.assumptions.map((a) => a.key)).not.toContain("condition.photos");
    // Walk the loop to the end: the number appears only then.
    for (let i = 0; i < 80; i++) {
      const g = nextGap(graphInput((await h.scope.load("est-1"))!, deps));
      if (!g) break;
      const k = g.key;
      const v = /\.size$/.test(k) ? "looks_right" : /cupboards$/.test(k) ? false : /cupboard_interiors$/.test(k) ? false : /anything_else$/.test(k) ? "no" : /\.(surfaces|confirm)$/.test(k) ? true : /dw_totals$/.test(k) ? true : /missed_rooms$/.test(k) ? "none" : k === "occupied" ? false : k === "paint.brand" ? ["dulux"] : k === "paint.colours" ? "advice" : k === "door_style" ? "flat" : k === "window_style" ? "casement" : k === "ceiling_height" ? "2.4" : k === "q.property_flags" ? { builtPre1970: "no", heritageListed: "no", bodyCorporate: "no", asbestosSuspected: "no" } : k === "q.timing" ? "soon" : null;
      if (v === null) throw new Error(`no answer for ${k}`);
      const r = await runTurn(h.deps, { conversationId: c.id, text: "", actor: "user", answer: { key: k, value: v } });
      expect(r.toolCalls.find((t) => t.tool === "answer_gap")?.status, k).toBe("ok");
    }
    const final = priceScope((await h.scope.load("est-1"))!, deps);
    expect(final.showNumber).toBe(true);
    expect(final.accuracyPct).toBeGreaterThanOrEqual(70);
    expect(final.bandPct).toBeLessThan(15);
  });
});
