import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { StubModel, parseAnswerMarker, withAnswerMarker } from "./model-stub";
import { ScopeTools } from "./scope-tools";
import { MemoryScopeStore, emptyDoc } from "./scope-store";
import { NoopTools } from "./noop";
import { DEFAULT_AGENT_SETTINGS, type AgentSettings } from "./settings";
import { MemoryAgentStore } from "./store";
import { assistantNumbersTraceable, runTurn } from "./turn";
import { isBuilt } from "./scope-doc";
import type { TreeRefs } from "@/lib/wizard/build-tree";
import type { PricingContext } from "@/lib/pricing/estimate";

type Refs = TreeRefs & { rateItems: PricingContext["rateItems"] };
const refsFile = JSON.parse(readFileSync(new URL("./__fixtures__/scope-refs.json", import.meta.url), "utf8")) as Refs;
const golden = JSON.parse(readFileSync(new URL("../pricing/__fixtures__/golden-estimates.json", import.meta.url), "utf8")) as { reference: Pick<PricingContext, "products" | "modifiers" | "settings"> };
const refs: TreeRefs = { rules: refsFile.rules, aliases: refsFile.aliases, defectRates: refsFile.defectRates, typicals: refsFile.typicals };
const ctx: PricingContext = { rateItems: refsFile.rateItems, products: golden.reference.products, modifiers: golden.reference.modifiers, settings: golden.reference.settings };

const settings: AgentSettings = { ...DEFAULT_AGENT_SETTINGS, hardStopScripts: { lead_paint: "Because the paint is peeling on a pre-1970s home it may contain lead — this one goes to a site visit." } };

function harness(accountType: "residential" | "trade" = "residential") {
  const scope = new MemoryScopeStore({ refs, ctx });
  scope.seed(emptyDoc("est-1", accountType));
  const store = new MemoryAgentStore();
  const tools = new ScopeTools(scope, settings, new NoopTools(settings));
  const deps = { model: new StubModel(), tools, store, settings };
  return { scope, store, deps };
}

const ANSWERS: Record<string, unknown> = {
  "q.address": { street: "12 Test St", suburb: "Kew", postcode: "3101" },
  "q.account_type": "residential", "q.property_type": "house",
  "q.property_flags": { builtPre1970: "no", heritageListed: "no", bodyCorporate: "no", asbestosSuspected: "no" },
  "q.storeys": "single", "q.timing": "soon", "q.email": "stub@example.com",
  "job.surfaces": ["walls", "ceilings", "skirting"], "condition.tier": "fresh", "condition.damage": 0,
  rooms: { bedrooms: 1, openPlanKitchenLiving: false }, occupied: false, "paint.brand": ["dulux"], "paint.colours": "known",
  door_style: "flat", window_style: "casement", ceiling_height: "2.4",
  "ext.photos": "none", "ext.substrates": ["weatherboards"], "ext.painting": { body: true, windowsDoors: true, roofline: true, garage: false },
  "ext.access": [], "ext.freestanding": "none",
};
const generic = (key: string): unknown => {
  if (key in ANSWERS) return ANSWERS[key];
  if (/^room\.\d+\.size$/.test(key) || /^side\.\w+\.size$/.test(key)) return "looks_right";
  if (/^room\.\d+\.(cupboards|cupboard_interiors)$/.test(key)) return false;
  if (/^room\.\d+\.anything_else$/.test(key)) return "no";
  if (/^room\.\d+\.(surfaces|confirm)$/.test(key) || /^side\.\w+\.confirm$/.test(key)) return true;
  if (/dw_totals$/.test(key)) return true;
  if (/^sweep\.(missed_rooms|ext_missed)$/.test(key)) return "none";
  if (/^side\.\w+\.include$/.test(key)) return true;
  if (key === "ext.cond_card") return { cond: "good", rot: "no", acc: "none" };
  return ANSWERS[key];
};

/** Drive: read the gap the assistant asked (from the last next_gap call), answer it as a tap. */
async function drive(h: ReturnType<typeof harness>, convId: string, first: { key: string; value: unknown }, stopAt?: (k: string) => boolean) {
  let answer: { key: string; value: unknown } | null = first;
  const asked: string[] = [];
  let lastText = "";
  let lastCalls = "";
  for (let i = 0; i < 120; i++) {
    const r = await runTurn(h.deps, { conversationId: convId, text: "", actor: "user", answer });
    lastText = r.text;
    lastCalls = r.toolCalls.map((c) => `${c.tool}:${c.status}${c.status !== "ok" ? "(" + JSON.stringify(c.result).slice(0, 160) + ")" : ""}`).join(", ");
    const gapCall = [...r.toolCalls].reverse().find((c) => c.tool === "next_gap" && c.status === "ok");
    const gap = gapCall ? ((gapCall.result as { data?: { gap?: { key: string } | null } }).data?.gap ?? null) : null;
    if (!gap) return { asked, lastText, result: r };
    if (stopAt?.(gap.key)) return { asked, lastText, result: r, stoppedAt: gap.key };
    const value = generic(gap.key);
    if (value === undefined) throw new Error(`no scripted answer for ${gap.key}`);
    asked.push(gap.key);
    answer = { key: gap.key, value };
  }
  throw new Error(`did not finish — last asked: ${asked.slice(-6).join(" → ")} · last calls: ${lastCalls} · said: ${lastText.slice(0, 160)}`);
}

