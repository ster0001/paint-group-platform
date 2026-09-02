/**
 * S3 — the tools bound to the scope document, the editor's loop functions
 * and lib/pricing. This is the ONLY place the assistant's numbers come from:
 * `price_scope` prices with the same editorPayload / guardrails / bands the
 * wizard-edit route uses, then adds the Addendum A assumption list with its
 * $ swings and the R4 "may a number be shown" verdict.
 *
 * Unbound tools (documents, Brain, visits, handoff — later sessions) fall
 * through to the executor passed as `fallback` (NoopTools in S3).
 */

import { editorPayload } from "@/lib/wizard/view";
import { loopConfirmState } from "@/lib/wizard/confirm-state";
import { adjustmentsFrom } from "@/lib/pricing/context";
import { chargeOutCents, priceEstimateTotals, type BlockInput } from "@/lib/pricing/estimate";
import {
  GUARDRAIL_MESSAGES, answersFromState, bandsFromSettings, evaluateGuardrails, policyFromSettings,
  rangeBandPct, rangeFromTotal, serviceAreaFromSettings, settingValue,
} from "@/lib/wizard/policy";
import { visitReason } from "@/lib/wizard/sides";
import { substrateKeyForRateCode } from "@/lib/estimate/substrates";
import { CUPBOARD_INTERIOR_BY_ROOM_TYPE, applyCupboardInterior, type LooseBlock as RoomBlock } from "@/lib/wizard/rooms-loop";
import { gapsFor, nextGap } from "./question-graph";
import {
  addArea, addCustomLine, addSurface, applyAnswer, docBlocks, docDeferred, docFacts, docInterior, docSides, docWizard,
  graphInput, isBuilt, patchCeilingHeight, patchDoorStyle, patchWindowStyle, removeItem, setCount,
  type ScopeDeps, type ScopeDoc,
} from "./scope-doc";
import { ok, refused, type Assumption, type PriceScopeResult, type ToolContext, type ToolExecutor, type ToolResult } from "./schemas";
import type { ScopeStore } from "./scope-store";
import type { AgentSettings, SupportHours } from "./settings";

type In = Record<string, unknown>;

export class ScopeTools implements ToolExecutor {
  constructor(
    private readonly store: ScopeStore,
    private readonly settings: AgentSettings,
    private readonly fallback: ToolExecutor,
    private readonly now: () => Date = () => new Date(),
  ) {}

