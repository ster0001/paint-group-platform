/**
 * PROPOSE — facts from a brief (brief-extract.ts) into a proposed tree, built
 * by the wizard's own drafting code, with every fill-in listed and the gap
 * batch grouped by $ impact (parent §3.2, Addendum A §3.2/§3.3).
 *
 * Nothing here is invented: rooms come from the starter composition for the
 * stated bedroom count, reconciled with the rooms the text names; sizes are
 * the typical defaults unless the text gave them; surfaces are only what
 * was said (ceilings not stated → not included, and a chip says so); coats
 * default to the standard two with a fill-in on the list; defects price at
 * the defect rate on an ASSUMED quantity (D22) and stay amber until seen.
 */

import { DEFAULT_SURFACES, type WizardState } from "@/lib/wizard/state";
import { buildTreeFromState } from "@/lib/wizard/build-tree";
import { starterRoomList, type StarterRoom } from "@/lib/wizard/starter";
import { defaultInteriorLoop } from "@/lib/wizard/rooms-loop";
import { addWallSurface, applySideInclude, applySideSizeOk, defaultSidesLoop, findSide, SIDE_KEYS, type LooseBlock } from "@/lib/wizard/sides";
import { applyToggle } from "@/lib/wizard/scope-editor";
import { makeDraftSurface, type DraftArea } from "@/lib/extract/draft";
import { DEFECT_LABELS, defectHours } from "@/lib/capture/commit";
import { priceEstimateTotals, type BlockInput } from "@/lib/pricing/estimate";
import { adjustmentsFrom } from "@/lib/pricing/context";
import type { WizardDeferred } from "@/lib/wizard/view";
import type { BriefExtraction } from "./brief-extract";
import { gapsFor } from "./question-graph";
import { addArea, addCustomLine, docAnswers, exteriorTicks, docBlocks, docDeferred, docFacts, graphInput, isBuilt, nextIdFrom, toWizardState, type AnswerDraft, type ScopeBlock, type ScopeDeps, type ScopeDoc } from "./scope-doc";
import { assumptionSwings, priceScope } from "./scope-tools";
import type { Assumption, Gap } from "./schemas";

export type DiffSummary = {
  diffId: string;
  added: Array<{ areaName: string; surfaces: string[]; provenance: "ai_extracted" | "ai_derived" | "ai_assumed" | "customer_stated" | "human_confirmed" }>;
  changed: Array<{ areaName: string; what: string }>;
  removed: string[];
  assumed: Assumption[];
  gaps: Gap[];
  groups: { price: string[]; cosmetic: string[] };
  injectedInstructions: string[];
  unmapped: string[];
  priced: { totalCents: number; loCents: number; hiCents: number; liveTotalCents: number | null } | null;
  applied: boolean;
};

const ROOM_LABEL: Record<string, string> = { bedroom: "Bed", living: "Living room", dining: "Dining", kitchen: "Kitchen", bathroom: "Bathroom", wc: "WC", laundry: "Laundry", hallway: "Hallway", study: "Study", storage: "Storage", garage: "Garage" };
const DEFAULT_DEFECT_QTY: Record<string, number> = { lin_m: 3, m2: 2, each: 2 };

/** A fill-in the proposal made — listed, never silent. */
const fillIn = (key: string, label: string, assumedValue: string, swingCents = 0): Assumption => ({ key, areaId: null, label, assumedValue, swingCents });

export function proposeFromBrief(
  doc: ScopeDoc, extraction: BriefExtraction, deps: ScopeDeps,
  opts: { mode: "guided" | "cowork"; gateCents: number },
): { ok: true; working: ScopeDoc; summary: DiffSummary } | { ok: false; reason: string } {
  const fillIns: Assumption[] = [];
  let working: ScopeDoc = doc;

  if (!isBuilt(working)) {
    const built = buildFromBrief(working, extraction, deps, opts.mode, fillIns);
    if (!built.ok) return built;
    working = built.working;
  } else {
    // Act on an existing tree: add what the brief names; existing rooms stay.
    const stated = new Map<string, number>();
    for (const r of extraction.rooms) stated.set(r.roomType, (stated.get(r.roomType) ?? 0) + r.count);
    const existing = docBlocks(working).filter((b) => b.kind === "area" && b.type !== "Exterior");
    for (const r of extraction.rooms) {
      const have = existing.filter((b) => String(b.roomType ?? "") === r.roomType).length;
      const want = stated.get(r.roomType) ?? 0;
      for (let i = have; i < want; i++) {
        const a = addArea(working, deps, r.name, r.roomType, r.lengthM, r.widthM);
        if (a.ok) working = a.doc;
      }
      stated.set(r.roomType, 0);
    }
  }

  // Defects → prep lines at the defect rate on an assumed quantity (D22).
  working = addDefects(working, extraction, deps, fillIns);
  // Anything the catalogue can't price → amber custom line, visit tier.
  for (const u of extraction.unmapped) {
    const r = addCustomLine(working, null, u);
    if (r.ok) working = r.doc;
  }
  if (extraction.colourMatch) fillIns.push(fillIn("paint.colours", "Colour match requested — colours to be confirmed (coordination noted)", "match existing"));

  return { ok: true, working, summary: diffSummary(doc, working, deps, opts.gateCents, { injected: extraction.injectedInstructions, unmapped: extraction.unmapped, fillIns, applied: opts.mode === "guided" }) };
}

