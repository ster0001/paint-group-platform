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
import { customerExteriorView, customerScopeRooms, type CustomerExteriorView, type CustomerScopeRoom } from "@/lib/wizard/scope-editor";
import { wizardVisitSlots } from "@/lib/visits/wizard";
import { customerPayload, editorPayload, type CustomerPayload, type WizardDeferred } from "@/lib/wizard/view";
import {
  answersFromState, bandsFromSettings, evaluateGuardrails,
  policyFromSettings, serviceAreaFromSettings, settingValue,
} from "@/lib/wizard/policy";
import { wizardStateSchema } from "@/lib/wizard/state";
import { defaultSidesLoop, extrasPrices, hoursPerItemCodes, linealCodes, sidesView, wallOptionsFromRates, type SidesLoopMeta, type SidesView } from "@/lib/wizard/sides";
import { ladderFor, requiresSiteCheck, type Ladder } from "@/lib/wizard/ladder";
import { defaultInteriorLoop, interiorDwTotals, interiorProgress, roomLoopViews, type InteriorLoopMeta, type RoomLoopView } from "@/lib/wizard/rooms-loop";
import { loopConfirmState } from "@/lib/wizard/confirm-state";
import { holdDaysFromSettings } from "@/lib/wizard/confirmation-actions";
import { resolveEstimator, type Estimator } from "@/lib/wizard/estimator";
import { estimateDocuments, type EstimateDocuments } from "@/lib/wizard/documents";
import { exteriorAddOptions, interiorAddOptions, type AddOption } from "@/lib/wizard/add-catalogue";
import { paintSystemsView, type PaintSystemLine } from "@/lib/wizard/systems-view";
import { roomExtrasView } from "@/lib/wizard/room-extras";
import { asksLift, type SiteAccess } from "@/lib/wizard/site-access";
import { jobExtras, type JobExtra } from "@/lib/wizard/extras";
import { PAINT_SYSTEMS_KEY, conditionBandFromDamageTier, paintSystemsFrom } from "@/lib/pricing/systems";

/**
 * What the customer is told about our phone lines when Settings → Company
 * details has not set `phoneHours` (Tom, 8 Sep 2026: "it needs to be clear
 * that our lines are open from 08:30-16:30"). A licensee overrides it in
 * Settings rather than in this file.
 */