  async execute(name: string, input: unknown, ctx: ToolContext): Promise<ToolResult> {
    const i = (input ?? {}) as In;
    switch (name) {
      case "get_support_hours": return ok(supportHoursState(this.settings.supportHours, this.now()));
      case "hard_stop": return this.hardStop(i, ctx);
      case "emit_crm_event": {
        try {
          const id = await this.store.logCrmEvent({ type: String(i.type) as never, payload: (i.payload as object) ?? {}, accountId: ctx.accountId, estimateId: ctx.estimateId, source: "ai" });
          return ok({ eventId: id });
        } catch (e) {
          return refused(`I couldn't record that: ${e instanceof Error ? e.message : "bad event"}`);
        }
      }
      default: break;
    }
    if (!SCOPE_TOOLS.has(name)) return this.fallback.execute(name, input, ctx);

    if (!ctx.estimateId) return refused("There's no estimate to work on yet.");
    const doc = await this.store.load(ctx.estimateId);
    if (!doc) return refused("I can't find that estimate.");
    if (doc.status === "accepted") return refused("This estimate is accepted and locked — a person can open a variation for you.");
    const deps: ScopeDeps = { refs: await this.store.refs(), ctx: await this.store.ctx(), actor: ctx.view === "staff" ? "staff" : "customer" };

    const commit = async (r: { ok: true; doc: ScopeDoc; note?: string } & Record<string, unknown>, data: Record<string, unknown>) => {
      await this.store.save(r.doc);
      return ok({ ...data, ...(r.note ? { note: r.note } : {}) });
    };

    switch (name) {
      case "get_scope": return ok(scopeView(doc, deps));
      case "next_gap": return ok({ gap: nextGap(graphInput(doc, deps, ctx.mode === "cowork" ? "cowork" : "guided", assumptionSwings(doc, deps))) });
      case "list_gaps": return ok({ gaps: gapsFor(graphInput(doc, deps, ctx.mode === "cowork" ? "cowork" : "guided", assumptionSwings(doc, deps))) });
      case "answer_gap": {
        let r = applyAnswer(doc, String(i.key), i.value, i.provenance as never, deps);
        if (!r.ok) return refused(r.reason);
        // An address is checked against the service area the moment it lands
        // (§4 step 1) — an empty list means the check is not configured.
        if (String(i.key) === "q.address") {
          const postcodes = serviceAreaFromSettings(settingValue(deps.ctx.settings, "service_area"));
          const pc = String(((i.value ?? {}) as { postcode?: unknown }).postcode ?? "").trim();
          const inside = postcodes.length === 0 ? true : postcodes.includes(pc);
          const checked = applyAnswer(r.doc, "q.service_area", inside, i.provenance as never, deps);
          if (checked.ok) r = { ...checked, built: r.built };
        }
        return commit(r, { applied: true, key: String(i.key), ...(r.built ? { built: true } : {}) });
      }
      case "add_area": {
        const r = addArea(doc, deps, (i.name as string) ?? null, String(i.roomType ?? "").toLowerCase().replace(/\s+/g, "_"), (i.lengthM as number | null) ?? null, (i.widthM as number | null) ?? null);
        if (!r.ok) return refused(r.reason);
        return commit(r, { areaId: r.areaId });
      }
      case "add_surface": {
        const r = addSurface(doc, deps, Number(i.areaId), String(i.code), (i.count as number | null) ?? null);
        if (!r.ok) return refused(r.reason);
        return commit(r, { surfaceId: r.surfaceId });
      }
      case "set_count": {
        const r = setCount(doc, Number(i.areaId), Number(i.surfaceId), Number(i.count));
        if (!r.ok) return refused(r.reason);
        return commit(r, { applied: true });
      }
      case "set_size": {
        const r = applyAnswer(doc, `room.${Number(i.areaId)}.size`, { lengthM: i.lengthM, widthM: i.widthM }, i.provenance as never, deps);
        if (!r.ok) {
          // Not a room? Try it as a side.
          const block = docBlocks(doc).find((b) => Number(b.id) === Number(i.areaId));
          const sideKey = block && block.type === "Exterior" ? (["front", "left", "right", "back"] as const).find((k) => new RegExp(k === "back" ? "rear|back" : k, "i").test(String(block.name ?? ""))) : null;
          if (!sideKey) return refused(r.reason);
          const s = applyAnswer(doc, `side.${sideKey}.size`, { lengthM: i.lengthM, heightM: i.widthM }, i.provenance as never, deps);
          if (!s.ok) return refused(s.reason);
          return commit(s, { applied: true });
        }
        return commit(r, { applied: true });
      }
      case "remove_item": {
        const r = removeItem(doc, Number(i.areaId), (i.surfaceId as number | null) ?? null, (i.reason as string | null) ?? null);
        if (!r.ok) return refused(r.reason);
        return commit(r, { removed: true });
      }
      case "add_custom_line": {
        const r = addCustomLine(doc, (i.areaId as number | null) ?? null, String(i.text ?? ""));
        if (!r.ok) return refused(r.reason);
        return commit(r, { ref: r.ref, amber: true, visitTier: true });
      }
      case "price_scope": return ok(priceScope(doc, deps));
      case "check_thresholds": return ok(checkThresholds(doc, deps));
      default: return this.fallback.execute(name, input, ctx);
    }
  }