function buildFromBrief(doc: ScopeDoc, x: BriefExtraction, deps: ScopeDeps, mode: "guided" | "cowork", fillIns: Assumption[]): { ok: true; working: ScopeDoc } | { ok: false; reason: string } {
  const a = docAnswers(doc);
  const facts = docFacts(doc);
  const jobType = x.jobType ?? a.jobType ?? "interior";
  if (!x.jobType && !a.jobType) fillIns.push(fillIn("q.job_type", "Assumed: interior job", "interior"));
  const wantsInterior = jobType !== "exterior";
  const bedroomRooms = x.rooms.filter((r) => r.roomType === "bedroom").reduce((n, r) => n + r.count, 0);
  // A brief that names rooms but no bedroom count ("just the living room and
  // hallway") is that list and nothing more — no starter composition.
  const namedOnly = wantsInterior && x.bedrooms == null && a.basics?.bedrooms == null && x.rooms.length > 0;
  const bedrooms = x.bedrooms ?? (namedOnly ? bedroomRooms : (bedroomRooms || null)) ?? a.basics?.bedrooms ?? null;
  if (wantsInterior && bedrooms == null) return { ok: false, reason: "How many bedrooms? The brief doesn't say, and the room list starts from that." };
  if (namedOnly) fillIns.push(fillIn("rooms.named_only", "Assumed: only the rooms named — add any I've missed", "named"));
  const storeys = x.storeys ?? a.basics?.storeys ?? "single";
  if (!x.storeys && !a.basics?.storeys) fillIns.push(fillIn("q.storeys", "Assumed: single storey", "single"));
  // Page-2 ticks: interior surfaces as stated (or the usual set), plus the
  // exterior ticks derived from substrates + what we're painting outside —
  // without them the envelope scaffolds as bare walls (Tom, 3 Sep).
  const interiorSurfaces = wantsInterior ? (x.surfaces.length ? [...x.surfaces] : (a.surfaces?.filter((k) => !EXTERIOR_TICK.test(k)).length ? a.surfaces.filter((k) => !EXTERIOR_TICK.test(k)) : [...DEFAULT_SURFACES])) : [];
  const extTicks = jobType !== "interior" ? exteriorTicks({ exterior: { substrates: x.exterior?.substrates.length ? x.exterior.substrates : (a.exterior?.substrates ?? ["weatherboards"]), painting: x.exterior?.painting ?? a.exterior?.painting ?? { body: true, windowsDoors: true, roofline: true, garage: false } } } as AnswerDraft) : [];
  const surfaces = [...interiorSurfaces, ...extTicks];
  if (wantsInterior && !x.surfaces.length && !a.surfaces?.length) fillIns.push(fillIn("job.surfaces", `Assumed: the usual interior surfaces (${DEFAULT_SURFACES.join(", ")})`, DEFAULT_SURFACES.join(",")));
  if (jobType !== "interior" && !x.exterior?.painting && !a.exterior?.painting) fillIns.push(fillIn("ext.painting", "Assumed: painting the walls, windows and doors, and the roofline outside — not the garage", "body,windowsDoors,roofline"));
  const coats = x.coats ?? a.condition?.tier ?? "change";
  if (!x.coats && !a.condition?.tier) fillIns.push(fillIn("condition.tier", "Assumed: two coats (a change of colour)", "change"));
  const damageTier = x.defects.length ? Math.max(...x.defects.map((d) => d.severity)) : (a.details?.damageTier ?? 0);
  // A trade client's paragraph (Addendum A §3.3) builds at once: an unstated
  // property kind is assumed a house and said so; the four safety flags are
  // assumed clear and become a chip the person can flip (facts.flagsAssumed).
  const propertyKind = x.propertyKind ?? a.customer?.propertyKind ?? "house";
  if (!x.propertyKind && !a.customer?.propertyKind) fillIns.push(fillIn("q.property_type", "Assumed: a house", "house"));
  const flagsKnown = a.customer?.builtPre1970 != null && a.customer?.heritageListed != null && a.customer?.bodyCorporate != null && a.customer?.asbestosSuspected != null;
  if (!flagsKnown) fillIns.push(fillIn("q.property_flags", "Assumed: built after 1970, not heritage-listed, no body corporate, no asbestos — tap to change", "clear"));

  const draft: AnswerDraft = {
    ...a,
    jobType,
    // The wizard schema wants ≥1 bedroom; a named-only list bypasses the starter composition, so the count only satisfies the schema.
    basics: { bedrooms: Math.max(1, bedrooms ?? 1), storeys, sizeBand: a.basics?.sizeBand ?? "unsure", openPlanKitchenLiving: a.basics?.openPlanKitchenLiving ?? false },
    surfaces,
    condition: { tier: coats, darkToLightSurfaces: a.condition?.darkToLightSurfaces ?? [] },
    details: {
      ...a.details,
      doorStyle: x.doorStyle ?? a.details?.doorStyle ?? "unsure",
      windowStyle: x.windowStyle ?? a.details?.windowStyle ?? "unsure",
      ceilingHeight: x.ceilingHeight ?? a.details?.ceilingHeight ?? "unsure",
      damageTier, damageNote: x.defects.map((d) => `${d.where ?? "somewhere"}: ${d.type} sev${d.severity}`).join("; ").slice(0, 2000),
      damagePhotoCount: a.details?.damagePhotoCount ?? 0,
    },
    paint: { ...a.paint, colourHelp: x.colourMatch ? "advice" : (a.paint?.colourHelp ?? null) },
    customer: { ...a.customer, propertyKind, heritageListed: a.customer?.heritageListed ?? "no", bodyCorporate: a.customer?.bodyCorporate ?? "no", builtPre1970: a.customer?.builtPre1970 ?? "no", asbestosSuspected: a.customer?.asbestosSuspected ?? "no" },
    exterior: jobType !== "interior" ? {
      ...a.exterior,
      storeys,
      substrates: x.exterior?.substrates.length ? x.exterior.substrates : (a.exterior?.substrates ?? ["weatherboards"]),
      condition: x.exterior?.condition ?? a.exterior?.condition ?? "good",
      painting: x.exterior?.painting ?? a.exterior?.painting ?? { body: true, windowsDoors: true, roofline: true, garage: false },
      noPhotos: true,
    } : a.exterior,
    noPlan: wantsInterior,
  };
  if (jobType !== "interior") {
    if (!x.exterior?.substrates.length && !a.exterior?.substrates) fillIns.push(fillIn("ext.substrates", "Assumed: weatherboard walls outside", "weatherboards"));
    if (!x.exterior?.condition && !a.exterior?.condition) fillIns.push(fillIn("ext.condition", "Assumed: exterior paintwork in good condition", "good"));
  }
  // A brief build prices on typical sizes and assumed cupboards; the graph
  // confirms sizes in the sweep and asks cupboards as tightening (§3.3).
  const nextFacts = { ...facts, briefBuilt: true, ceilingsUnstated: x.surfaces.length > 0 && !x.surfaces.includes("ceilings"), ...(x.occupied != null ? { occupied: x.occupied } : {}), ...(flagsKnown ? {} : { flagsAssumed: true }) };
  const state = toWizardState(draft, nextFacts, mode === "cowork" ? "internal" : "customer");
  if (!state) return { ok: false, reason: "The brief isn't enough to build from yet — the address, email and property questions come first." };

  // Rooms: the starter composition for the bedroom count, reconciled with
  // what the text names. Unnamed starter rooms are ASSUMED and say so.
  let rooms: StarterRoom[] | null = null;
  if (wantsInterior && state.basics) {
    const base = namedOnly ? [] : starterRoomList(state.basics);
    const named = new Set<string>(["bedroom"]);
    for (const r of x.rooms) {
      named.add(r.roomType);
      const have = base.filter((b) => b.roomType === r.roomType);
      const want = r.roomType === "bedroom" ? have.length : r.count;
      if (have.length > want) {
        let extra = have.length - want;
        for (let i = base.length - 1; i >= 0 && extra > 0; i--) if (base[i].roomType === r.roomType) { base.splice(i, 1); extra--; }
      }
      for (let i = have.length; i < want; i++) {
        base.push({ name: want > 1 ? `${ROOM_LABEL[r.roomType] ?? r.name} ${i + 1}` : (r.name || ROOM_LABEL[r.roomType] || r.roomType), roomType: r.roomType, storey: "Ground" });
      }
    }
    if (x.bathrooms != null) {
      named.add("bathroom");
      const have = base.filter((b) => b.roomType === "bathroom").length;
      for (let i = have; i < x.bathrooms; i++) base.push({ name: `Bathroom ${i + 1}`, roomType: "bathroom", storey: state.basics.storeys === "double" ? "First" : "Ground" });
      if (x.bathrooms === 0) for (let i = base.length - 1; i >= 0; i--) if (base[i].roomType === "bathroom") base.splice(i, 1);
    }
    rooms = base;
    // Unnamed starter rooms are marked assumedFields:"presence" on the row
    // (A2) and surface as ONE "keep it / remove it" chip each — no second
    // fill-in line for the same fact.
    if (!x.rooms.some((r) => r.lengthM != null)) fillIns.push(fillIn("room.sizes", "Assumed: typical room sizes for every room (confirm in the sweep)", "typical"));
  }

  const tree = buildTreeFromState(state, deps.refs, deps.ctx, nextIdFrom(docBlocks(doc)), rooms);
  if ("skip" in tree) return { ok: false, reason: `Nothing could be built from the brief (${tree.skip}).` };
  const namedTypes = new Set<string>(["bedroom", ...x.rooms.map((r) => r.roomType), ...(x.bathrooms != null ? ["bathroom"] : [])]);
  const areas = tree.areas.map((area0) => {
    // A starter room the text never named is ASSUMED present — a chip until kept or removed.
    const area = !namedTypes.has(String(area0.roomType)) && area0.type !== "Exterior" && !area0.assumedFields.includes("presence")
      ? { ...area0, assumedFields: [...area0.assumedFields, "presence"] }
      : area0;
    const stated = x.rooms.find((r) => r.lengthM != null && r.widthM != null && (area.name.toLowerCase().startsWith((ROOM_LABEL[r.roomType] ?? r.name).toLowerCase()) || String(area.roomType) === r.roomType));
    if (!stated) return area;
    return { ...area, L: stated.lengthM as number, W: stated.widthM as number, origin: "ai_extracted" as const, confidence: 0.75, assumedFields: area.assumedFields.filter((f) => f !== "L" && f !== "W") };
  });
  const surfacesNotStated = new Set<string>();
  if (x.surfaces.length && !x.surfaces.includes("ceilings")) surfacesNotStated.add("ceilings");
  // Co-work exterior (Tom, 3 Sep): the estimator wants the whole envelope
  // priced at once — every side in, typical elevation sizes, the stated
  // substrates split across each side — then corrects in the builder. The
  // customer's own guided build keeps the per-side loop.
  let blocks: LooseBlock[] = areas as unknown as LooseBlock[];
  if (mode === "cowork" && jobType !== "interior") {
    let nextId = nextIdFrom(areas as unknown as ScopeBlock[]);
    const subs = state.exterior?.substrates ?? [];
    const extraWalls = subs.slice(1).map((k) => WALL_CODE_FOR[k]).filter((c): c is string => Boolean(c));
    let touched = false;
    for (const key of SIDE_KEYS) {
      if (!findSide(blocks, key)) continue;
      const inc = applySideInclude(blocks, key, true); if (inc.ok) blocks = inc.blocks;
      const ok = applySideSizeOk(blocks, key); if (ok.ok) blocks = ok.blocks;
      for (const code of extraWalls) { const w = addWallSurface(blocks, key, code, () => nextId++); if (w.ok) blocks = w.blocks; }
      touched = true;
    }
    if (touched) {
      fillIns.push(fillIn("sides.all", "Assumed: all four sides painted, typical elevation sizes — confirm in the sweep", "all"));
      if (extraWalls.length) fillIns.push(fillIn("sides.wall_split", `Assumed: ${subs.join(" and ")} split across each side (${subs[0]} the larger share) — adjust the split in the builder`, "split"));
    }
  }
  const working: ScopeDoc = {
    ...doc,
    builderState: {
      ...doc.builderState,
      blocks: blocks as unknown as ScopeBlock[], aiDeferred: tree.deferred, modSel: tree.modSel,
      interiorLoop: defaultInteriorLoop(), sidesLoop: defaultSidesLoop(),
      wizard: { state, builtAt: new Date().toISOString(), builtBy: "assistant-brief" },
      agent: { ...(doc.builderState.agent as Record<string, unknown> ?? {}), answers: draft, facts: nextFacts },
    },
  };
  // Ceilings not stated → not included, and the chip says so with its $ swing.
  if (surfacesNotStated.has("ceilings")) {
    fillIns.push(fillIn("surfaces.ceilings", "Ceilings not included — add?", "excluded", ceilingsSwing(working, state, deps)));
  }
  return { ok: true, working };
}

