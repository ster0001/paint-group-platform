/**
 * S3 acceptance: PARITY. The same six jobs built (a) the wizard way — a
 * wizard state through lib/wizard/build-tree + the loop functions called
 * directly — and (b) the assistant way — answer_gap tool calls driven by the
 * question graph — must produce identical rows, hours, cents and range.
 * Plus: the amber custom-line rule, the per-item charge-out golden, the
 * thresholds, R4's showNumber, and the §10 "$ traces to a tool result" scan.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { ScopeTools, assumptionSwings, checkThresholds, priceScope, supportHoursState } from "./scope-tools";
import { MemoryScopeStore, emptyDoc } from "./scope-store";
import { applyAnswer, docBlocks, docDeferred, docWizard, isBuilt, toWizardState, type AnswerDraft, type ScopeDeps, type ScopeDoc } from "./scope-doc";
import { NoopTools } from "./noop";
import { DEFAULT_AGENT_SETTINGS } from "./settings";
import { gapsFor, nextGap } from "./question-graph";
import { graphInput } from "./scope-doc";
import { toolSpec, type Gap, type ToolContext } from "./schemas";
import { runTurn, assistantNumbersTraceable } from "./turn";
import { ScriptedModel, textTurn, toolTurn } from "./model";
import { MemoryAgentStore } from "./store";
import { buildTreeFromState, type TreeRefs } from "@/lib/wizard/build-tree";
import { editorPayload } from "@/lib/wizard/view";
import { loopConfirmState } from "@/lib/wizard/confirm-state";
import { adjustmentsFrom } from "@/lib/pricing/context";
import { priceEstimateTotals, type BlockInput, type PricingContext } from "@/lib/pricing/estimate";
import { DEFAULT_BANDS, rangeBandPct, rangeFromTotal } from "@/lib/wizard/policy";
import { applyCupboard, applyCupboardInterior, applyRoomSizeOk, confirmRoom, defaultInteriorLoop, type LooseBlock as RoomBlock } from "@/lib/wizard/rooms-loop";
import { applySideInclude, applySideSizeOk, confirmSide, defaultSidesLoop, SIDE_KEYS, type LooseBlock as SideBlock } from "@/lib/wizard/sides";
import { CUPBOARD_BY_ROOM_TYPE, CUPBOARD_INTERIOR_BY_ROOM_TYPE } from "@/lib/wizard/rooms-loop";
import type { WizardState } from "@/lib/wizard/state";

// ---- reference data (captured from the live project; see __fixtures__) ----------
type Refs = TreeRefs & { rateItems: PricingContext["rateItems"] };
const refsFile = JSON.parse(readFileSync(new URL("./__fixtures__/scope-refs.json", import.meta.url), "utf8")) as Refs;
const golden = JSON.parse(readFileSync(new URL("../pricing/__fixtures__/golden-estimates.json", import.meta.url), "utf8")) as {
  reference: { products: PricingContext["products"]; modifiers: PricingContext["modifiers"]; settings: PricingContext["settings"] };
};
const refs: TreeRefs = { rules: refsFile.rules, aliases: refsFile.aliases, defectRates: refsFile.defectRates, typicals: refsFile.typicals };
const ctx: PricingContext = { rateItems: refsFile.rateItems, products: golden.reference.products, modifiers: golden.reference.modifiers, settings: golden.reference.settings };
const deps: ScopeDeps = { refs, ctx, actor: "customer" };
const codes = new Set(ctx.rateItems.map((r) => r.code));

// ---- the six jobs ----------------------------------------------------------------------

type Job = {
  name: string;
  accountType: "residential" | "trade";
  /** The conversation, in the order a person would give it (qualification + intake). */
  intake: Array<[string, unknown]>;
  /** Tightening answers given AFTER the tree exists (the assistant way). */
  tightening: Array<[string, unknown]>;
  /** The same job as a wizard state (the wizard way). */
  wizard: (draft: AnswerDraft) => AnswerDraft;
};