export const DEFAULT_PHONE_HOURS = "8:30am \u2013 4:30pm, Monday to Friday";

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
      initialLadder: Ladder;
      docs: EstimateDocuments; logoUrl: string | null; companyPhone: string | null;
      phoneHours: string; customerPhone: string | null;
      /** C11 — the customer's suburb, said on the strip only when the estimator covers it. */
      customerSuburb: string | null;
      /** C11 — the whole-house condition band, for the footer human line. */
      initialCondition: "good" | "wear" | "work";
      /** C7 — how long a fixed price is held (Settings `wizard_hold_days`). */
      holdDays: number;
      /** C7 — whose name the CTA and the hand-off use; null = nobody to name. */
      sendTo: string | null;
      /** C11 — the resolved estimator record (name, phone, whether a patch matched). */
      estimator: Estimator;
    }
  | {
      kind: "rooms"; estimateId: string; initial: CustomerPayload; initialRooms: CustomerScopeRoom[]; initialSides: SidesView | null;
      initialExterior: CustomerExteriorView | null; initialLadder: Ladder;
      initialInteriorLoop: InteriorLoopView | null; roomTypes: string[]; liveRange: boolean; docs: EstimateDocuments; logoUrl: string | null; companyPhone: string | null;
      phoneHours: string; customerPhone: string | null;
      /** C11 — the customer's suburb, said on the strip only when the estimator covers it. */
      customerSuburb: string | null;
      /** C11 — the whole-house condition band, for the footer human line. */
      initialCondition: "good" | "wear" | "work";
      /** C7 — how long a fixed price is held (Settings `wizard_hold_days`). */
      holdDays: number;
      /** C7 — whose name the CTA and the hand-off use; null = nobody to name. */
      sendTo: string | null;
      /** C11 — the resolved estimator record (name, phone, whether a patch matched). */
      estimator: Estimator;
      /** Phase 4: the derived coats and prep, in the painter's words, with a
       * correction per line. Empty on an exterior-only job (plan §4.4). */
      initialSystems: PaintSystemLine[];
  /** C10 — each room's extras row, read off the deferrals pinned to it. */
  initialRoomExtras: Record<string, { featureWalls: number; wallpaper: boolean; other: string }>;
      /**
       * ⚑ Tom, 10 Sep: the ONE job-wide question that still changes coats.
       * `asked` is true only when the customer said they are going much lighter
       * or bolder — on any other job there is nothing to pick, and a card
       * offering the choice would invent a question.
       */
      initialDarkToLight: {
        asked: boolean; surfaces: string[]; someWalls: boolean;
        /** Ceilings (Tom, 11 Sep): all of them, a named list of rooms, or none. */
        ceilings: "all" | "some" | null; ceilingRooms: number[];
      };
      /** The job's colour intent — it words each room's prep question. */
      initialColourTier: "fresh" | "change" | "dark_to_light";
      /** §4.4 — the site and access answers so far, and whether to ask about a lift. */
      initialAccess: { answers: SiteAccess; asksLift: boolean };
      /** §4.5 — the extras on offer, which are on, the colour-help tick and the note. */
      initialExtras: { offer: JobExtra[]; on: string[]; colourHelp: boolean; note: string };
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
    // AUDIT 9.1: the same function the submit route uses, so the two cannot
    // disagree. The stored column is ORed in, never replaced — escalations the
    // editor adds after submit (custom surface, rot, a geometry flag) live only
    // there, and deriving from state alone would forget them.
    requiresSiteCheck({
      state: snap.success ? snap.data : null,
      stored: (estimate as { requires_site_check?: boolean | null }).requires_site_check,
    }),
    policyFromSettings(settingValue(ctx.settings, "wizard_policy")),
    serviceAreaFromSettings(settingValue(ctx.settings, "service_area")),
    tradeActor,
  );
  if (decision.outcome !== "reveal") {
    return { kind: "holding", line: "This one needs a person — we'll be in touch to sort it properly." };
  }

  const customer = customerPayload(payload, blocks, decision, bandsFromSettings(settingValue(ctx.settings, "wizard_bands")));
  const headerLogoUrl = ((settingValue(ctx.settings, "company_profile") ?? {}) as { logoUrl?: string }).logoUrl || null;
  const profile = (settingValue(ctx.settings, "company_profile") ?? {}) as { phone?: string; phoneHours?: string };
  const companyPhone = profile.phone?.trim() || null;
  // Tom, 8 Sep: "it needs to be clear that our lines are open from
  // 08:30-16:30" — Settings → Company details owns the wording, and the
  // constant is what a licensee sees before they set their own.
  const phoneHours = profile.phoneHours?.trim() || DEFAULT_PHONE_HOURS;
  // Tom, 8 Sep: a call-back form must not ask again for a number the
  // customer already typed on the contact page — it arrives filled in and
  // stays editable.
  const customerPhone = snap.success ? (snap.data.contact?.phone?.trim() || null) : null;
  const roomTypes = [...new Set(rules.map((r) => r.room_type))]
    .filter((t) => !["exterior", "exterior_elevation", "unknown", "excluded", "exterior_excluded"].includes(t))
    .sort();
  // ⚑ pending Tom's final call: live range updates default ON, Settings-off.
  const editorFlags = (settingValue(ctx.settings, "scope_editor") ?? {}) as { liveRange?: boolean; visitSlots?: string[] };
  /**
   * C7 — the hold, read ONCE here with everything else this screen needs.
   * The door's copy ("held for 60 days") and the date the server writes to
   * `valid_until` are the same setting or they are a broken promise.
   */
  const holdDays = holdDaysFromSettings(settingValue(ctx.settings, "wizard_hold_days"));
  /**
   * C7 (v2.4) — WHO the customer is sending it to, for the CTA and the
   * hand-off screen.
   *
   * The estimator whose patch covers this postcode (C5's `patch_postcodes`),
   * falling back to the coordinator in Settings. Both are records. When
   * neither answers, this stays null and the button keeps its old wording —
   * `sendToLabel` refuses to invent a name, and an estimate addressed to
   * somebody who does not work here is worse than a generic button.
   */
  // C11: ONE resolver for who the estimator is (lib/wizard/estimator.ts);
  // `sendTo` is its name, kept for everything that already reads it.
  const estimator = await resolveEstimator(db, ctx.settings, snap.success ? (snap.data.customer?.postcode ?? null) : null);
  const sendTo = estimator.name;
  const customerSuburb = snap.success ? (snap.data.customer?.suburb?.trim() || null) : null;
  const initialCondition = conditionBandFromDamageTier(snap.success ? (snap.data.details?.damageTier ?? 1) : 1);
  // P6: the windows a real estimator can do, minus booked visits.
  const visitSlots = (await wizardVisitSlots(db, editorFlags)).labels;
  const hasExterior = blocks.some((b) => b.kind === "area" && b.type === "Exterior");
  // ONE ladder (C1): the decision already carries the
  // caps and the accuracy bar from wizard_policy; this only names the tier.
  const ladder = ladderFor({
    accuracyPct: payload.accuracyPct, decision, bands: bandsFromSettings(settingValue(ctx.settings, "wizard_bands")),
    sidesMeta, deferred, hasExterior,
    hasPlan: snap.success ? (snap.data.planRunIds.length > 0 || Boolean(snap.data.listingUrl?.trim())) : false,
    pendingAreas: [...loopState.states.values()].filter((v) => v === "pending").length,
    visitSlots,
  });

  // R2b: a job with exterior sides and no interior rooms gets the confirm-
  // loop sides editor (reference: customer-review-confirm-exterior-v2-sides).
  const interiorRooms = customerScopeRooms(blocks, rules);
  const sides = sidesView(blocks, sidesMeta, extrasPrices(ctx.rateItems),
    snap.success ? (snap.data.exterior?.storeys ?? null) : null,
    exteriorAddOptions(ctx.rateItems), wallOptionsFromRates(ctx.rateItems), hoursPerItemCodes(ctx.rateItems),
    linealCodes(ctx.rateItems));
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
      initialLadder: ladder,
      docs, logoUrl: headerLogoUrl, companyPhone, phoneHours, customerPhone, holdDays, sendTo, estimator, customerSuburb, initialCondition,
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
    initialLadder: ladder,
    initialInteriorLoop: interiorLoop, roomTypes, liveRange: editorFlags.liveRange !== false, docs, logoUrl: headerLogoUrl,
    companyPhone, phoneHours, customerPhone, holdDays, sendTo, estimator, customerSuburb, initialCondition,
    // Phase 4: the systems the engine derived, ready to be shown back and
    // corrected. An estimate with no readable wizard snapshot (a staff-built
    // tree, an old draft) gets no card rather than a card of guesses.
    initialExtras: {
      offer: jobExtras(ctx.rateItems),
      // What is ON is read off the TREE, not a stored list — an estimator can
      // remove an extras line in the builder and the sheet must agree with it.
      on: blocks
        .filter((b) => String(b.name ?? "").toLowerCase() === "interior - extras")
        .flatMap((b) => (Array.isArray(b.surfaces) ? (b.surfaces as Array<{ code?: unknown }>) : []))
        .map((x) => String(x.code ?? "")),
      colourHelp: snap.success ? snap.data.paint.colourHelp === "advice" : false,
      note: snap.success ? String(snap.data.details.extraNote ?? "") : "",
    },
    initialAccess: {
      answers: snap.success ? (snap.data.details.siteAccess ?? {}) : {},
      asksLift: snap.success ? asksLift(snap.data.customer?.propertyKind) : false,
    },
    initialColourTier: snap.success ? snap.data.condition.tier : "change",
    initialDarkToLight: {
      asked: snap.success && snap.data.condition.tier === "dark_to_light",
      surfaces: snap.success ? [...(snap.data.condition.darkToLightSurfaces ?? [])] : [],
      someWalls: snap.success
        && (snap.data.condition.surfaceFlags?.walls ?? []).includes("some_dark_to_light"),
      ceilings: snap.success ? (snap.data.condition.darkToLightCeilings ?? null) : null,
      ceilingRooms: snap.success ? [...(snap.data.condition.darkToLightCeilingRooms ?? [])] : [],
    },
    // C10: each room's extras row, read off the deferrals pinned to it.
    initialRoomExtras: Object.fromEntries(blocks.filter((b) => b.kind === "area").map((b) => [String(b.id), roomExtrasView(deferred, Number(b.id))])),
    initialSystems: snap.success
      ? paintSystemsView(snap.data, blocks, paintSystemsFrom(settingValue(ctx.settings, PAINT_SYSTEMS_KEY)))
      : [],
  };
}