  private async hardStop(i: In, ctx: ToolContext): Promise<ToolResult> {
    const kind = String(i.kind ?? "");
    const script = this.settings.hardStopScripts[kind];
    if (!script) return refused("That situation needs a person — I have flagged it for the office.");
    const nextState = kind === "out_of_area" ? "out_of_area"
      : kind === "lead_paint" || kind === "asbestos" || kind === "heritage" ? "visit_tier"
      : kind === "discount" || kind === "margin" ? "refuse" : "handoff";
    if (ctx.estimateId) {
      const doc = await this.store.load(ctx.estimateId);
      if (doc) {
        const deferred = [...docDeferred(doc), { room: "Whole job", areaId: null, what: `hard stop: ${kind.replace(/_/g, " ")}`, count: 1, needs: i.detail ? `"${String(i.detail).slice(0, 200)}" — scripted stop, visit tier` : "scripted stop — a person confirms before any fixed price" }];
        const agent = (doc.builderState.agent ?? {}) as { answers?: unknown; facts?: Record<string, unknown> };
        const delivered = Array.isArray(agent.facts?.stopsDelivered) ? (agent.facts!.stopsDelivered as string[]) : [];
        const facts = { ...(agent.facts ?? {}), stopsDelivered: [...new Set([...delivered, kind])], ...(kind === "out_of_area" ? { inServiceArea: false } : {}) };
        await this.store.save({ ...doc, requiresSiteCheck: nextState === "visit_tier" ? true : doc.requiresSiteCheck, builderState: { ...doc.builderState, aiDeferred: deferred, agent: { answers: agent.answers ?? {}, facts } } });
      }
    }
    return ok({ script, nextState });
  }
}

const SCOPE_TOOLS = new Set(["get_scope", "next_gap", "list_gaps", "answer_gap", "add_area", "add_surface", "set_count", "set_size", "remove_item", "add_custom_line", "price_scope", "check_thresholds"]);

// ---- views ---------------------------------------------------------------------

const PROV = new Set(["ai_extracted", "ai_derived", "ai_assumed", "customer_stated", "human_confirmed"]);
const prov = (o: unknown) => (typeof o === "string" && PROV.has(o) ? o : "ai_assumed");

export function scopeView(doc: ScopeDoc, _deps: ScopeDeps) {
  void _deps;
  const blocks = docBlocks(doc);
  const loop = loopConfirmState(blocks, docInterior(doc), docSides(doc));
  return {
    estimateId: doc.estimateId,
    areas: blocks.filter((b) => b.kind === "area").map((b) => ({
      id: Number(b.id) || 0, name: String(b.name ?? "Unnamed"), roomType: typeof b.roomType === "string" ? b.roomType : null,
      confirmed: b.customer?.confirmed === true, provenance: prov(b.origin),
      surfaces: (b.surfaces ?? []).map((s) => ({ id: Number(s.id) || 0, code: String(s.code ?? ""), label: String(s.internalLabel ?? s.code ?? ""), count: Number(s.count) || 1, provenance: prov(s.origin) })),
    })),
    confirmedAreaIds: [...loop.states.entries()].filter(([, st]) => st === "confirmed").map(([id]) => id),
  };
}

// ---- pricing -----------------------------------------------------------------------

