/**
 * THE SCOPE DOCUMENT — the estimate's builder_state, read and written the
 * way the wizard-edit route reads and writes it, as pure functions.
 *
 * Every assistant answer lands here through `applyAnswer`, which maps a
 * question-graph key onto the SAME loop function the route dispatches to
 * for the customer's tap (applyRoomDims, applyCupboard, applySideInclude,
 * confirmRoom, …). The tree itself is built by lib/wizard/build-tree.ts —
 * the wizard path — once the answers make a complete wizard state. That is
 * what lets S3's parity test hold: a conversation IS a wizard run.
 *
 * Two shapes live in builder_state alongside the route's own keys:
 *   agent.answers  — the partial wizard state while it is being collected
 *   agent.facts    — what the wizard never stored (occupied, timing, …)
 *
 * Nothing here prices. Nothing here talks to a database.
 */

import { coatsFor } from "@/lib/wizard/state";
import { DEFAULT_SURFACES, wizardStateSchema, windowStyleLabel, windowStyleToSchema, type WizardState } from "@/lib/wizard/state";
import { buildTreeFromState, type TreeRefs } from "@/lib/wizard/build-tree";
import {
  CUPBOARD_BY_ROOM_TYPE, addCatalogueLine, addRoomCustom, applyCupboard, applyCupboardInterior, applyLineCount,
  applyRoomDims, applyRoomSizeNotSure, applyRoomSizeOk, confirmRoom, defaultInteriorLoop, removeLine,
  type InteriorLoopMeta, type LooseBlock as RoomBlock,
} from "@/lib/wizard/rooms-loop";
import {
  ALLOWANCE_CODES, WEATHERED_MODIFIER_CODE, addSideSurface, applySideCount, applySideDims, applySideInclude, applySideSizeOk,
  applyWallShare, confirmSide, defaultSidesLoop, rateFor, removeSideLine, toggleExtrasItem,
  type SideKey, type SidesLoopMeta, type LooseBlock as SideBlock,
} from "@/lib/wizard/sides";
import { FREESTANDING_EXTRA_KEYS, applyExteriorToggle, applyToggle, hasFreestandingExtras } from "@/lib/wizard/scope-editor";
import { INTERIOR_POOR_MODIFIER_CODE } from "@/lib/wizard/exteriorAnswers";
import { applyWizardAnswers } from "@/lib/wizard/merge";
import { markStarterProvenance, starterExtraction } from "@/lib/wizard/starter";
import { buildDraft } from "@/lib/extract/draft";
import { doorCodeFor, doorLineLabel, doorScopeOfCode, doorStyleOfCode, windowRateCode } from "@/lib/extract/scope";
import { perItemChargeOut } from "@/lib/wizard/add-catalogue";
import type { WizardDeferred } from "@/lib/wizard/view";
import type { PricingContext } from "@/lib/pricing/estimate";
import { gapsFor, type GraphBlock, type GraphFacts, type GraphInput } from "./question-graph";
import type { Provenance } from "./schemas";

export type ScopeBlock = GraphBlock;

export type AgentFacts = GraphFacts & { accountType: "residential" | "trade" | null };

export type ScopeDoc = {
  estimateId: string | null;
  status: string;
  requiresSiteCheck: boolean;
  builderState: Record<string, unknown>;
  /** The customer document's token (sent estimates) — for links, never auth. */
  shareToken?: string | null;
};

/** Partial answers, wizard-shaped, while the conversation collects them. */
export type AnswerDraft = {
  jobType?: WizardState["jobType"];
  address?: WizardState["address"];
  customer?: Partial<NonNullable<WizardState["customer"]>>;
  basics?: Partial<NonNullable<WizardState["basics"]>>;
  surfaces?: string[];
  condition?: Partial<WizardState["condition"]>;
  details?: Partial<WizardState["details"]>;
  paint?: Partial<WizardState["paint"]>;
  exterior?: Partial<NonNullable<WizardState["exterior"]>>;
  noPlan?: boolean;
  planRunIds?: string[];
  facadeRunIds?: string[];
  listingUrl?: string;
};

export type ScopeDeps = { refs: TreeRefs; ctx: PricingContext; actor: "customer" | "staff" };

export type AnswerOutcome =
  | { ok: true; doc: ScopeDoc; note?: string; built?: boolean }
  | { ok: false; reason: string };

export const POST_BUILD_LOCKED = "That's set for this estimate now — a person at Paint Group can change it for you.";

// ---- readers -----------------------------------------------------------------

const agentOf = (doc: ScopeDoc) => ((doc.builderState.agent ?? {}) as { answers?: AnswerDraft; facts?: Partial<AgentFacts> });

export function docAnswers(doc: ScopeDoc): AnswerDraft { return agentOf(doc).answers ?? {}; }
export function docFacts(doc: ScopeDoc): AgentFacts {
  const f = agentOf(doc).facts ?? {};
  return { inServiceArea: f.inServiceArea ?? null, timing: f.timing ?? null, occupied: f.occupied ?? null, email: f.email ?? null, accountType: f.accountType ?? null, accessAnswered: f.accessAnswered === true, stopsDelivered: Array.isArray(f.stopsDelivered) ? (f.stopsDelivered as string[]) : [], flagsAssumed: f.flagsAssumed === true, photoCount: typeof f.photoCount === "number" ? f.photoCount : 0, briefBuilt: f.briefBuilt === true, ceilingsUnstated: f.ceilingsUnstated === true, photosDeferred: f.photosDeferred === true };
}
export function docBlocks(doc: ScopeDoc): ScopeBlock[] { return Array.isArray(doc.builderState.blocks) ? (doc.builderState.blocks as ScopeBlock[]) : []; }
export function docDeferred(doc: ScopeDoc): WizardDeferred[] { return Array.isArray(doc.builderState.aiDeferred) ? (doc.builderState.aiDeferred as WizardDeferred[]) : []; }
export function docInterior(doc: ScopeDoc): InteriorLoopMeta { return (doc.builderState.interiorLoop as InteriorLoopMeta | undefined) ?? defaultInteriorLoop(); }
export function docSides(doc: ScopeDoc): SidesLoopMeta { return (doc.builderState.sidesLoop as SidesLoopMeta | undefined) ?? defaultSidesLoop(); }
export function docWizard(doc: ScopeDoc): WizardState | null {
  const parsed = wizardStateSchema.safeParse((doc.builderState.wizard as { state?: unknown } | undefined)?.state);
  return parsed.success ? parsed.data : null;
}
export function isBuilt(doc: ScopeDoc): boolean { return docBlocks(doc).some((b) => b.kind === "area"); }
export const nextIdFrom = (blocks: ScopeBlock[]) =>
  Math.max(0, ...blocks.flatMap((b) => [Number(b.id) || 0, ...(b.surfaces ?? []).map((s) => Number(s.id) || 0)])) + 1;

function withState(doc: ScopeDoc, patch: Record<string, unknown>): ScopeDoc {
  return { ...doc, builderState: { ...doc.builderState, ...patch } };
}
function withAgent(doc: ScopeDoc, patch: { answers?: AnswerDraft; facts?: Partial<AgentFacts> }): ScopeDoc {
  const a = agentOf(doc);
  return withState(doc, { agent: { answers: patch.answers ?? a.answers ?? {}, facts: { ...(a.facts ?? {}), ...(patch.facts ?? {}) } } });
}

/** The wizard state the graph reads: the built snapshot, else the draft. */
export function docState(doc: ScopeDoc): Partial<WizardState> {
  const built = docWizard(doc);
  if (built) return built;
  const a = docAnswers(doc);
  return a as unknown as Partial<WizardState>;
}