function ceilingsSwing(doc: ScopeDoc, state: WizardState, deps: ScopeDeps): number {
  const adj = adjustmentsFrom(doc.builderState);
  let blocks = docBlocks(doc) as unknown as Parameters<typeof applyToggle>[0];
  let next = nextIdFrom(docBlocks(doc));
  for (const b of docBlocks(doc)) {
    if (b.kind !== "area" || b.type === "Exterior") continue;
    const r = applyToggle(blocks, Number(b.id), "ceilings", true, state, () => next++);
    if (r.ok) blocks = r.blocks;
  }
  const before = priceEstimateTotals(docBlocks(doc) as unknown as BlockInput[], deps.ctx, adj).totalCents;
  const after = priceEstimateTotals(blocks as unknown as BlockInput[], deps.ctx, adj).totalCents;
  return Math.max(0, after - before);
}

function addDefects(doc: ScopeDoc, x: BriefExtraction, deps: ScopeDeps, fillIns: Assumption[]): ScopeDoc {
  if (x.defects.length === 0) return doc;
  const blocks = docBlocks(doc).map((b) => ({ ...b, surfaces: [...(b.surfaces ?? [])] }));
  const deferred: WizardDeferred[] = [...docDeferred(doc)];
  let next = nextIdFrom(blocks);
  for (const d of x.defects) {
    const rate = deps.refs.defectRates.find((r) => r.defect_type === d.type);
    const label = DEFECT_LABELS[d.type] ?? d.type.replace(/_/g, " ");
    const room = d.where ? blocks.find((b) => b.kind === "area" && b.type !== "Exterior" && (String(b.name ?? "").toLowerCase().includes(d.where!.toLowerCase().split(" ")[0]) || String(b.roomType ?? "") === d.where!.toLowerCase())) : null;
    if (!rate) {
      deferred.push({ room: room ? String(room.name) : "Whole job", areaId: room ? Number(room.id) : null, what: `prep: ${label} (no rate)`, count: 1, needs: "no prep rate matches this defect — price the prep by hand", kind: "custom_surface" });
      continue;
    }
    const qty = d.qty ?? DEFAULT_DEFECT_QTY[rate.unit] ?? 2;
    const hours = defectHours({ type: d.type, severity: d.severity, qty }, [rate]);
    const line = makeDraftSurface(next++, d.type, `${label} — assumed ${qty} ${rate.unit.replace("lin_m", "lin m").replace("m2", "m²")}`, 1, "ai_extracted", 0.6, ["prep", "defect_quantity"]);
    line.prepHr = hours;
    line.crewNote = `${label} sev${d.severity} — quantity assumed, confirm from photos`;
    if (room) {
      room.surfaces!.push(line as unknown as ScopeBlock["surfaces"] extends Array<infer S> ? S : never);
      deferred.push({ room: String(room.name), areaId: Number(room.id), what: `prep: ${label} sev${d.severity}`, count: 1, needs: `priced at the ${d.severity === 1 ? "minor" : "standard"}-defect rate on an assumed ${qty} ${rate.unit} — photos confirm before it is fixed`, kind: "prep_assumed" });
    } else {
      deferred.push({ room: "Whole job", areaId: null, what: `prep: ${label} sev${d.severity} — which room?`, count: 1, needs: `${qty} ${rate.unit} assumed (~${hours}h) — assign it to a room`, kind: "prep_assumed" });
    }
    fillIns.push(fillIn(`defect.${d.type}.${room ? Number(room.id) : "job"}`, `Assumed: ${qty} ${rate.unit} of ${label.toLowerCase()}${room ? ` in the ${room.name}` : ""} — photos confirm`, String(qty), Math.round(hours * 9500)));
  }
  return { ...doc, builderState: { ...doc.builderState, blocks, aiDeferred: deferred } };
}