function priced(doc: ScopeDoc, deps: ScopeDeps) {
  const blocks = docBlocks(doc);
  const state = docWizard(doc);
  const wantsInterior = state ? state.jobType !== "exterior" : blocks.some((b) => b.kind === "area" && b.type !== "Exterior");
  const wantsExterior = state ? state.jobType !== "interior" : blocks.some((b) => b.kind === "area" && b.type === "Exterior");
  const interior = wantsInterior ? docInterior(doc) : null;
  const sides = wantsExterior ? docSides(doc) : null;
  const loop = loopConfirmState(blocks, interior, sides);
  const adj = adjustmentsFrom(doc.builderState);
  const deferred = docDeferred(doc);
  const payload = editorPayload(blocks, deps.ctx, adj, deferred, loop);
  const totals = priceEstimateTotals(blocks as unknown as BlockInput[], deps.ctx, adj);
  const answers = state ? answersFromState(state) : answersFromState({ jobType: "interior", details: { damageTier: 1 }, customer: null });
  const trade = docFacts(doc).accountType === "trade";
  const decision = evaluateGuardrails(answers, payload.totals.totalCents, payload.accuracyPct, doc.requiresSiteCheck,
    policyFromSettings(settingValue(deps.ctx.settings, "wizard_policy")), serviceAreaFromSettings(settingValue(deps.ctx.settings, "service_area")), trade);
  const bands = bandsFromSettings(settingValue(deps.ctx.settings, "wizard_bands"));
  const bandPct = rangeBandPct(payload.accuracyPct, bands);
  const range = rangeFromTotal(payload.totals.totalCents, bandPct);
  const confirmedIds = [...loop.states.entries()].filter(([, st]) => st === "confirmed").map(([id]) => id);
  const allConfirmed = loop.states.size > 0 && [...loop.states.values()].every((st) => st === "confirmed");
  // The same rule as the graph: the doors & windows check exists only when
  // the tree has openings; a walls-and-ceilings job has one interior check.
  const hasRooms = blocks.some((b) => b.kind === "area" && b.type !== "Exterior");
  const hasOpenings = blocks.some((b) => b.kind === "area" && b.type !== "Exterior" && (b.surfaces ?? []).some((s) => ["doors", "windows"].includes(substrateKeyForRateCode(String(s.code ?? "")) ?? "")));
  const checksExpected = (interior && hasRooms ? (hasOpenings ? 2 : 1) : 0) + (sides && blocks.some((b) => b.kind === "area" && b.type === "Exterior" && b.areaType === "surface") ? 4 : 0);
  const sweepDone = loop.checksDone >= checksExpected;
  return { blocks, payload, totals, decision, bands, bandPct, range, confirmedIds, allConfirmed, sweepDone, trade, adj, interior, sides, deferred };
}

export function priceScope(doc: ScopeDoc, deps: ScopeDeps): PriceScopeResult {
  const p = priced(doc, deps);
  const built = isBuilt(doc);
  // R4 / D21: trade sees a range from the first price; residential only once
  // every area is confirmed and the sweep is done. Never through a guardrail.
  const showNumber = built && p.decision.outcome === "reveal" && (p.trade || (p.allConfirmed && p.sweepDone));
  const swings = assumptionSwings(doc, deps);
  const gaps = gapsFor(graphInput(doc, deps, "guided", swings));
  const assumptions: Assumption[] = gaps.filter((g) => g.kind === "tightening").map((g) => ({
    key: g.key, areaId: g.areaId, swingCents: g.swingCents ?? 0,
    ...assumptionLabel(g.key, g.areaId, p.blocks),
  }));
  const reviewFlags = [
    ...p.decision.reasons,
    ...(p.allConfirmed ? [] : ["areas_unconfirmed"]),
    ...(p.sweepDone ? [] : ["sweep_pending"]),
    ...p.deferred.filter((d) => d.kind === "custom_surface").map((d) => `custom:${d.what}`),
  ];
  const hours = p.totals.contractorHours;
  return {
    totalCents: p.payload.totals.totalCents,
    accuracyPct: p.payload.accuracyPct,
    bandPct: p.bandPct,
    loCents: p.range.loCents,
    hiCents: p.range.hiCents,
    chargeOutCentsPerHr: chargeOutCents(p.blocks.some((b) => b.type === "Exterior") ? "Exterior" : "Interior", deps.ctx.rateItems, p.adj.hourlyRateOverride ?? null),
    revenueCentsPerHr: hours > 0 ? Math.round(p.totals.netSubtotalCents / hours) : 0,
    reviewFlags,
    assumptions,
    showNumber,
    confirmedAreaIds: p.confirmedIds,
    allAreasConfirmed: p.allConfirmed && p.sweepDone,
  };
}