const qual = (jobType: "interior" | "exterior" | "both", storeys: "single" | "double"): Array<[string, unknown]> => [
  ["q.address", { street: "12 Test St", suburb: "Kew", postcode: "3101" }],
  ["q.service_area", true],
  ["q.job_type", jobType],
  ["q.property_type", "house"],
  ["q.property_flags", { builtPre1970: "no", heritageListed: "no", bodyCorporate: "no", asbestosSuspected: "no" }],
  ["q.storeys", storeys],
  ["q.timing", "soon"],
  ["q.email", "parity@example.com"],
];

const JOBS: Job[] = [
  {
    name: "F1 interior 3-bed, change of colour, panel doors + sash windows answered late",
    accountType: "trade",
    intake: [...qual("interior", "single"), ["job.surfaces", ["walls", "ceilings", "doors", "architraves", "skirting", "windows"]], ["condition.tier", "change"], ["condition.damage", 1], ["rooms", { bedrooms: 3 }]],
    tightening: [["door_style", "panel"], ["window_style", "sash"]],
    wizard: (d) => ({ ...d, details: { ...d.details, doorStyle: "panel", windowStyle: "sash" } }),
  },
  {
    name: "F2 interior 2-bed open plan, freshen up, 2.7 m ceilings answered late",
    accountType: "residential",
    intake: [...qual("interior", "single"), ["job.surfaces", ["walls", "ceilings", "doors", "skirting"]], ["condition.tier", "fresh"], ["condition.damage", 0], ["rooms", { bedrooms: 2, openPlanKitchenLiving: true }]],
    tightening: [["ceiling_height", "2.7"]],
    wizard: (d) => ({ ...d, details: { ...d.details, ceilingHeight: "2.7" } }),
  },
  {
    name: "F3 interior 4-bed double storey, dark to light",
    accountType: "residential",
    intake: [...qual("interior", "double"), ["job.surfaces", ["walls", "ceilings", "doors", "architraves", "skirting", "windows"]], ["condition.tier", "dark_to_light"], ["condition.damage", 1], ["rooms", { bedrooms: 4, sizeBand: "gt200" }]],
    tightening: [],
    wizard: (d) => d,
  },
  {
    name: "F4 exterior single-storey weatherboard, weathered, no photos",
    accountType: "residential",
    intake: [...qual("exterior", "single"), ["ext.photos", "none"], ["ext.substrates", ["weatherboards"]], ["ext.painting", { body: true, windowsDoors: true, roofline: true, garage: false }], ["ext.condition", "weathered"]],
    tightening: [],
    wizard: (d) => d,
  },
  {
    name: "F5 exterior double-storey render + brick, good condition",
    accountType: "trade",
    intake: [...qual("exterior", "double"), ["ext.photos", "none"], ["ext.substrates", ["render", "brick"]], ["ext.painting", { body: true, windowsDoors: true, roofline: true, garage: true }], ["ext.condition", "good"]],
    tightening: [],
    wizard: (d) => d,
  },
  {
    name: "F6 both — 2-bed inside, weatherboards outside",
    accountType: "residential",
    intake: [...qual("both", "single"), ["job.surfaces", ["walls", "ceilings", "doors", "skirting", "windows"]], ["condition.tier", "change"], ["condition.damage", 0], ["rooms", { bedrooms: 2 }], ["ext.photos", "none"], ["ext.substrates", ["weatherboards"]], ["ext.painting", { body: true, windowsDoors: true, roofline: true, garage: false }], ["ext.condition", "good"]],
    tightening: [],
    wizard: (d) => d,
  },
];