export function graphInput(doc: ScopeDoc, deps: ScopeDeps, mode: "guided" | "cowork" = "guided", swings?: Record<string, number>): GraphInput {
  const blocks = docBlocks(doc);
  const state = docState(doc);
  const wantsInterior = state.jobType === "interior" || state.jobType === "both";
  const wantsExterior = state.jobType === "exterior" || state.jobType === "both";
  const facts = docFacts(doc);
  return {
    mode, accountType: facts.accountType, state, blocks,
    interior: wantsInterior && isBuilt(doc) ? docInterior(doc) : null,
    sides: wantsExterior && isBuilt(doc) ? docSides(doc) : null,
    scopeRules: deps.refs.rules,
    rateCodes: new Set(deps.ctx.rateItems.map((r) => r.code)),
    facts: { inServiceArea: facts.inServiceArea, timing: facts.timing, occupied: facts.occupied, email: facts.email, accessAnswered: facts.accessAnswered, stopsDelivered: facts.stopsDelivered, flagsAssumed: facts.flagsAssumed, photoCount: facts.photoCount, briefBuilt: facts.briefBuilt, ceilingsUnstated: facts.ceilingsUnstated, photosDeferred: facts.photosDeferred },
    swings,
  };
}

// ---- the draft → a full wizard state ---------------------------------------

/** Fill the wizard's "unsure" tiles for anything still open, so the tree can
 *  build as soon as the REQUIRED answers are in (tightening questions narrow
 *  it afterwards, exactly as the wizard prices unsure at the default rate). */
export function toWizardState(draft: AnswerDraft, facts: AgentFacts, mode: "customer" | "internal" = "customer"): WizardState | null {
  if (!draft.jobType) return null;
  const wantsExterior = draft.jobType !== "interior";
  const c = draft.customer ?? {};
  const candidate = {
    mode,
    jobType: draft.jobType,
    title: "",
    address: draft.address ?? null,
    listingUrl: draft.listingUrl ?? "",
    planRunIds: draft.planRunIds ?? [],
    facadeRunIds: draft.facadeRunIds ?? [],
    conditionSourceIds: [],
    // The no-plan flag is the INTERIOR path's (the schema demands basics with
    // it); an exterior-only job never carries it.
    noPlan: draft.jobType === "exterior" ? false : (draft.noPlan ?? (draft.planRunIds?.length ? false : true)),
    basics: draft.basics && draft.basics.bedrooms != null
      ? { bedrooms: draft.basics.bedrooms, storeys: draft.basics.storeys ?? "single", sizeBand: draft.basics.sizeBand ?? "unsure", openPlanKitchenLiving: draft.basics.openPlanKitchenLiving ?? false }
      : null,
    surfaces: draft.surfaces?.length ? draft.surfaces : (draft.jobType === "exterior" ? exteriorTicks(draft) : DEFAULT_SURFACES),
    condition: {
      tier: draft.condition?.tier ?? (draft.jobType === "exterior" ? "change" : undefined),
      // The assistant asks the tier, not the per-surface follow-up: dark to
      // light applies to everything being painted unless told otherwise.
      darkToLightSurfaces: draft.condition?.tier === "dark_to_light"
        ? (draft.condition?.darkToLightSurfaces?.length ? draft.condition.darkToLightSurfaces : (draft.surfaces?.length ? draft.surfaces : DEFAULT_SURFACES))
        : (draft.condition?.darkToLightSurfaces ?? []),
    },
    details: {
      doorStyle: draft.details?.doorStyle ?? "unsure",
      doorScope: draft.details?.doorScope ?? "frame",
      windowStyle: draft.details?.windowStyle ?? "unsure",
      ceilingHeight: draft.details?.ceilingHeight ?? "unsure",
      damageTier: draft.details?.damageTier ?? (draft.jobType === "exterior" ? 0 : undefined),
      damageNote: draft.details?.damageNote ?? "",
      damagePhotoCount: draft.details?.damagePhotoCount ?? 0,
    },
    contact: { name: "", email: facts.email ?? "", phone: "" },
    paint: { brands: draft.paint?.brands ?? [], colourHelp: draft.paint?.colourHelp ?? null, waterBasedOnly: draft.paint?.waterBasedOnly ?? false, trimsOilBased: draft.paint?.trimsOilBased ?? null, base: draft.paint?.base ?? null },
    // Staff co-work (internal mode) has no customer block unless one was given.
    customer: mode === "internal" && !c.propertyKind ? null : {
      email: c.email ?? facts.email ?? "",
      suburb: c.suburb ?? draft.address?.suburb ?? "",
      postcode: c.postcode ?? draft.address?.postcode ?? "",
      propertyKind: c.propertyKind,
      heritageListed: c.heritageListed,
      bodyCorporate: c.bodyCorporate,
      builtPre1970: c.builtPre1970,
      asbestosSuspected: c.asbestosSuspected,
    },
    exterior: wantsExterior ? {
      storeys: draft.exterior?.storeys ?? draft.basics?.storeys ?? "single",
      substrates: draft.exterior?.substrates ?? [],
      painting: draft.exterior?.painting ?? { body: true, windowsDoors: true, roofline: true, garage: false },
      condition: draft.exterior?.condition ?? null,
      access: draft.exterior?.access ?? [],
      accessEquipment: draft.exterior?.accessEquipment ?? [],
      // Photos are asked LAST (they tighten, never block): without a listing
      // or facade photos the tree sizes the elevations from the answers, the
      // wizard's own "no photos to hand" path.
      noPhotos: draft.exterior?.noPhotos ?? (!draft.listingUrl?.trim() && (draft.facadeRunIds?.length ?? 0) < 2),
      extras: draft.exterior?.extras ?? { deck: false, fence: false, fenceMetres: null, pergola: false, balustrade: false },
    } : null,
  };
  const parsed = wizardStateSchema.safeParse(candidate);
  return parsed.success ? parsed.data : null;
}

/** Build the tree from the draft when it is complete enough. */
export function tryBuild(doc: ScopeDoc, deps: ScopeDeps): { doc: ScopeDoc; built: boolean } {
  if (isBuilt(doc)) return { doc, built: false };
  // Build only once every pre-build REQUIRED question is answered — a
  // both-job must not build on its interior answers alone (the exterior
  // intake would then be locked). Photos never gate the build — defect and
  // facade photos are asked LAST and tighten an amber price (D22).
  const openIntake = gapsFor(graphInput(doc, deps)).some((g) => g.kind === "required" && (g.key.startsWith("q.") || PRE_BUILD_KEYS.has(g.key)));
  if (openIntake) return { doc, built: false };
  const state = toWizardState(docAnswers(doc), docFacts(doc));
  if (!state) return { doc, built: false };
  if (state.jobType !== "exterior" && !state.basics) return { doc, built: false };
  const tree = buildTreeFromState(state, deps.refs, deps.ctx);
  if ("skip" in tree) return { doc, built: false };
  return {
    doc: withState(doc, {
      blocks: tree.areas, aiDeferred: tree.deferred, modSel: tree.modSel,
      interiorLoop: defaultInteriorLoop(), sidesLoop: defaultSidesLoop(),
      wizard: { state, builtAt: new Date().toISOString(), builtBy: "assistant" },
    }),
    built: true,
  };
}

// ---- answers -----------------------------------------------------------------

type Obj = Record<string, unknown>;
const obj = (v: unknown): Obj => (v && typeof v === "object" && !Array.isArray(v) ? (v as Obj) : {});
const str = (v: unknown) => (typeof v === "string" ? v.trim() : "");
const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : typeof v === "string" && v.trim() !== "" && Number.isFinite(Number(v)) ? Number(v) : null);
/** Yes/no as a person (or the model relaying a chip label) says it:
 *  "No, it'll be empty" is a no; "Yes, we'll be there" is a yes. */