function assumptionLabel(key: string, areaId: number | null, blocks: ReturnType<typeof docBlocks>): { label: string; assumedValue: string } {
  const room = areaId != null ? String(blocks.find((b) => Number(b.id) === areaId)?.name ?? "") : "";
  if (key === "door_style") return { label: "Assumed: flat doors", assumedValue: "flat" };
  if (key === "window_style") return { label: "Assumed: casement windows", assumedValue: "casement" };
  if (key === "ceiling_height") return { label: "Assumed: 2.4 m ceilings", assumedValue: "2.4" };
  if (key.endsWith(".cupboard_interiors")) return { label: `Assumed: cupboard interiors not included${room ? ` (${room})` : ""}`, assumedValue: "excluded" };
  if (key === "paint.colours") return { label: "Assumed: colours to be confirmed", assumedValue: "tbc" };
  if (key === "condition.photos") return { label: "Assumed: minor prep until the photos are seen", assumedValue: "minor" };
  return { label: `Assumed: ${key}`, assumedValue: "default" };
}

/** The $ swing of each open assumption: price the tree with the alternative
 *  and diff. Only computed for assumptions the engine can price. */
export function assumptionSwings(doc: ScopeDoc, deps: ScopeDeps): Record<string, number> {
  if (!isBuilt(doc)) return {};
  const adj = adjustmentsFrom(doc.builderState);
  const totalOf = (d: ScopeDoc) => priceEstimateTotals(docBlocks(d) as unknown as BlockInput[], deps.ctx, adj).totalCents;
  const base = totalOf(doc);
  const out: Record<string, number> = {};
  const state = docWizard(doc);
  const diff = (r: { ok: boolean; doc?: ScopeDoc }) => (r.ok && r.doc ? Math.abs(totalOf(r.doc) - base) : 0);

  if (state && (state.details.doorStyle === "unsure" || state.details.doorStyle === "na")) out.door_style = diff(patchDoorStyle(doc, deps, "panel"));
  if (state && (state.details.windowStyle === "unsure" || state.details.windowStyle === "na")) {
    out.window_style = Math.max(...(["sash", "colonial", "casement"] as const).map((s) => diff(patchWindowStyle(doc, deps, s))));
  }
  if (state && state.details.ceilingHeight === "unsure") out.ceiling_height = diff(patchCeilingHeight(doc, deps, "2.7"));
  for (const b of docBlocks(doc)) {
    if (b.kind !== "area" || b.type === "Exterior") continue;
    const cfg = CUPBOARD_INTERIOR_BY_ROOM_TYPE[String(b.roomType ?? "")];
    if (!cfg || !deps.ctx.rateItems.some((r) => r.code === cfg.code) || b.customer?.cupInterior != null) continue;
    let n = 100000;
    const r = applyCupboardInterior(docBlocks(doc) as unknown as RoomBlock[], Number(b.id), true, null, () => n++);
    if (r.ok) out[`room.${Number(b.id)}.cupboard_interiors`] = Math.abs(priceEstimateTotals(r.blocks as unknown as BlockInput[], deps.ctx, adj).totalCents - base);
  }
  return out;
}