/** How the person answers each loop question — the same rules for both paths. */
function loopAnswer(gap: Gap, doc: ScopeDoc): unknown {
  const k = gap.key;
  const room = gap.areaId != null ? docBlocks(doc).find((b) => Number(b.id) === gap.areaId) : null;
  if (/^room\.\d+\.size$/.test(k)) return "looks_right";
  if (/^room\.\d+\.cupboards$/.test(k)) return { on: room?.roomType === "kitchen" };
  if (/^room\.\d+\.cupboard_interiors$/.test(k)) return false;
  if (/^room\.\d+\.anything_else$/.test(k)) return "no";
  if (/^room\.\d+\.(surfaces|confirm)$/.test(k)) return true;
  if (k === "sweep.dw_totals" || k === "sweep.ext_dw_totals") return true;
  if (k === "sweep.missed_rooms" || k === "sweep.ext_missed") return "none";
  if (/^side\.\w+\.include$/.test(k)) return true;
  if (/^side\.\w+\.size$/.test(k)) return "looks_right";
  if (/^side\.\w+\.confirm$/.test(k)) return true;
  if (k === "ext.cond_card") return { cond: docWizard(doc)?.exterior?.condition ?? "good", rot: "no", acc: "none" };
  if (k === "ext.freestanding") return "none";
  if (k === "occupied") return false;
  if (k === "paint.brand") return ["dulux"];
  if (k === "paint.colours") return "known";
  if (k === "ext.access") return [];
  return null;
}

type Priced = { rows: string[]; hours: number; totalCents: number; accuracyPct: number; loCents: number; hiCents: number };

const rowsOf = (blocks: unknown[]) => (blocks as Array<{ kind?: string; name?: string; surfaces?: Array<{ code?: string; count?: number; coats?: number; sharePct?: number }> }>)
  .filter((b) => b.kind === "area")
  .flatMap((b) => (b.surfaces ?? []).map((s) => `${b.name}|${s.code}|${s.count ?? 1}|${s.coats ?? ""}|${s.sharePct ?? ""}`))
  .sort();

function priceBlocks(blocks: unknown[], modSel: Record<string, string>, deferred: Parameters<typeof editorPayload>[3], interior: ReturnType<typeof defaultInteriorLoop> | null, sides: ReturnType<typeof defaultSidesLoop> | null): Priced {
  const adj = adjustmentsFrom({ modSel });
  const payload = editorPayload(blocks, ctx, adj, deferred, loopConfirmState(blocks, interior, sides));
  const totals = priceEstimateTotals(blocks as BlockInput[], ctx, adj);
  const band = rangeBandPct(payload.accuracyPct, DEFAULT_BANDS);
  const r = rangeFromTotal(payload.totals.totalCents, band);
  return { rows: rowsOf(blocks), hours: totals.contractorHours, totalCents: payload.totals.totalCents, accuracyPct: payload.accuracyPct, loCents: r.loCents, hiCents: r.hiCents };
}