export function diffSummary(
  live: ScopeDoc, working: ScopeDoc, deps: ScopeDeps, gateCents: number,
  extra: { injected?: string[]; unmapped?: string[]; fillIns?: Assumption[]; applied?: boolean } = {},
): DiffSummary {
  const liveAreas = new Map(docBlocks(live).filter((b) => b.kind === "area").map((b) => [Number(b.id), b]));
  const workAreas = docBlocks(working).filter((b) => b.kind === "area");
  const added: DiffSummary["added"] = [];
  const changed: DiffSummary["changed"] = [];
  for (const b of workAreas) {
    const before = liveAreas.get(Number(b.id));
    const label = (s: { code?: string; internalLabel?: unknown; count?: number }) => `${String(s.internalLabel ?? s.code)}${(s.count ?? 1) > 1 ? ` ×${s.count}` : ""}`;
    if (!before) {
      const o = String(b.origin ?? "ai_assumed");
      added.push({ areaName: String(b.name ?? "Area"), surfaces: (b.surfaces ?? []).map(label), provenance: (["ai_extracted", "ai_derived", "ai_assumed", "customer_stated", "human_confirmed"].includes(o) ? o : "ai_assumed") as DiffSummary["added"][number]["provenance"] });
      continue;
    }
    const whats: string[] = [];
    if (Number(before.L) !== Number(b.L) || Number(before.W) !== Number(b.W)) whats.push(`size ${before.L}×${before.W} → ${b.L}×${b.W} m`);
    const beforeCodes = new Set((before.surfaces ?? []).map((s) => `${s.code}|${s.count ?? 1}`));
    const afterCodes = new Set((b.surfaces ?? []).map((s) => `${s.code}|${s.count ?? 1}`));
    const plus = (b.surfaces ?? []).filter((s) => !beforeCodes.has(`${s.code}|${s.count ?? 1}`)).map(label);
    const minus = (before.surfaces ?? []).filter((s) => !afterCodes.has(`${s.code}|${s.count ?? 1}`)).map(label);
    if (plus.length) whats.push(`+ ${plus.join(", ")}`);
    if (minus.length) whats.push(`− ${minus.join(", ")}`);
    if (whats.length) changed.push({ areaName: String(b.name ?? "Area"), what: whats.join("; ") });
  }
  const workIds = new Set(workAreas.map((b) => Number(b.id)));
  const removed = [...liveAreas.values()].filter((b) => !workIds.has(Number(b.id))).map((b) => String(b.name ?? "Area"));

  const built = isBuilt(working);
  const priced = built ? priceScope(working, deps) : null;
  const swings = built ? assumptionSwings(working, deps) : undefined;
  const gaps = gapsFor(graphInput(working, deps, "cowork", swings));
  const assumed = [...(extra.fillIns ?? []), ...(priced?.assumptions ?? [])].filter((a, i, all) => all.findIndex((x) => x.key === a.key) === i);
  const price = gaps.filter((g) => g.kind === "required" || (g.swingCents ?? 0) >= gateCents).map((g) => g.key);
  const cosmetic = gaps.filter((g) => !price.includes(g.key)).map((g) => g.key);
  return {
    diffId: "pending",
    added, changed, removed, assumed, gaps,
    groups: { price, cosmetic },
    injectedInstructions: extra.injected ?? [],
    unmapped: extra.unmapped ?? [],
    priced: priced ? { totalCents: priced.totalCents, loCents: priced.loCents, hiCents: priced.hiCents, liveTotalCents: isBuilt(live) ? priceScope(live, deps).totalCents : null } : null,
    applied: extra.applied ?? false,
  };
}

/** Rows a proposal would write — for the apply_diff result. */
export function rowCount(doc: ScopeDoc): number {
  return docBlocks(doc).filter((b) => b.kind === "area").reduce((n, b) => n + 1 + (b.surfaces ?? []).length, 0);
}

export type { DraftArea };

/** Substrate answer → the wall rate row it lands on. */
const WALL_CODE_FOR: Record<string, string> = { weatherboards: "Weatherboards", render: "Render", brick: "Brick", concrete: "Concrete / Tilt Slab" };
const EXTERIOR_TICK = /^(weatherboards|render|brick|concrete|fascias|gutters|eaves|downpipes|exterior_windows|exterior_doors|garage_doors)$/;