describe("the answer marker", () => {
  it("round-trips a tap", () => {
    const m = withAnswerMarker("Sure", { key: "q.job_type", value: "interior" });
    expect(parseAnswerMarker(m)).toEqual({ key: "q.job_type", value: "interior", text: "Sure" });
    expect(parseAnswerMarker("plain text")).toBeNull();
  });
});

describe("guided mode end to end with the stub model and the real tools", () => {
  it("a 1-bed freshen-up walks the graph in order, prices, and can self-serve", async () => {
    const h = harness();
    const conv = await h.store.createConversation({ accountId: null, propertyId: null, estimateId: "est-1", channel: "portal", mode: "guided", view: "customer", createdBy: "u", anonToken: null, externalThreadId: null });
    const { asked, lastText } = await drive(h, conv.id, { key: "q.job_type", value: "interior" });
    expect(asked[0]).toMatch(/^q\./);
    expect(asked.indexOf("rooms")).toBeGreaterThan(asked.indexOf("q.email"));
    expect(asked.some((k) => k.startsWith("room."))).toBe(true);
    expect(isBuilt((await h.scope.load("est-1"))!)).toBe(true);
    expect(lastText).toMatch(/\$[\d,]+ – \$[\d,]+/);
    expect(lastText).toMatch(/accept it online|visit|settled/i);
    expect(assistantNumbersTraceable(await h.store.listMessages(conv.id), await h.store.listToolCalls(conv.id))).toBe(true);
  });

  it("a trade account hears a range from the first price", async () => {
    const h = harness("trade");
    const conv = await h.store.createConversation({ accountId: null, propertyId: null, estimateId: "est-1", channel: "portal", mode: "guided", view: "customer", createdBy: "u", anonToken: null, externalThreadId: null });
    const { result } = await drive(h, conv.id, { key: "q.job_type", value: "interior" }, (k) => k.startsWith("room."));
    const price = [...result.toolCalls].reverse().find((c) => c.tool === "price_scope")!.result as { data: { showNumber: boolean } };
    expect(price.data.showNumber).toBe(true);
  });

  it("pre-1970 + peeling on an exterior job: the lead script is the whole reply", async () => {
    const h = harness();
    const conv = await h.store.createConversation({ accountId: null, propertyId: null, estimateId: "est-1", channel: "portal", mode: "guided", view: "customer", createdBy: "u", anonToken: null, externalThreadId: null });
    const script: Record<string, unknown> = { ...ANSWERS, "q.property_flags": { builtPre1970: "yes", heritageListed: "no", bodyCorporate: "no", asbestosSuspected: "no" } };
    let answer: { key: string; value: unknown } | null = { key: "q.job_type", value: "exterior" };
    let text = "";
    for (let i = 0; i < 30; i++) {
      const r = await runTurn(h.deps, { conversationId: conv.id, text: "", actor: "user", answer });
      text = r.text;
      if (r.toolCalls.some((c) => c.tool === "hard_stop")) break;
      const gapCall = [...r.toolCalls].reverse().find((c) => c.tool === "next_gap")!;
      const gap = (gapCall.result as { data: { gap: { key: string } | null } }).data.gap!;
      const v = gap.key === "ext.condition" ? "peeling" : script[gap.key] ?? generic(gap.key);
      answer = { key: gap.key, value: v };
    }
    expect(text).toBe(settings.hardStopScripts.lead_paint);
    expect((await h.scope.load("est-1"))!.requiresSiteCheck).toBe(true);
    // D16: delivered once — the next turn carries on with the sides loop.
    const next = await runTurn(h.deps, { conversationId: conv.id, text: "ok", actor: "user" });
    expect(next.toolCalls.map((c) => c.tool)).not.toContain("hard_stop");
    const gapCall = [...next.toolCalls].reverse().find((c) => c.tool === "next_gap")!;
    expect((gapCall.result as { data: { gap: { key: string } | null } }).data.gap?.key).toMatch(/^side\./);
  });

  it("free text without a tap gets an honest nudge, never a guess", async () => {
    const h = harness();
    const conv = await h.store.createConversation({ accountId: null, propertyId: null, estimateId: "est-1", channel: "portal", mode: "guided", view: "customer", createdBy: "u", anonToken: null, externalThreadId: null });
    const r = await runTurn(h.deps, { conversationId: conv.id, text: "it's a three bedder in Kew", actor: "user" });
    expect(r.text).toContain("Tap an option");
    expect(r.toolCalls.map((c) => c.tool)).not.toContain("answer_gap");
  });
});