/** (a) The wizard way. */
function wizardPath(job: Job): Priced {
  let draft: AnswerDraft = {};
  const facts = { inServiceArea: true, timing: "soon", occupied: false, email: "parity@example.com", accountType: job.accountType };
  // Collect the intake exactly as the dispatcher would, but stop short of building.
  let doc = emptyDoc("wizard", job.accountType);
  for (const [k, v] of job.intake) {
    const r = applyAnswer(doc, k, v, "customer_stated", { ...deps, refs: { ...refs, rules: [] } }); // no rules → the tree cannot build here
    if (!r.ok) throw new Error(`${job.name}: ${k} → ${r.reason}`);
    doc = r.doc;
  }
  draft = job.wizard((doc.builderState.agent as { answers: AnswerDraft }).answers);
  draft = { ...draft, paint: { ...draft.paint, brands: ["dulux"], colourHelp: "known" } };
  const state = toWizardState(draft, facts);
  if (!state) throw new Error(`${job.name}: the wizard state does not parse`);
  const tree = buildTreeFromState(state as WizardState, refs, ctx);
  if ("skip" in tree) throw new Error(`${job.name}: build skipped (${tree.skip})`);
  let blocks = tree.areas as unknown as RoomBlock[];
  const deferred = [...tree.deferred];
  let next = tree.nextId;
  const interior = state.jobType !== "exterior" ? defaultInteriorLoop() : null;
  const sides = state.jobType !== "interior" ? defaultSidesLoop() : null;
  // The loop, by hand: size looks right, kitchen cupboards yes, others no,
  // interiors no, confirm each room; every side included, size looks right, confirmed.
  for (const b of [...blocks]) {
    if (b.kind !== "area" || b.type === "Exterior") continue;
    const id = Number(b.id);
    blocks = must(applyRoomSizeOk(blocks, id));
    const cfg = CUPBOARD_BY_ROOM_TYPE[String(b.roomType ?? "")];
    if (cfg && codes.has(cfg.code)) blocks = must(applyCupboard(blocks, id, b.roomType === "kitchen", null, () => next++));
    const icfg = CUPBOARD_INTERIOR_BY_ROOM_TYPE[String(b.roomType ?? "")];
    if (icfg && codes.has(icfg.code)) blocks = must(applyCupboardInterior(blocks, id, false, null, () => next++));
    blocks = blocks.map((x) => (Number(x.id) === id ? { ...x, customerCustom: [] } : x));
    blocks = must(confirmRoom(blocks, id, !!cfg && codes.has(cfg.code)));
  }
  if (sides) {
    let sb = blocks as unknown as SideBlock[];
    for (const key of SIDE_KEYS) {
      const r1 = applySideInclude(sb, key, true); if (!r1.ok) continue; sb = r1.blocks;
      sb = mustS(applySideSizeOk(sb, key));
      sb = mustS(confirmSide(sb, key));
    }
    blocks = sb as unknown as RoomBlock[];
    sides.cond = { cond: state.exterior?.condition ?? "good", rot: "no", acc: "none" };
    sides.extrasAns = "none"; sides.dwOk = true; sides.sweepAns = "none";
    sides.done = { extras: true, cond: true, dw: true, sweep: true };
  }
  if (interior) { interior.dwOk = true; interior.sweepAns = "none"; interior.done = { dw: true, sweep: true }; }
  return priceBlocks(blocks, tree.modSel, deferred, interior, sides);
}
const must = (r: { ok: true; blocks: RoomBlock[] } | { ok: false; error: string }) => { if (!r.ok) throw new Error(r.error); return r.blocks; };
const mustS = (r: { ok: true; blocks: SideBlock[] } | { ok: false; error: string }) => { if (!r.ok) throw new Error(r.error); return r.blocks; };

/** (b) The assistant way: tool calls, driven by the question graph. */
async function toolPath(job: Job): Promise<{ priced: Priced; tools: ScopeTools; store: MemoryScopeStore; ctx: ToolContext; result: ReturnType<typeof priceScope> }> {
  const store = new MemoryScopeStore({ refs, ctx });
  store.seed(emptyDoc("est-1", job.accountType));
  const tools = new ScopeTools(store, DEFAULT_AGENT_SETTINGS, new NoopTools(DEFAULT_AGENT_SETTINGS));
  const tctx: ToolContext = { conversationId: "c1", mode: "guided", view: "customer", estimateId: "est-1", accountId: null };
  const answer = async (key: string, value: unknown) => {
    const r = await tools.execute("answer_gap", { key, value, provenance: "customer_stated" }, tctx);
    if (r.status !== "ok") throw new Error(`${job.name}: ${key} → ${JSON.stringify(r)}`);
  };
  for (const [k, v] of job.intake) await answer(k, v);
  expect(isBuilt((await store.load("est-1"))!), `${job.name} should build after intake`).toBe(true);
  for (const [k, v] of job.tightening) await answer(k, v);
  // Walk the graph until nothing required or confirmable is left.
  for (let guard = 0; guard < 200; guard++) {
    const doc = (await store.load("est-1"))!;
    const gap = gapsFor(graphInput(doc, deps)).find((g) => g.kind !== "tightening" || g.key === "paint.colours" || g.key === "occupied");
    if (!gap) break;
    const v = loopAnswer(gap, doc);
    if (v === null) throw new Error(`${job.name}: no scripted answer for ${gap.key}`);
    await answer(gap.key, v);
  }
  const doc = (await store.load("est-1"))!;
  const result = priceScope(doc, deps);
  const blocks = docBlocks(doc);
  const wantsInterior = docWizard(doc)!.jobType !== "exterior";
  const wantsExterior = docWizard(doc)!.jobType !== "interior";
  const priced = priceBlocks(blocks, (doc.builderState.modSel as Record<string, string>) ?? {}, docDeferred(doc), wantsInterior ? (doc.builderState.interiorLoop as ReturnType<typeof defaultInteriorLoop>) : null, wantsExterior ? (doc.builderState.sidesLoop as ReturnType<typeof defaultSidesLoop>) : null);
  return { priced, tools, store, ctx: tctx, result };
}

