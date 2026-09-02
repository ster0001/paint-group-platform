/**
 * The CUSTOMER scope editor's data, as one loader shared by the editor page
 * (/estimate/scope) and the assistant's split view (/estimate/assist + the
 * agent turn route). Extracted verbatim from the page on 2 Sep 2026 so the
 * two surfaces can never price or gate differently.
 *
 * The caller owns identity and ownership (getWizardActor + the
 * customer_intake/draft check); this only assembles what the editor renders.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import { loadScopeRules } from "@/lib/extract/scope-cache";
import { adjustmentsFrom, loadPricingContext } from "@/lib/pricing/context";
import { customerExteriorView, customerScopeRooms, offeredVisitSlots, type CustomerExteriorView, type CustomerScopeRoom } from "@/lib/wizard/scope-editor";
import { customerPayload, editorPayload, type CustomerPayload, type WizardDeferred } from "@/lib/wizard/view";
import {
  answersFromState, bandsFromSettings, evaluateGuardrails,
  policyFromSettings, serviceAreaFromSettings, settingValue,
} from "@/lib/wizard/policy";
import { wizardStateSchema } from "@/lib/wizard/state";
import { defaultSidesLoop, extrasPrices, sidesView, visitReason, wallOptionsFromRates, type SidesLoopMeta, type SidesView } from "@/lib/wizard/sides";
import { defaultInteriorLoop, interiorDwTotals, interiorProgress, roomLoopViews, type InteriorLoopMeta, type RoomLoopView } from "@/lib/wizard/rooms-loop";
import { loopConfirmState } from "@/lib/wizard/confirm-state";
import { estimateDocuments, type EstimateDocuments } from "@/lib/wizard/documents";
import { exteriorAddOptions, interiorAddOptions, type AddOption } from "@/lib/wizard/add-catalogue";

export type EstimateRow = {
  id: string; status: string; source?: string | null; created_by?: string | null;
  requires_site_check?: boolean | null; builder_state?: Record<string, unknown> | null; account_id?: string | null;
};

export type InteriorLoopView = {
  rooms: RoomLoopView[];
  dw: { doors: number; windows: number; ok: boolean | null };
  meta: InteriorLoopMeta;
  progress: ReturnType<typeof interiorProgress>;
  catalogue: AddOption[];
};

export type CustomerScopeBundle =
  | { kind: "holding"; line: string }
  | {
      kind: "sides"; estimateId: string; initial: CustomerPayload; initialSides: SidesView; initialExterior: CustomerExteriorView | null;
      initialLadder: { tier: "self_serve" | "visit"; reason: ReturnType<typeof visitReason> | null; visitSlots: string[] };
      docs: EstimateDocuments; logoUrl: string | null;
    }
  | {
      kind: "rooms"; estimateId: string; initial: CustomerPayload; initialRooms: CustomerScopeRoom[]; initialSides: SidesView | null;
      initialExterior: CustomerExteriorView | null; initialLadder: { tier: "self_serve" | "visit"; visitSlots: string[] };
      initialInteriorLoop: InteriorLoopView | null; roomTypes: string[]; liveRange: boolean; docs: EstimateDocuments; logoUrl: string | null;
    };

export async function loadCustomerScope(db: SupabaseClient, estimate: EstimateRow): Promise<CustomerScopeBundle> {
  const id = estimate.id;
  const state = (estimate.builder_state ?? {}) as Record<string, unknown>;
  const blocks = Array.isArray(state.blocks) ? (state.blocks as Array<Record<string, unknown>>) : [];
  const deferred: WizardDeferred[] = Array.isArray(state.aiDeferred) ? (state.aiDeferred as WizardDeferred[]) : [];

  const [rules, ctx, docs] = await Promise.all([
    loadScopeRules(db),
    loadPricingContext(db),
    // R5: the plan and photos this customer uploaded, signed for the browser.
    estimateDocuments(db, id),
  ]);

  // R5: the confidence score follows the confirm loop, so the loop's state
  // has to be read BEFORE the estimate is priced and scored.
  const sidesMeta = ((state.sidesLoop as SidesLoopMeta | undefined) ?? defaultSidesLoop());
  const interiorMeta = ((state.interiorLoop as InteriorLoopMeta | undefined) ?? defaultInteriorLoop());
  const loopState = loopConfirmState(blocks, interiorMeta, sidesMeta);
  const payload = editorPayload(blocks, ctx, adjustmentsFrom(state), deferred, loopState);
  const snap = wizardStateSchema.safeParse((state.wizard as { state?: unknown } | undefined)?.state);
  const answers = snap.success
    ? answersFromState(snap.data)
    : answersFromState({ jobType: "interior", details: { damageTier: 1 }, customer: null });
  // The same trade relaxation the submit route applied — decided from the
  // estimate's OWN account (linked at save), so the editor and the submit
  // can never disagree about the handoff tier.
  let tradeActor = false;
  const accountId = (estimate as { account_id?: string | null }).account_id;
  if (accountId) {
    const { data: acct } = await db.from("accounts").select("account_type").eq("id", accountId).maybeSingle();
    tradeActor = (acct as { account_type?: string } | null)?.account_type === "trade";
  }
  const decision = evaluateGuardrails(
    answers,
    payload.totals.totalCents,
    payload.accuracyPct,
    (estimate as { requires_site_check?: boolean | null }).requires_site_check === true,
    policyFromSettings(settingValue(ctx.settings, "wizard_policy")),
    serviceAreaFromSettings(settingValue(ctx.settings, "service_area")),
    tradeActor,
  );
  if (decision.outcome !== "reveal") {
    return { kind: "holding", line: "This one needs a person — we'll be in touch to sort it properly." };
  }

  const customer = customerPayload(payload, blocks, decision, bandsFromSettings(settingValue(ctx.settings, "wizard_bands")));
  const headerLogoUrl = ((settingValue(ctx.settings, "company_profile") ?? {}) as { logoUrl?: string }).logoUrl || null;
  const roomTypes = [...new Set(rules.map((r) => r.room_type))]
    .filter((t) => !["exterior", "exterior_elevation", "unknown", "excluded", "exterior_excluded"].includes(t))
    .sort();
  // ⚑ pending Tom's final call: live range updates default ON, Settings-off.
  const editorFlags = (settingValue(ctx.settings, "scope_editor") ?? {}) as {
    liveRange?: boolean; visitSlots?: string[];
    selfServeInteriorCapCents?: number; selfServeExteriorCapCents?: number; selfServeMinAccuracy?: number;
  };
  // B2 ladder: Settings-driven thresholds; the visit tier is an offer.
  const hasExterior = blocks.some((b) => b.kind === "area" && b.type === "Exterior");
  const cap = hasExterior ? (editorFlags.selfServeExteriorCapCents ?? 1_200_000) : (editorFlags.selfServeInteriorCapCents ?? 600_000);
  const mid = (customer.rangeLoCents + customer.rangeHiCents) / 2;
  const selfServe = decision.canAccept && !decision.walkthroughRequired
    && payload.accuracyPct >= (editorFlags.selfServeMinAccuracy ?? (hasExterior ? 85 : 90)) && mid <= cap;

  // R2b: a job with exterior sides and no interior rooms gets the confirm-
  // loop sides editor (reference: customer-review-confirm-exterior-v2-sides).
  const interiorRooms = customerScopeRooms(blocks, rules);
  const sides = sidesView(blocks, sidesMeta, extrasPrices(ctx.rateItems),
    snap.success ? (snap.data.exterior?.storeys ?? null) : null,
    exteriorAddOptions(ctx.rateItems), wallOptionsFromRates(ctx.rateItems));
  // Batch 4: an estimate with exterior blocks but NO sides structure
  // predates the rebuild — the old editor is deleted, so it gets a polite
  // restart message, never a broken surface. (Tom's ruling: archive +
  // no fallback.)
  const hasExteriorBlocks = blocks.some((b) => (b as { kind?: string; type?: string }).kind === "area" && (b as { kind?: string; type?: string }).type === "Exterior");
  if (hasExteriorBlocks && !sides) {
    return { kind: "holding", line: "This estimate was made before our new editor — start a fresh one and it takes about two minutes." };
  }

  if (sides && interiorRooms.length === 0) {
    return {
      kind: "sides", estimateId: id, initial: customer, initialSides: sides, initialExterior: customerExteriorView(blocks),
      initialLadder: {
        tier: selfServe ? "self_serve" : "visit",
        reason: selfServe ? null : visitReason(sidesMeta, deferred),
        visitSlots: offeredVisitSlots(editorFlags),
      },
      docs, logoUrl: headerLogoUrl,
    };
  }

  // R3: the interior confirm loop's initial state.
  const interiorLoop: InteriorLoopView | null = interiorRooms.length > 0 ? {
    rooms: roomLoopViews(blocks, new Set(ctx.rateItems.map((r) => r.code))),
    dw: { ...interiorDwTotals(blocks), ok: interiorMeta.dwOk },
    meta: interiorMeta,
    progress: interiorProgress(blocks, interiorMeta),
    // R5: every interior surface the live card can price.
    catalogue: interiorAddOptions(ctx.rateItems),
  } : null;

  return {
    kind: "rooms", estimateId: id, initial: customer, initialRooms: interiorRooms, initialSides: sides,
    initialExterior: customerExteriorView(blocks),
    initialLadder: { tier: selfServe ? "self_serve" : "visit", visitSlots: offeredVisitSlots(editorFlags) },
    initialInteriorLoop: interiorLoop, roomTypes, liveRange: editorFlags.liveRange !== false, docs, logoUrl: headerLogoUrl,
  };
}