const bool = (v: unknown): boolean | null => {
  if (typeof v === "boolean") return v;
  if (typeof v !== "string") return null;
  const t = v.trim().toLowerCase();
  if (/^(yes|y|true|yep|yeah|occupied|living|we'll be there)\b/.test(t)) return true;
  if (/^(no|n|false|nope|empty|vacant|nobody|unoccupied)\b/.test(t)) return false;
  return null;
};
/** An option by its code, or by a label that starts with it ("Single storey" → single). */
const oneOf = <T extends string>(v: unknown, opts: readonly T[]): T | null => {
  if (typeof v !== "string") return null;
  const t = v.trim().toLowerCase();
  const exact = (opts as readonly string[]).find((o) => o.toLowerCase() === t);
  if (exact) return exact as T;
  const byPrefix = (opts as readonly string[]).find((o) => t.startsWith(o.toLowerCase().replace(/_/g, " ")) || t.startsWith(o.toLowerCase()));
  return (byPrefix as T) ?? null;
};

const PRE_BUILD_KEYS = new Set(["q.address", "q.job_type", "q.property_type", "q.storeys", "rooms", "job.surfaces", "condition.damage", "ext.storeys", "ext.substrates", "ext.painting", "ext.condition"]);

export function applyAnswer(doc: ScopeDoc, key: string, value: unknown, provenance: Provenance, deps: ScopeDeps): AnswerOutcome {
  if (key.startsWith("stop.")) return { ok: false, reason: "A hard stop is answered by its script, not by me." };
  const built = isBuilt(doc);
  if (built && PRE_BUILD_KEYS.has(key)) return { ok: false, reason: POST_BUILD_LOCKED };

  const a = docAnswers(doc);
  const stamp = provenance;

  // ---- qualification + intake (write the draft; build when complete) -------
  const patchDraft = (patch: AnswerDraft, factPatch: Partial<AgentFacts> = {}): AnswerOutcome => {
    const next = withAgent(doc, { answers: deepMerge(a, patch), facts: factPatch });
    const r = tryBuild(next, deps);
    return { ok: true, doc: r.doc, built: r.built };
  };

  switch (key) {
    case "q.address": {
      const v = obj(value);
      const suburb = str(v.suburb); const postcode = str(v.postcode);
      if (!suburb && !postcode) return { ok: false, reason: "I need at least the suburb or postcode." };
      return patchDraft({
        address: { street: str(v.street).slice(0, 120), suburb: suburb.slice(0, 80), state: str(v.state).slice(0, 10) || "VIC", postcode: postcode.slice(0, 10), formatted: str(v.formatted).slice(0, 250) || [str(v.street), suburb, postcode].filter(Boolean).join(" ") },
        customer: { suburb, postcode },
      }, { inServiceArea: null });
    }
    case "q.service_area": {
      const b = bool(value);
      if (b == null) return { ok: false, reason: "The service-area check needs a yes or no." };
      return { ok: true, doc: withAgent(doc, { facts: { inServiceArea: b } }) };
    }
    case "q.account_type": {
      const t = oneOf(value, ["residential", "trade"] as const);
      if (!t) return { ok: false, reason: "Home (residential) or business/trade — which is it?" };
      return { ok: true, doc: withAgent(doc, { facts: { accountType: t } }) };
    }
    case "q.job_type": {
      const j = oneOf(value, ["interior", "exterior", "both"] as const);
      if (!j) return { ok: false, reason: "Inside, outside, or both?" };
      return patchDraft({ jobType: j });
    }
    case "q.property_type": {
      const k = oneOf(value, ["house", "townhouse", "unit_apartment", "commercial"] as const);
      if (!k) return { ok: false, reason: "House, townhouse, unit/apartment or commercial?" };
      return patchDraft({ customer: { propertyKind: k } });
    }
    case "q.property_flags": {
      const v = obj(value);
      const tri = (x: unknown) => oneOf(x, ["yes", "no", "unsure"] as const) ?? (bool(x) === true ? "yes" : bool(x) === false ? "no" : "unsure");
      const flags = { builtPre1970: tri(v.builtPre1970), heritageListed: tri(v.heritageListed), bodyCorporate: tri(v.bodyCorporate), asbestosSuspected: tri(v.asbestosSuspected) };
      if (!built) return patchDraft({ customer: flags });
      // After a brief build: the answered flags replace the assumed ones.
      const next = withAgent(patchWizardState(doc, (st) => ({ ...st, customer: st.customer ? { ...st.customer, ...flags } : st.customer })), { answers: deepMerge(a, { customer: flags }), facts: { flagsAssumed: false } });
      return { ok: true, doc: next };
    }
    case "q.storeys": {
      const s = oneOf(value, ["single", "double"] as const) ?? (num(value) === 2 ? "double" : num(value) === 1 ? "single" : null);
      if (!s) return { ok: false, reason: "Single storey or double?" };
      return patchDraft({ basics: { storeys: s }, exterior: { storeys: s } });
    }
    case "q.timing": return { ok: true, doc: withAgent(doc, { facts: { timing: str(value) || "unsure" } }) };
    case "q.email": {
      const e = str(value).toLowerCase();
      if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(e)) return { ok: false, reason: "That doesn't look like an email address." };
      return patchDraft({ customer: { email: e } }, { email: e });
    }
    case "rooms": {
      const v = obj(value);
      const bedrooms = num(v.bedrooms);
      if (bedrooms == null || bedrooms < 1 || bedrooms > 8) return { ok: false, reason: "How many bedrooms — 1 to 8?" };
      return patchDraft({ basics: { bedrooms: Math.round(bedrooms), openPlanKitchenLiving: bool(v.openPlanKitchenLiving) ?? false, sizeBand: oneOf(v.sizeBand, ["lt120", "s120_200", "gt200", "unsure"] as const) ?? "unsure" }, noPlan: true });
    }
    case "job.surfaces": {
      const keys = Array.isArray(value) ? value.map(String) : str(value).split(/[,\s]+/).filter(Boolean);
      const ok = keys.filter((k) => ["walls", "ceilings", "cornices", "doors", "architraves", "skirting", "windows", "staircase"].includes(k));
      if (ok.length === 0) return { ok: false, reason: "Name at least one of: walls, ceilings, cornices, doors, architraves, skirting, windows." };
      return patchDraft({ surfaces: ok });
    }
    case "condition.tier": {
      // Also the way "3 coats" / "one coat" arrives after the build.
      const raw = typeof value === "string" ? value.trim().toLowerCase() : "";
      const t = oneOf(value, ["fresh", "change", "dark_to_light"] as const)
        ?? (/\b(3|three) coats?\b|dark to light/.test(raw) ? "dark_to_light" : /\b(1|one) coats?\b|freshen|same colour/.test(raw) ? "fresh" : /\b(2|two) coats?\b|change of colour|new colour/.test(raw) ? "change" : null);
      if (!t) return { ok: false, reason: "Freshen up (one coat), change of colour (two), or dark to light (three)?" };
      const patched = patchDraft({ condition: { tier: t } });
      if (!patched.ok || !isBuilt(doc)) return patched;
      // After the build the rows carry their coats: re-coat every surface line.
      const coats = coatsFor(t, t === "dark_to_light");
      const blocks = docBlocks(patched.doc).map((b) => (b.kind === "area" || b.kind === "side" || b.surfaces ? { ...b, surfaces: (b.surfaces ?? []).map((s) => ({ ...s, coats })) } : b));
      return { ok: true, doc: withState(patched.doc, { blocks }), note: `${coats} coat${coats === 1 ? "" : "s"} on every surface.` };
    }
    case "condition.damage": {
      const n = num(value);
      if (n == null || n < 0 || n > 3) return { ok: false, reason: "Damage is 0 (none), 1 (minor), 2 (a few areas) or 3 (real need)." };
      return patchDraft({ details: { damageTier: Math.round(n) } });
    }
    case "ext.storeys": {
      const s = oneOf(value, ["single", "double"] as const);
      if (!s) return { ok: false, reason: "Single storey or double?" };
      return patchDraft({ exterior: { storeys: s } });
    }
    case "ext.substrates": {
      const list = (Array.isArray(value) ? value : [value]).map(String).filter((s) => ["weatherboards", "render", "concrete", "brick"].includes(s)) as NonNullable<WizardState["exterior"]>["substrates"];
      if (list.length === 0) return { ok: false, reason: "Weatherboards, render, brick or concrete?" };
      return patchDraft({ exterior: { substrates: list } });
    }
    case "ext.painting": {
      const v = obj(value);
      const painting = { body: bool(v.body) ?? true, windowsDoors: bool(v.windowsDoors) ?? true, roofline: bool(v.roofline) ?? true, garage: bool(v.garage) ?? false };
      if (!Object.values(painting).some(Boolean)) return { ok: false, reason: "Tick at least one thing we're painting outside." };
      return patchDraft({ exterior: { painting } });
    }
    case "ext.condition": {
      const c = oneOf(value, ["good", "weathered", "peeling"] as const);
      if (!c) return { ok: false, reason: "Good, weathered, or peeling?" };
      return patchDraft({ exterior: { condition: c } });
    }
    case "ext.access": {
      const list = (Array.isArray(value) ? value : [value]).map(String).filter((s) => ["steep", "tight", "high"].includes(s)) as NonNullable<WizardState["exterior"]>["access"];
      if (!built) return patchDraft({ exterior: { access: list } }, { accessAnswered: true });
      // After the build: the same review flags the wizard path raises at build.
      const wording: Record<string, string> = { steep: "steep block", tight: "tight side access", high: "double-height entry" };
      const extra = list.map((acc) => ({ room: "Exterior", areaId: null, what: wording[acc], count: 1, needs: "access affects setup time — allow for it at review" }));
      const next = withAgent(patchWizardState(doc, (st) => ({ ...st, exterior: st.exterior ? { ...st.exterior, access: list } : st.exterior })), { facts: { accessAnswered: true } });
      return { ok: true, doc: withState(next, { aiDeferred: [...docDeferred(next), ...extra] }) };
    }
    case "ext.photos": {
      if (value === "attached") return { ok: true, doc };
      if (value === "none" || bool(value) === false) return patchDraft({ exterior: { noPhotos: true } });
      return { ok: false, reason: "Photos come in through attach_document; say \"none\" to size it from the answers instead." };
    }
    case "occupied": {
      const b = bool(value);
      if (b == null) return { ok: false, reason: "Will anyone be living there while we paint — yes or no?" };
      let next = withAgent(doc, { facts: { occupied: b } });
      if (b && isBuilt(next)) {
        next = withState(next, { aiDeferred: [...docDeferred(next), { room: "Whole job", areaId: null, what: "occupied property", count: 1, needs: "allow for working around the household — confirm the occupied allowance at review" }] });
      }
      return { ok: true, doc: next };
    }
    case "paint.brand": {
      const list = (Array.isArray(value) ? value : [value]).map((x) => String(x).toLowerCase()).filter((s) => ["dulux", "haymes", "taubmans", "porters", "wattyl", "unsure"].includes(s)) as WizardState["paint"]["brands"];
      return patchPaint(doc, deps, { brands: list.length ? list : ["unsure"] });
    }
    case "paint.colours": {
      const v = oneOf(value, ["known", "advice"] as const) ?? (str(value).toLowerCase().includes("match") || str(value).toLowerCase().includes("advice") ? "advice" : bool(value) === true ? "known" : null);
      if (!v) return { ok: false, reason: "Do you know the colours (known), or want a colour match / advice?" };
      return patchPaint(doc, deps, { colourHelp: v });
    }
    case "door_style": return patchDoorStyle(doc, deps, value);
    case "window_style": return patchWindowStyle(doc, deps, value);
    case "ceiling_height": return patchCeilingHeight(doc, deps, value);
    case "condition.photos": {
      if (value === "attached") return { ok: true, doc };
      if (value === "not_sure" || value === "later") return { ok: true, doc: withAgent(doc, { facts: { photosDeferred: true } }) };
      return { ok: false, reason: "Photos come in through attach_document." };
    }
    default: break;
  }

  // ---- loop answers (the tree must exist) ------------------------------------
  if (!built) return { ok: false, reason: "The rooms aren't set up yet — a few more details first." };
  const blocks = docBlocks(doc);
  const deferred = [...docDeferred(doc)];
  let interior = docInterior(doc);
  let sides = docSides(doc);
  let siteCheck = doc.requiresSiteCheck;
  const nextId = (() => { let n = nextIdFrom(blocks); return () => n++; })();
  const finish = (nextBlocks: ScopeBlock[], note?: string): AnswerOutcome => ({
    ok: true, note,
    doc: { ...withState(doc, { blocks: nextBlocks, aiDeferred: deferred, interiorLoop: interior, sidesLoop: sides }), requiresSiteCheck: siteCheck },
  });
  const rb = blocks as unknown as RoomBlock[];
  const sb = blocks as unknown as SideBlock[];

  if (key === "surfaces.ceilings") {
    const add = bool(value) ?? (value === "add" ? true : value === "no" || value === "leave" ? false : null);
    if (add == null) return { ok: false, reason: "Add the ceilings — yes or no?" };
    let cur = blocks as unknown as Parameters<typeof applyToggle>[0];
    const snapshot = docWizard(doc);
    if (add) {
      for (const b of blocks) {
        if (b.kind !== "area" || b.type === "Exterior") continue;
        const r = applyToggle(cur, Number(b.id), "ceilings", true, snapshot, nextId);
        if (r.ok) cur = r.blocks;
      }
    }
    const withState2 = withAgent({ ...withState(doc, { blocks: cur, aiDeferred: deferred, interiorLoop: interior, sidesLoop: sides }), requiresSiteCheck: siteCheck }, { facts: { ceilingsUnstated: false } });
    return { ok: true, doc: add ? patchWizardState(withState2, (st) => ({ ...st, surfaces: st.surfaces.includes("ceilings") ? st.surfaces : [...st.surfaces, "ceilings"] })) : withState2, note: add ? "ceilings added to every room" : "ceilings left out" };
  }

  const room = key.match(/^room\.(\d+)\.(.+)$/);
  if (room) {
    const areaId = Number(room[1]); const q = room[2];
    const block = blocks.find((b) => b.kind === "area" && Number(b.id) === areaId);
    if (!block) return { ok: false, reason: "No such room." };
    if (q === "size") {
      if (value === "looks_right" || value === true || value === "yes") { const r = applyRoomSizeOk(rb, areaId); return r.ok ? finish(r.blocks as ScopeBlock[]) : { ok: false, reason: r.error }; }
      if (value === "not_sure" || value === null) { const r = applyRoomSizeNotSure(rb, areaId); return r.ok ? finish(r.blocks as ScopeBlock[], "size left at the typical default") : { ok: false, reason: r.error }; }
      const v = obj(value); const L = num(v.lengthM); const W = num(v.widthM);
      if (L == null || W == null) return { ok: false, reason: "Give me length and width in metres, or say \"looks right\" or \"not sure\"." };
      const before = { L: Number(block.L) || 0, W: Number(block.W) || 0 };
      const r = applyRoomDims(rb, areaId, L, W);
      if (!r.ok) return { ok: false, reason: r.error };
      const big = (o: number, n: number) => o > 0 && Math.abs(n - o) / o > 0.25;
      if (big(before.L, L) || big(before.W, W)) deferred.push({ room: String(block.name ?? "Room"), areaId, what: "size corrected by customer", count: 1, needs: `customer set this room to ${L} × ${W} m (was ${before.L} × ${before.W}) — sanity-check at review` });
      return finish(r.blocks as ScopeBlock[]);
    }
    if (q === "cupboards" || q === "cupboard_interiors") {
      const v = typeof value === "object" && value !== null ? obj(value) : { on: value };
      const on = bool(v.on);
      if (on == null) return { ok: false, reason: "Yes or no is all it takes." };
      const count = num(v.count);
      const r = q === "cupboards" ? applyCupboard(rb, areaId, on, count, nextId) : applyCupboardInterior(rb, areaId, on, count, nextId);
      return r.ok ? finish(r.blocks as ScopeBlock[]) : { ok: false, reason: r.error };
    }
    if (q === "surfaces") {
      if (value === true || value === "yes" || value === "looks_right") {
        return finish(blocks.map((b) => (b === block ? { ...b, customer: { ...(b.customer ?? { size: null, cup: null, confirmed: false }), surfacesOk: true } } : b)));
      }
      const keys = (Array.isArray(value) ? value : str(value).split(/[,\s]+/)).map(String).filter(Boolean);
      if (keys.length === 0) return { ok: false, reason: "Name the surfaces — walls, ceilings, doors, windows, skirting…" };
      const snapshot = docWizard(doc);
      let cur = blocks as unknown as Parameters<typeof applyToggle>[0];
      for (const k of keys) { const r = applyToggle(cur, areaId, k, true, snapshot, nextId); if (!r.ok) return { ok: false, reason: r.error }; cur = r.blocks; }
      return finish(cur as unknown as ScopeBlock[]);
    }
    if (q === "anything_else") {
      const text = str(value);
      if (!text || /^(no|none|nothing|nope|no thanks)\b/i.test(text)) {
        return finish(blocks.map((b) => (b === block ? { ...b, customerCustom: b.customerCustom ?? [] } : b)));
      }
      const r = addRoomCustom(rb, areaId, text);
      if (!r.ok) return { ok: false, reason: r.error };
      deferred.push({ room: String(block.name ?? "Room"), areaId, what: `custom surface: "${text.slice(0, 80)}"`, count: 1, needs: "price this WITH the customer — never silently", kind: "custom_surface" });
      siteCheck = true;
      return finish(r.blocks as ScopeBlock[], "noted as an amber item to price on the visit");
    }
    if (q === "presence") {
      const keep = bool(value) ?? (value === "keep" ? true : value === "remove" ? false : null);
      if (keep == null) return { ok: false, reason: "Keep this room, or remove it?" };
      if (!keep) {
        const r = removeItem(doc, areaId, null, "the brief didn't mention it");
        return r.ok ? { ok: true, doc: r.doc, note: `${block.name} removed` } : r;
      }
      const assumed = Array.isArray(block.assumedFields) ? (block.assumedFields as string[]) : [];
      return finish(blocks.map((b) => (b === block ? { ...b, assumedFields: assumed.filter((f) => f !== "presence") } : b)));
    }
    if (q === "confirm") {
      const cfg = CUPBOARD_BY_ROOM_TYPE[String(block.roomType ?? "")];
      const cupboardApplies = !!cfg && deps.ctx.rateItems.some((r) => r.code === cfg.code);
      const r = confirmRoom(rb, areaId, cupboardApplies);
      return r.ok ? finish(r.blocks as ScopeBlock[]) : { ok: false, reason: r.error };
    }
    return { ok: false, reason: "I don't know that room question." };
  }

  if (key === "sweep.dw_totals") {
    const ok = bool(value);
    interior = { ...interior, dwOk: ok ? true : null, done: { ...interior.done, dw: ok === true } };
    return finish(blocks, ok ? undefined : "tell me which room's doors or windows are off and I'll fix the count");
  }
  if (key === "sweep.missed_rooms") {
    const v = typeof value === "object" && value !== null ? obj(value) : { ans: value };
    const add = str(v.add);
    if (add) {
      interior = { ...interior, sweepAns: "added", done: { ...interior.done, sweep: true } };
      deferred.push({ room: "Interior", areaId: null, what: `sweep: "${add.slice(0, 50)}"`, count: 1, needs: "named in the final sweep — price it with the customer before send", kind: "custom_surface" });
      siteCheck = true;
      return finish(blocks, "noted as an amber item");
    }
    interior = { ...interior, sweepAns: "none", done: { ...interior.done, sweep: true } };
    return finish(blocks);
  }

  const side = key.match(/^side\.(front|left|right|back)\.(.+)$/);
  if (side) {
    const sk = side[1] as SideKey; const q = side[2];
    if (q === "include") {
      const inc = bool(value);
      if (inc == null) return { ok: false, reason: "Are we painting this side — yes or no?" };
      const r = applySideInclude(sb, sk, inc);
      if (!r.ok) return { ok: false, reason: r.error };
      if (!inc) deferred.push({ room: `Exterior - ${sk}`, areaId: null, what: "side excluded", count: 1, needs: `customer chose not to paint the ${sk} — show it as an exclusion on the quote` });
      return finish(r.blocks as ScopeBlock[]);
    }
    if (q === "size") {
      if (value === "looks_right" || value === true || value === "yes") { const r = applySideSizeOk(sb, sk); return r.ok ? finish(r.blocks as ScopeBlock[]) : { ok: false, reason: r.error }; }
      if (value === "not_sure" || value === null) {
        const r = applySideDims(sb, sk, { notSure: true });
        if (!r.ok) return { ok: false, reason: r.error };
        deferred.push({ room: `Exterior - ${sk}`, areaId: null, what: "side measurements", count: 1, needs: "customer isn't sure of this side's size — we'll measure on the day" });
        return finish(r.blocks as ScopeBlock[], "we'll measure it on the day");
      }
      const v = obj(value);
      const r = applySideDims(sb, sk, { lengthM: num(v.lengthM), heightM: num(v.heightM) });
      return r.ok ? finish(r.blocks as ScopeBlock[]) : { ok: false, reason: r.error };
    }
    if (q === "wall_mix") {
      const shares = (Array.isArray(value) ? value : [value]).map(obj);
      let cur = sb;
      for (const s of shares) {
        const surfaceId = num(s.surfaceId); const pct = num(s.pct);
        if (surfaceId == null || ![25, 50, 75, 100].includes(pct ?? -1)) return { ok: false, reason: "Each wall surface needs a surfaceId and a share of 25, 50, 75 or 100." };
        const r = applyWallShare(cur, sk, surfaceId, pct as 25 | 50 | 75 | 100);
        if (!r.ok) return { ok: false, reason: r.error };
        cur = r.blocks;
      }
      return finish(cur as unknown as ScopeBlock[]);
    }
    if (q === "confirm") { const r = confirmSide(sb, sk); return r.ok ? finish(r.blocks as ScopeBlock[]) : { ok: false, reason: r.error }; }
    return { ok: false, reason: "I don't know that side question." };
  }

  if (key === "ext.cond_card") {
    const v = obj(value);
    const cond = oneOf(v.cond, ["good", "weathered", "peeling"] as const);
    const rot = oneOf(v.rot, ["no", "little", "lots"] as const);
    const acc = oneOf(v.acc, ["steep", "tight", "high", "none"] as const);
    sides = { ...sides, cond: { cond: cond ?? sides.cond.cond, rot: rot ?? sides.cond.rot, acc: acc ?? sides.cond.acc } };
    let cur = sb;
    const setAllowance = (def: { code: string; label: string }, on: boolean): boolean => {
      const r = rateFor(deps.ctx.rateItems, def.code);
      if (!r) return false;
      const res = toggleExtrasItem(cur, def.code, def.label, on, nextId, r.chargeOutDollars);
      if (res.ok) cur = res.blocks;
      return res.ok;
    };
    let modSel = { ...((doc.builderState.modSel as Record<string, string>) ?? {}) };
    // The build (applyExteriorAnswers) may already carry these flags; the
    // card confirms them, it does not double them.
    const pushOnce = (d: WizardDeferred) => { if (!deferred.some((x) => x.what === d.what && x.room === d.room)) deferred.push(d); };
    if (cond) {
      const hasWeathered = deps.ctx.modifiers.some((m) => m.code === WEATHERED_MODIFIER_CODE);
      const hasPoor = deps.ctx.modifiers.some((m) => m.code === INTERIOR_POOR_MODIFIER_CODE);
      const wiz = doc.builderState.wizard as { state?: { jobType?: string; details?: { damageTier?: number } } } | undefined;
      const interiorPoor = (wiz?.state?.details?.damageTier ?? 0) >= 2 && wiz?.state?.jobType !== "exterior";
      const drop = () => { const { Condition: _c, ...rest } = modSel; void _c; modSel = rest; };
      // Peeling = the card's "Poor — flaking / peeling" (Tom, 3 Sep) — priced
      // up front like the wizard does, and the visit deferral still stands.
      if (cond === "peeling" && hasPoor) modSel = { ...modSel, Condition: INTERIOR_POOR_MODIFIER_CODE };
      else if (cond === "weathered" && hasWeathered && !(interiorPoor && modSel.Condition === INTERIOR_POOR_MODIFIER_CODE)) modSel = { ...modSel, Condition: WEATHERED_MODIFIER_CODE };
      else if (modSel.Condition === WEATHERED_MODIFIER_CODE) drop();
      else if (modSel.Condition === INTERIOR_POOR_MODIFIER_CODE && !interiorPoor) drop();
      if (cond === "weathered" && !hasWeathered) pushOnce({ room: "Exterior", areaId: null, what: "weathered paintwork", count: 1, needs: "extra preparation allowed for — confirm the prep scope at review" });
      if (cond === "peeling") { pushOnce({ room: "Exterior", areaId: null, what: "peeling & flaking paint", count: 1, needs: "needs eyes on it — lead-safe check on the visit if pre-1970" }); siteCheck = true; }
    }
    if (rot) {
      const priced = setAllowance(ALLOWANCE_CODES.rot, rot === "little");
      if (rot === "little" && !priced) pushOnce({ room: "Exterior", areaId: null, what: "minor fascia rot", count: 1, needs: "allow minor fascia prep — confirm extent at review" });
      if (rot === "lots") { pushOnce({ room: "Exterior", areaId: null, what: "fascia rot", count: 1, needs: "rot repair needs eyes on it — confirm the roofline scope on the visit" }); siteCheck = true; }
    }
    if (acc) {
      const priced = setAllowance(ALLOWANCE_CODES.access, acc !== "none");
      if (acc !== "none" && !priced) pushOnce({ room: "Exterior", areaId: null, what: `access: ${acc}`, count: 1, needs: "access affects setup time — allow for it at review" });
    }
    const all = sides.cond.cond != null && sides.cond.rot != null && sides.cond.acc != null;
    sides = { ...sides, done: { ...sides.done, cond: all } };
    const out = finish(cur as unknown as ScopeBlock[]);
    return out.ok ? { ...out, doc: withState(out.doc, { modSel }) } : out;
  }
  if (key === "ext.freestanding") {
    if (value === "none" || (Array.isArray(value) && value.length === 0)) {
      sides = { ...sides, extrasAns: "none", done: { ...sides.done, extras: true } };
      return finish(blocks);
    }
    const keys = (Array.isArray(value) ? value : [value]).map(String).filter((k) => FREESTANDING_EXTRA_KEYS.includes(k));
    if (keys.length === 0) return { ok: false, reason: "Deck, fence, pergola or balustrade — or \"none\"." };
    let cur = blocks as unknown as Parameters<typeof applyExteriorToggle>[0];
    for (const k of keys) { const r = applyExteriorToggle(cur, k, true, nextId); if (!r.ok) return { ok: false, reason: r.error }; cur = r.blocks; }
    sides = { ...sides, extrasAns: hasFreestandingExtras(cur) ? "some" : sides.extrasAns, done: { ...sides.done, extras: true } };
    return finish(cur as unknown as ScopeBlock[]);
  }
  if (key === "sweep.ext_dw_totals") {
    const ok = bool(value);
    sides = { ...sides, dwOk: ok ? true : null, done: { ...sides.done, dw: ok === true } };
    return finish(blocks, ok ? undefined : "tell me which side's doors or windows are off and I'll fix the count");
  }
  if (key === "sweep.ext_missed") {
    const v = typeof value === "object" && value !== null ? obj(value) : { ans: value };
    const add = str(v.add);
    if (add) {
      sides = { ...sides, sweepAns: "added", done: { ...sides.done, sweep: true } };
      deferred.push({ room: "Exterior", areaId: null, what: `sweep: "${add.slice(0, 50)}"`, count: 1, needs: "named in the final sweep — price it with the customer before send", kind: "custom_surface" });
      siteCheck = true;
      return finish(blocks, "noted as an amber item");
    }
    sides = { ...sides, sweepAns: "none", done: { ...sides.done, sweep: true } };
    return finish(blocks);
  }

  void stamp;
  return { ok: false, reason: `I don't know the question "${key}".` };
}

// ---- post-build tightening patches --------------------------------------------

function patchWizardState(doc: ScopeDoc, patch: (s: WizardState) => WizardState): ScopeDoc {
  const s = docWizard(doc);
  if (!s) return doc;
  const w = (doc.builderState.wizard ?? {}) as Obj;
  return withState(doc, { wizard: { ...w, state: patch(s) } });
}

function patchPaint(doc: ScopeDoc, deps: ScopeDeps, patch: Partial<WizardState["paint"]>): AnswerOutcome {
  if (!isBuilt(doc)) {
    const a = docAnswers(doc);
    const next = withAgent(doc, { answers: deepMerge(a, { paint: patch }) });
    const r = tryBuild(next, deps);
    return { ok: true, doc: r.doc, built: r.built };
  }
  return { ok: true, doc: patchWizardState(doc, (s) => ({ ...s, paint: { ...s.paint, ...patch } })) };
}

export function patchDoorStyle(doc: ScopeDoc, deps: ScopeDeps, value: unknown): AnswerOutcome {
  const style = oneOf(value, ["flat", "panel", "unsure"] as const) ?? (str(value).toLowerCase().includes("panel") ? "panel" : str(value).toLowerCase().includes("flat") ? "flat" : null);
  if (!style) return { ok: false, reason: "Flat or panelled?" };
  if (!isBuilt(doc)) {
    const r = tryBuild(withAgent(doc, { answers: deepMerge(docAnswers(doc), { details: { doorStyle: style } }) }), deps);
    return { ok: true, doc: r.doc, built: r.built };
  }
  if (style === "unsure") return { ok: true, doc };
  // Swap every assumed-style door line to the answered face; counts stay.
  const blocks = docBlocks(doc).map((b) => {
    if (b.kind !== "area" || b.type === "Exterior") return b;
    return { ...b, surfaces: (b.surfaces ?? []).map((s) => {
      const code = String(s.code ?? "");
      const face = doorStyleOfCode(code);
      const assumed = Array.isArray(s.assumedFields) ? (s.assumedFields as string[]) : [];
      if (!face || !assumed.includes("style")) return s;
      const scope = doorScopeOfCode(code) ?? "frame";
      const nextCode = doorCodeFor(style, scope);
      if (!nextCode) return s;
      return { ...s, code: nextCode, internalLabel: doorLineLabel(style, scope), origin: "customer_stated", assumedFields: assumed.filter((f) => f !== "style") };
    }) };
  });
  const deferred = docDeferred(doc).filter((d) => d.what !== "door style to confirm");
  const next = withState(patchWizardState(doc, (s) => ({ ...s, details: { ...s.details, doorStyle: style } })), { blocks, aiDeferred: deferred });
  return { ok: true, doc: next };
}

export function patchWindowStyle(doc: ScopeDoc, deps: ScopeDeps, value: unknown): AnswerOutcome {
  const style = oneOf(value, ["casement", "sash", "colonial", "winder", "unsure"] as const);
  if (!style) return { ok: false, reason: "Casement, sash, colonial or winder?" };
  if (!isBuilt(doc)) {
    const r = tryBuild(withAgent(doc, { answers: deepMerge(docAnswers(doc), { details: { windowStyle: style } }) }), deps);
    return { ok: true, doc: r.doc, built: r.built };
  }
  if (style === "unsure") return { ok: true, doc };
  const code = windowRateCode(windowStyleToSchema(style));
  if (!code) return { ok: false, reason: "That window type isn't on the rate card." };
  const WINDOW_CODES = new Set(["Fixed / Picture / Window Reveal", "Awning / Casement Window", "Double Hung Sash", "Colonial / Bay Window"]);
  const blocks = docBlocks(doc).map((b) => {
    if (b.kind !== "area" || b.type === "Exterior") return b;
    return { ...b, surfaces: (b.surfaces ?? []).map((s) => {
      const assumed = Array.isArray(s.assumedFields) ? (s.assumedFields as string[]) : [];
      if (!WINDOW_CODES.has(String(s.code ?? "")) || !assumed.includes("style")) return s;
      return { ...s, code, internalLabel: windowStyleLabel(style), origin: "customer_stated", assumedFields: assumed.filter((f) => f !== "style") };
    }) };
  });
  const deferred = docDeferred(doc).filter((d) => d.what !== "window style to confirm");
  return { ok: true, doc: withState(patchWizardState(doc, (s) => ({ ...s, details: { ...s.details, windowStyle: style } })), { blocks, aiDeferred: deferred }) };
}

export function patchCeilingHeight(doc: ScopeDoc, deps: ScopeDeps, value: unknown): AnswerOutcome {
  const choice = oneOf(value, ["2.4", "2.7", "3.0", "unsure"] as const) ?? (num(value) != null ? (String(num(value)) as "2.4" | "2.7" | "3.0") : null);
  if (!choice || !["2.4", "2.7", "3.0", "unsure"].includes(choice)) return { ok: false, reason: "2.4, 2.7 or 3.0 metres — or \"not sure\"." };
  if (!isBuilt(doc)) {
    const r = tryBuild(withAgent(doc, { answers: deepMerge(docAnswers(doc), { details: { ceilingHeight: choice } }) }), deps);
    return { ok: true, doc: r.doc, built: r.built };
  }
  if (choice === "unsure") return { ok: true, doc };
  const h = Number(choice);
  // Mirrors the route's confirm_height: interior rooms only, H assumption cleared.
  const blocks = docBlocks(doc).map((b) => {
    if (b.kind !== "area" || b.type === "Exterior" || b.areaType === "surface") return b;
    const assumed = Array.isArray(b.assumedFields) ? (b.assumedFields as string[]) : [];
    return { ...b, H: h, assumedFields: assumed.filter((f) => f !== "H") };
  });
  return { ok: true, doc: withState(patchWizardState(doc, (s) => ({ ...s, details: { ...s.details, ceilingHeight: choice } })), { blocks }) };
}

// ---- tree edits the tools expose directly -------------------------------------

export function addArea(doc: ScopeDoc, deps: ScopeDeps, name: string | null, roomType: string, lengthM: number | null, widthM: number | null): AnswerOutcome & { areaId?: number } {
  if (!isBuilt(doc)) return { ok: false, reason: "The rooms aren't set up yet — a few more details first." };
  const rules = deps.refs.rules;
  if (!rules.some((r) => r.room_type === roomType)) return { ok: false, reason: `I don't have a standard scope for a "${roomType}" — name it in "anything else" and we'll price it on the visit.` };
  const blocks = docBlocks(doc);
  const existing = new Set(blocks.map((b) => String(b.name ?? "").trim().toLowerCase()));
  let label = name?.trim() || roomType.replace(/_/g, " ").replace(/^./, (c) => c.toUpperCase());
  for (let n = 2; existing.has(label.trim().toLowerCase()); n++) label = `${(name?.trim() || label).replace(/ \d+$/, "")} ${n}`;
  const groundH = blocks.find((b) => b.kind === "area" && Number(b.H) > 0)?.H;
  const heightM = typeof groundH === "number" && groundH > 0 ? groundH : null;
  let next = nextIdFrom(blocks);
  const x = starterExtraction([{ name: label, roomType, storey: "Ground" }], deps.refs.typicals, { heightM, bedrooms: 0 });
  const draft = buildDraft(x, rules, deps.refs.aliases, { startId: next });
  markStarterProvenance(draft.areas);
  next = Math.max(next, ...draft.areas.flatMap((a) => [a.id, ...a.surfaces.map((s) => s.id)])) + 1;
  const snapshot = docWizard(doc);
  const roomDraft = { areas: draft.areas, skipped: draft.skipped, assumedCount: draft.assumedCount, deferred: draft.deferred };
  const merged = snapshot ? applyWizardAnswers(roomDraft, snapshot, () => next++) : roomDraft;
  if (merged.areas.length === 0) return { ok: false, reason: "Nothing is selected for that room type on this job." };
  const areas = merged.areas.map((a) => (lengthM != null && widthM != null ? { ...a, L: lengthM, W: widthM, origin: "customer_stated", assumedFields: a.assumedFields.filter((f) => f !== "L" && f !== "W") } : a));
  const addedIds = new Set(areas.map((a) => a.id));
  const deferred = [...docDeferred(doc), ...merged.deferred.filter((d) => d.areaId != null && addedIds.has(d.areaId))];
  const interior = { ...docInterior(doc), sweepAns: "added" as const };
  return { ok: true, areaId: areas[0].id, doc: withState(doc, { blocks: [...blocks, ...(areas as unknown as ScopeBlock[])], aiDeferred: deferred, interiorLoop: interior }) };
}

export function addSurface(doc: ScopeDoc, deps: ScopeDeps, areaId: number, code: string, count: number | null): AnswerOutcome & { surfaceId?: number } {
  const blocks = docBlocks(doc);
  const block = blocks.find((b) => b.kind === "area" && Number(b.id) === areaId);
  if (!block) return { ok: false, reason: "No such room." };
  const nextId = (() => { let n = nextIdFrom(blocks); return () => n++; })();
  if (block.type === "Exterior") {
    const item = deps.ctx.rateItems.find((r) => r.code === code && r.category === "Exterior");
    if (!item) return { ok: false, reason: "That surface isn't on our rate card — name it and we'll price it on the visit." };
    const sideKey = (["front", "left", "right", "back"] as SideKey[]).find((k) => new RegExp(k === "back" ? "rear|back" : k, "i").test(String(block.name ?? "")));
    if (!sideKey) return { ok: false, reason: "That exterior area isn't one of the four sides." };
    const r = addSideSurface(blocks as unknown as SideBlock[], sideKey, code, item.code, nextId, perItemChargeOut(deps.ctx.rateItems, "Exterior", code));
    if (!r.ok) return { ok: false, reason: r.error };
    const added = (r.blocks.find((b) => Number(b.id) === areaId)?.surfaces ?? []).at(-1);
    return { ok: true, surfaceId: Number(added?.id) || 0, doc: withState(doc, { blocks: r.blocks }) };
  }
  const item = deps.ctx.rateItems.find((r) => r.code === code && r.category === "Interior");
  if (!item) return { ok: false, reason: "That surface isn't on our rate card — name it and we'll price it on the visit." };
  // The twice-fixed trap: per-item charge-out (Air Vent $180/h × 0.25 h) —
  // pinned only where the row differs from its category base.
  let r = addCatalogueLine(blocks as unknown as RoomBlock[], areaId, code, item.code, nextId, perItemChargeOut(deps.ctx.rateItems, "Interior", code));
  if (!r.ok) return { ok: false, reason: r.error };
  const added = (r.blocks.find((b) => Number(b.id) === areaId)?.surfaces ?? []).at(-1);
  const surfaceId = Number(added?.id) || 0;
  if (count != null && count > 0 && surfaceId) {
    r = applyLineCount(r.blocks, areaId, surfaceId, Math.round(count));
    if (!r.ok) return { ok: false, reason: r.error };
  }
  return { ok: true, surfaceId, doc: withState(doc, { blocks: r.blocks }) };
}

export function setCount(doc: ScopeDoc, areaId: number, surfaceId: number, count: number): AnswerOutcome {
  const blocks = docBlocks(doc);
  const block = blocks.find((b) => b.kind === "area" && Number(b.id) === areaId);
  if (!block) return { ok: false, reason: "No such room." };
  const sideKey = block.type === "Exterior" ? (["front", "left", "right", "back"] as SideKey[]).find((k) => new RegExp(k === "back" ? "rear|back" : k, "i").test(String(block.name ?? ""))) : null;
  const r = sideKey ? applySideCount(blocks as unknown as SideBlock[], sideKey, surfaceId, Math.round(count)) : applyLineCount(blocks as unknown as RoomBlock[], areaId, surfaceId, Math.round(count));
  return r.ok ? { ok: true, doc: withState(doc, { blocks: r.blocks }) } : { ok: false, reason: r.error };
}

export function removeItem(doc: ScopeDoc, areaId: number, surfaceId: number | null, reason: string | null): AnswerOutcome {
  const blocks = docBlocks(doc);
  const block = blocks.find((b) => b.kind === "area" && Number(b.id) === areaId);
  if (!block) return { ok: false, reason: "No such room." };
  if (surfaceId != null) {
    const sideKey = block.type === "Exterior" ? (["front", "left", "right", "back"] as SideKey[]).find((k) => new RegExp(k === "back" ? "rear|back" : k, "i").test(String(block.name ?? ""))) : null;
    const r = sideKey ? removeSideLine(blocks as unknown as SideBlock[], sideKey, surfaceId) : removeLine(blocks as unknown as RoomBlock[], areaId, surfaceId);
    return r.ok ? { ok: true, doc: withState(doc, { blocks: r.blocks }) } : { ok: false, reason: r.error };
  }
  if (blocks.filter((b) => b.kind === "area").length <= 1) return { ok: false, reason: "That's the last room — an estimate needs at least one." };
  const deferred = [...docDeferred(doc).filter((d) => d.areaId == null || d.areaId !== areaId),
    { room: String(block.name ?? "Room"), areaId: null, what: "area excluded", count: 1, needs: `${reason?.trim() || "customer chose not to paint it"} — show as an exclusion on the quote` }];
  return { ok: true, doc: withState(doc, { blocks: blocks.filter((b) => !(b.kind === "area" && Number(b.id) === areaId)), aiDeferred: deferred }) };
}

export function addCustomLine(doc: ScopeDoc, areaId: number | null, text: string): AnswerOutcome & { ref?: string } {
  const blocks = docBlocks(doc);
  const block = areaId != null ? blocks.find((b) => b.kind === "area" && Number(b.id) === areaId) : null;
  if (areaId != null && !block) return { ok: false, reason: "No such room." };
  const clean = text.trim().slice(0, 300);
  const entry: WizardDeferred = block
    ? { room: String(block.name ?? "Room"), areaId, what: `custom surface: "${clean.slice(0, 80)}"`, count: 1, needs: "price this WITH the customer — never silently", kind: "custom_surface" }
    : { room: "Whole job", areaId: null, what: "customer note", count: 1, needs: `"${clean}" — price this WITH the customer, never silently`, kind: "custom_surface" };
  let nextBlocks = blocks;
  if (block && block.type !== "Exterior") {
    const r = addRoomCustom(blocks as unknown as RoomBlock[], areaId as number, clean);
    if (r.ok) nextBlocks = r.blocks as unknown as ScopeBlock[];
  }
  const ref = `note:${docDeferred(doc).length + 1}`;
  return { ok: true, ref, doc: { ...withState(doc, { blocks: nextBlocks, aiDeferred: [...docDeferred(doc), entry] }), requiresSiteCheck: true } };
}

// ---- util -------------------------------------------------------------------------

function deepMerge<T extends object>(base: T, patch: object): T {
  const out: Obj = { ...(base as Obj) };
  for (const [k, v] of Object.entries(patch as Obj)) {
    const cur = out[k];
    out[k] = v && typeof v === "object" && !Array.isArray(v) && cur && typeof cur === "object" && !Array.isArray(cur)
      ? deepMerge(cur as object, v as object)
      : v;
  }
  return out as T;
}

// ---- co-work: the pending proposal ------------------------------------------------
//
// Staff never edit someone else's estimate live (parent §3.2): every co-work
// mutation lands on a PENDING copy of the builder state, kept under
// builder_state.agent.pending, and `apply` commits it. The customer's own
// guided build has no gate (Addendum A §3.3) and never uses this.

const TREE_KEYS = ["blocks", "aiDeferred", "modSel", "interiorLoop", "sidesLoop", "wizard", "storeyHeights"] as const;

export function pendingOf(doc: ScopeDoc): ScopeDoc | null {
  const pending = agentOf(doc) as { pending?: Record<string, unknown> | null };
  if (!pending.pending) return null;
  const agent = { ...(doc.builderState.agent as Obj), pending: null };
  return {
    ...doc,
    requiresSiteCheck: Boolean(pending.pending._requiresSiteCheck ?? doc.requiresSiteCheck),
    builderState: { ...doc.builderState, ...pending.pending, agent: { ...agent, answers: (pending.pending._answers as AnswerDraft) ?? agentOf(doc).answers ?? {} } },
  };
}

/** What a proposal said about itself — kept with it so the panel can show
 *  the same fill-ins and the same "instructions ignored" line after a reload. */
export type PendingMeta = { fillIns?: unknown[]; injectedInstructions?: string[]; unmapped?: string[] };

/** Store `working` as the pending proposal on `doc`. */
export function withPending(doc: ScopeDoc, working: ScopeDoc, meta?: PendingMeta): ScopeDoc {
  const pending: Obj = {};
  for (const k of TREE_KEYS) if (k in working.builderState) pending[k] = working.builderState[k];
  pending._requiresSiteCheck = working.requiresSiteCheck;
  pending._answers = docAnswers(working);
  const prior = (agentOf(doc) as { pendingMeta?: PendingMeta }).pendingMeta;
  return withState(doc, { agent: { ...(doc.builderState.agent as Obj), pending, pendingMeta: meta ?? prior ?? null } });
}

export function pendingMetaOf(doc: ScopeDoc): PendingMeta {
  return ((agentOf(doc) as { pendingMeta?: PendingMeta | null }).pendingMeta) ?? {};
}

/** Commit the pending proposal into the live tree. */
export function applyPending(doc: ScopeDoc, appliedBy: string | null): ScopeDoc | null {
  const working = pendingOf(doc);
  if (!working) return null;
  const agent = (doc.builderState.agent ?? {}) as Obj;
  const applied = Array.isArray(agent.appliedDiffs) ? (agent.appliedDiffs as unknown[]) : [];
  const next: Obj = { ...doc.builderState };
  for (const k of TREE_KEYS) if (k in working.builderState) next[k] = working.builderState[k];
  next.agent = { ...agent, answers: docAnswers(working), pending: null, pendingMeta: null, appliedDiffs: [...applied, { at: new Date().toISOString(), by: appliedBy }] };
  return { ...doc, requiresSiteCheck: working.requiresSiteCheck, builderState: next };
}

/** The wizard's page-2 exterior ticks, derived from the assistant's answers
 *  (substrates + what we're painting). Before this an exterior built from
 *  answers scaffolded ONE weatherboard line per side and no trims, windows
 *  or doors — "weatherboards and render, windows and doors, roofline" landed
 *  as four bare walls (Tom, 3 Sep). */
export function exteriorTicks(draft: AnswerDraft): string[] {
  const ext = draft.exterior ?? {};
  const painting = ext.painting ?? { body: true, windowsDoors: true, roofline: true, garage: false };
  const ticks = new Set<string>();
  for (const sub of ext.substrates?.length ? ext.substrates : ["weatherboards"]) ticks.add(sub);
  if (painting.roofline) for (const t of ["fascias", "gutters", "eaves", "downpipes"]) ticks.add(t);
  if (painting.windowsDoors) { ticks.add("exterior_windows"); ticks.add("exterior_doors"); }
  if (painting.garage) ticks.add("garage_doors");
  return [...ticks];
}