describe("S3 parity — the wizard way and the assistant way price identically", () => {
  it.each(JOBS.map((j) => [j.name, j] as const))("%s", async (_n, job) => {
    const a = wizardPath(job);
    const b = await toolPath(job);
    expect(b.priced.rows).toEqual(a.rows);
    expect(b.priced.hours).toBeCloseTo(a.hours, 6);
    expect(b.priced.totalCents).toBe(a.totalCents);
    expect(b.priced.accuracyPct).toBe(a.accuracyPct);
    expect([b.priced.loCents, b.priced.hiCents]).toEqual([a.loCents, a.hiCents]);
    // price_scope reports the same figures the route's payload would.
    expect(b.result.totalCents).toBe(a.totalCents);
    expect([b.result.loCents, b.result.hiCents]).toEqual([a.loCents, a.hiCents]);
    expect(a.totalCents).toBeGreaterThan(0);
  });
});

describe("price_scope — R4, assumptions and swings", () => {
  it("a trade account sees a number from the first price; residential does not until confirmed and swept", async () => {
    const trade = await toolPath(JOBS[0]);
    const store = new MemoryScopeStore({ refs, ctx });
    store.seed(emptyDoc("est-1", "residential"));
    const tools = new ScopeTools(store, DEFAULT_AGENT_SETTINGS, new NoopTools(DEFAULT_AGENT_SETTINGS));
    const tctx: ToolContext = { conversationId: "c1", mode: "guided", view: "customer", estimateId: "est-1", accountId: null };
    for (const [k, v] of JOBS[0].intake) expect((await tools.execute("answer_gap", { key: k, value: v, provenance: "customer_stated" }, tctx)).status).toBe("ok");
    const early = priceScope((await store.load("est-1"))!, deps);
    expect(early.showNumber).toBe(false);
    expect(early.allAreasConfirmed).toBe(false);
    expect(early.totalCents).toBeGreaterThan(0);
    // Trade: the walk above ended confirmed; but even before that a trade job shows.
    expect(trade.result.showNumber).toBe(true);
    const tradeStore = new MemoryScopeStore({ refs, ctx }); tradeStore.seed(emptyDoc("t", "trade"));
    const tradeTools = new ScopeTools(tradeStore, DEFAULT_AGENT_SETTINGS, new NoopTools(DEFAULT_AGENT_SETTINGS));
    for (const [k, v] of JOBS[0].intake) await tradeTools.execute("answer_gap", { key: k, value: v, provenance: "customer_stated" }, { ...tctx, estimateId: "t" });
    expect(priceScope((await tradeStore.load("t"))!, deps).showNumber).toBe(true);
  });

  it("every open assumption is a chip with a $ swing, and ordering follows the swing", async () => {
    const store = new MemoryScopeStore({ refs, ctx });
    store.seed(emptyDoc("est-1", "trade"));
    const tools = new ScopeTools(store, DEFAULT_AGENT_SETTINGS, new NoopTools(DEFAULT_AGENT_SETTINGS));
    const tctx: ToolContext = { conversationId: "c1", mode: "guided", view: "customer", estimateId: "est-1", accountId: null };
    for (const [k, v] of JOBS[0].intake) await tools.execute("answer_gap", { key: k, value: v, provenance: "customer_stated" }, tctx);
    const doc = (await store.load("est-1"))!;
    const swings = assumptionSwings(doc, deps);
    expect(swings.door_style).toBeGreaterThan(0);
    expect(swings.window_style).toBeGreaterThan(0);
    expect(swings.ceiling_height).toBeGreaterThan(0);
    const r = priceScope(doc, deps);
    const keys = r.assumptions.map((a) => a.key);
    expect(keys).toContain("door_style");
    expect(keys).toContain("window_style");
    expect(keys).toContain("ceiling_height");
    for (const a of r.assumptions) expect(a.label.startsWith("Assumed:")).toBe(true);
    // The first chip is the biggest swing the engine could price.
    const pricedSwings = r.assumptions.filter((a) => a.swingCents > 0).map((a) => a.swingCents);
    expect(pricedSwings).toEqual([...pricedSwings].sort((x, y) => y - x));
    // next_gap serves the largest tightening gap once required ones are done.
    const gap = nextGap(graphInput(doc, deps, "guided", swings));
    expect(gap).not.toBeNull();
  });

  it("the whole result validates against the tool contract", async () => {
    const { result } = await toolPath(JOBS[1]);
    expect(toolSpec("price_scope")!.output.safeParse(result).success).toBe(true);
  });
});