export function checkThresholds(doc: ScopeDoc, deps: ScopeDeps) {
  const p = priced(doc, deps);
  const flags = (settingValue(deps.ctx.settings, "scope_editor") ?? {}) as { selfServeInteriorCapCents?: number; selfServeExteriorCapCents?: number; selfServeMinAccuracy?: number };
  const hasExterior = p.blocks.some((b) => b.kind === "area" && b.type === "Exterior");
  const cap = hasExterior ? (flags.selfServeExteriorCapCents ?? 1_200_000) : (flags.selfServeInteriorCapCents ?? 600_000);
  const minAcc = flags.selfServeMinAccuracy ?? (hasExterior ? 85 : 90);
  const mid = (p.range.loCents + p.range.hiCents) / 2;
  if (p.decision.outcome !== "reveal") {
    return { outcome: "visit" as const, reasons: [GUARDRAIL_MESSAGES[p.decision.outcome] ?? GUARDRAIL_MESSAGES.handoff], accuracyPct: p.payload.accuracyPct, minAccuracyPct: minAcc, capCents: cap, guardrail: p.decision.outcome };
  }
  const selfServe = p.decision.canAccept && !p.decision.walkthroughRequired && p.payload.accuracyPct >= minAcc && mid <= cap;
  const reasons: string[] = [];
  if (!selfServe) {
    if (p.payload.accuracyPct < minAcc) reasons.push(`A few details are still assumed — the estimate is ${Math.round(p.payload.accuracyPct)}% settled and ${minAcc}% is needed to accept online.`);
    if (mid > cap) reasons.push(`It's over the online limit of $${(cap / 100).toLocaleString("en-AU")}, so a short visit confirms the price.`);
    if (p.decision.walkthroughRequired || !p.decision.canAccept) {
      const why = visitReason(p.sides ?? docSides(doc), p.deferred);
      reasons.push(VISIT_WORDING[why]);
    }
  }
  return { outcome: selfServe ? ("self_serve" as const) : ("visit" as const), reasons, accuracyPct: p.payload.accuracyPct, minAccuracyPct: minAcc, capCents: cap, guardrail: "reveal" };
}

const VISIT_WORDING: Record<ReturnType<typeof visitReason>, string> = {
  custom: "Something you named needs a look on site before it can be priced.",
  peeling: "Peeling paint needs eyes on it before we fix a price.",
  rot: "Rot needs eyes on it before we fix a price.",
  flagged: "Something was flagged for a check on site.",
  big: "It's a bigger job, so we confirm it in person.",
  signoff: "This one is signed off in person before it's fixed.",
};

// ---- support hours -----------------------------------------------------------------

export function supportHoursState(hours: SupportHours, now: Date): { open: boolean; nextOpening: string | null; summary: string } {
  const fmt = new Intl.DateTimeFormat("en-AU", { timeZone: hours.timezone, weekday: "short", hour: "2-digit", minute: "2-digit", hour12: false });
  const parts = fmt.formatToParts(now);
  const weekday = (parts.find((p) => p.type === "weekday")?.value ?? "").toLowerCase().slice(0, 3);
  const hh = Number(parts.find((p) => p.type === "hour")?.value ?? 0) % 24;
  const mm = Number(parts.find((p) => p.type === "minute")?.value ?? 0);
  const nowMin = hh * 60 + mm;
  const toMin = (t: string) => Number(t.slice(0, 2)) * 60 + Number(t.slice(3, 5));
  const DAYS = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"];
  const today = hours.days[weekday as keyof typeof hours.days];
  const open = !!today && nowMin >= toMin(today[0]) && nowMin < toMin(today[1]);
  let nextOpening: string | null = null;
  if (!open) {
    const start = DAYS.indexOf(weekday);
    for (let k = 0; k < 7 && nextOpening == null; k++) {
      const d = DAYS[(start + k) % 7];
      const h = hours.days[d as keyof typeof hours.days];
      if (!h) continue;
      if (k === 0 && nowMin >= toMin(h[0])) continue;
      nextOpening = `${d.replace(/^./, (c) => c.toUpperCase())} ${h[0]}`;
    }
  }
  const summary = open ? `A person is available now (until ${today?.[1]}).` : nextOpening ? `We're closed just now — a person is next available ${nextOpening}.` : "Support hours aren't set.";
  return { open, nextOpening, summary };
}