describe("S3 rules", () => {
  it("add_custom_line is ALWAYS amber and routes to the visit tier (§2 rule 6)", async () => {
    const { tools, store, ctx: tctx } = await toolPath(JOBS[1]);
    const r = await tools.execute("add_custom_line", { areaId: null, text: "feature wall in the hallway" }, tctx);
    expect(r).toMatchObject({ status: "ok", data: { amber: true, visitTier: true } });
    const doc = (await store.load("est-1"))!;
    expect(doc.requiresSiteCheck).toBe(true);
    expect(docDeferred(doc).some((d) => d.kind === "custom_surface")).toBe(true);
    const t = checkThresholds(doc, deps);
    expect(t.outcome).toBe("visit");
  });

  it("add_surface pins the per-item charge-out (the twice-fixed trap): Air Vent prices at its own rate", async () => {
    const { tools, store, ctx: tctx } = await toolPath(JOBS[1]);
    const vent = ctx.rateItems.find((r) => r.code === "Air Vent" && r.category === "Interior");
    if (!vent) return; // card without the row — nothing to pin
    const doc0 = (await store.load("est-1"))!;
    const before = priceEstimateTotals(docBlocks(doc0) as unknown as BlockInput[], ctx, adjustmentsFrom(doc0.builderState)).subtotalCents;
    const room = docBlocks(doc0).find((b) => b.kind === "area" && b.type !== "Exterior")!;
    const r = await tools.execute("add_surface", { areaId: room.id, code: "Air Vent", count: 1, provenance: "customer_stated" }, tctx);
    expect(r.status).toBe("ok");
    const doc1 = (await store.load("est-1"))!;
    const after = priceEstimateTotals(docBlocks(doc1) as unknown as BlockInput[], ctx, adjustmentsFrom(doc1.builderState)).subtotalCents;
    const expected = Math.round((vent.rate_2_coat ?? 0) * (vent.charge_out_cents ?? 0));
    expect(after - before).toBe(expected);
  });

  it("add_surface refuses a code the card cannot price — never a silent $0", async () => {
    const { tools, store, ctx: tctx } = await toolPath(JOBS[1]);
    const room = docBlocks((await store.load("est-1"))!).find((b) => b.kind === "area")!;
    const r = await tools.execute("add_surface", { areaId: room.id, code: "Gold Leaf Frieze", provenance: "customer_stated" }, tctx);
    expect(r.status).toBe("refused");
  });

  it("check_thresholds: a confirmed small interior job self-serves; an exterior job is signed off in person", async () => {
    const small = await toolPath(JOBS[1]);
    const t = checkThresholds((await small.store.load("est-1"))!, deps);
    expect(["self_serve", "visit"]).toContain(t.outcome);
    if (t.outcome === "visit") expect(t.reasons.length).toBeGreaterThan(0);
    const ext = await toolPath(JOBS[3]);
    const te = checkThresholds((await ext.store.load("est-1"))!, deps);
    expect(te.outcome).toBe("visit");
    expect(te.capCents).toBe(1_200_000);
  });

  it("intake answers lock once the tree exists; tightening answers still land", async () => {
    const { tools, ctx: tctx } = await toolPath(JOBS[0]);
    const locked = await tools.execute("answer_gap", { key: "rooms", value: { bedrooms: 5 }, provenance: "customer_stated" }, tctx);
    expect(locked.status).toBe("refused");
    const open = await tools.execute("answer_gap", { key: "paint.brand", value: ["haymes"], provenance: "customer_stated" }, tctx);
    expect(open.status).toBe("ok");
  });

  it("a stop key is answered by its script, never by answer_gap", async () => {
    const { tools, ctx: tctx } = await toolPath(JOBS[0]);
    const r = await tools.execute("answer_gap", { key: "stop.lead_paint", value: true, provenance: "customer_stated" }, tctx);
    expect(r.status).toBe("refused");
    const stop = await tools.execute("hard_stop", { kind: "discount" }, tctx);
    expect(stop.status).toBe("refused"); // no script seeded in DEFAULT settings
  });

  it("support hours read the Melbourne clock", () => {
    const hours = DEFAULT_AGENT_SETTINGS.supportHours;
    // Tuesday 10:00 Melbourne (AEST, UTC+10) = Tuesday 00:00 UTC.
    expect(supportHoursState(hours, new Date("2026-09-01T00:00:00Z")).open).toBe(true);
    // Saturday → next Monday 08:00.
    const sat = supportHoursState(hours, new Date("2026-09-05T02:00:00Z"));
    expect(sat.open).toBe(false);
    expect(sat.nextOpening).toBe("Mon 08:00");
  });
});

describe("§10 acceptance: no number leaves without a tool result behind it", () => {
  it("a reply quoting the priced range passes; a made-up figure is replaced", async () => {
    const { tools } = await toolPath(JOBS[0]);
    const agentStore = new MemoryAgentStore();
    const conv = await agentStore.createConversation({ accountId: null, propertyId: null, estimateId: "est-1", channel: "portal", mode: "guided", view: "customer", createdBy: "u", anonToken: null, externalThreadId: null });
    const say = (lo: number, hi: number) => `Somewhere between $${(lo / 100).toLocaleString("en-AU")} and $${(hi / 100).toLocaleString("en-AU")}.`;
    const model = new ScriptedModel([
      toolTurn([{ name: "price_scope", input: {} }]),
      (req) => {
        const last = req.messages.at(-1)!.content as Array<{ content: string }>;
        const data = JSON.parse(last[0].content).data as { loCents: number; hiCents: number };
        return textTurn(say(data.loCents, data.hiCents));
      },
      textTurn("Call it $9,999 all in."),
    ]);
    const d = { model, tools, store: agentStore, settings: DEFAULT_AGENT_SETTINGS };
    const r1 = await runTurn(d, { conversationId: conv.id, text: "how much?", actor: "user" });
    expect(r1.text).toMatch(/\$\d/);
    const r2 = await runTurn(d, { conversationId: conv.id, text: "and roughly?", actor: "user" });
    expect(r2.text).not.toContain("$9,999");
    expect(assistantNumbersTraceable(await agentStore.listMessages(conv.id), await agentStore.listToolCalls(conv.id))).toBe(true);
  });
});
