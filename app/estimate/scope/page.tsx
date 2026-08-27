import { createClient } from "@/lib/supabase/server";
import { createServiceClient } from "@/lib/supabase/service";
import { getWizardActor } from "@/lib/supabase/guards";
import { loadScopeRules } from "@/lib/extract/scope-cache";
import { adjustmentsFrom, loadPricingContext } from "@/lib/pricing/context";
import { customerExteriorView, customerScopeRooms, offeredVisitSlots } from "@/lib/wizard/scope-editor";
import { customerPayload, editorPayload, type WizardDeferred } from "@/lib/wizard/view";
import {
  answersFromState, bandsFromSettings, evaluateGuardrails,
  policyFromSettings, serviceAreaFromSettings, settingValue,
} from "@/lib/wizard/policy";
import { wizardStateSchema } from "@/lib/wizard/state";
import ScopeEditor from "./ScopeEditor";
import SidesEditor from "./SidesEditor";
import Wordmark from "@/app/wizard/Wordmark";
import { getCompanyContact } from "@/lib/portal/data";
import { defaultSidesLoop, extrasPrices, sidesView, visitReason, type SidesLoopMeta } from "@/lib/wizard/sides";
import { defaultInteriorLoop, interiorDwTotals, interiorProgress, roomLoopViews, type InteriorLoopMeta } from "@/lib/wizard/rooms-loop";
import { loopConfirmState } from "@/lib/wizard/confirm-state";
import { estimateDocuments } from "@/lib/wizard/documents";
import { exteriorAddOptions, interiorAddOptions } from "@/lib/wizard/add-catalogue";
import "../../wizard/wizard.css";

/**
 * /estimate/scope?id=… — Part B: the customer scope editor.
 *
 * Full control of WHAT is painted, zero control of hours, rates or
 * allowances — enforced by the wizard-edit route's action whitelist, not by
 * hidden buttons. A customer opens only their own customer_intake draft
 * (404 otherwise); staff can open any draft to preview what the customer
 * sees. Everything money-shaped on this page is a RANGE.
 */

export const dynamic = "force-dynamic";
export const metadata = {
  title: "Shape your estimate · Paint Group",
  robots: { index: false, follow: false },
};

async function Holding({ line }: { line: string }) {
  const company = await getCompanyContact();
  return (
    <div className="wz">
      <header className="wz-top"><Wordmark logoUrl={company.logoUrl} /></header>
      <div className="wz-wrap" style={{ textAlign: "center", paddingTop: 80 }}>
        <h1>{line}</h1>
      </div>
    </div>
  );
}

export default async function ScopeEditorPage({
  searchParams,
}: {
  searchParams: Promise<{ id?: string }>;
}) {
  const { id } = await searchParams;
  if (!id) return <Holding line="That link is missing its estimate." />;

  const supabase = await createClient();
  const actor = await getWizardActor(supabase);
  if (actor.kind === "none") return <Holding line="Open your estimate from the link we sent you." />;

  const db = actor.kind === "customer" ? createServiceClient() : supabase;
  if (!db) return <Holding line="The editor isn't available just now — please try again shortly." />;

  const { data: estimate } = await db
    .from("estimates")
    .select("id, status, source, created_by, requires_site_check, builder_state, account_id")
    .eq("id", id)
    .maybeSingle();
  const own = actor.kind !== "customer" || (
    (estimate as { created_by?: string | null } | null)?.created_by === actor.user.id
    && (estimate as { source?: string } | null)?.source === "customer_intake"
    && estimate?.status === "draft"
  );
  if (!estimate || !own) return <Holding line="We couldn't find that estimate." />;
  if (estimate.status === "accepted") {
    return <Holding line="This estimate is accepted — its scope is locked in." />;
  }

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
    return <Holding line="This one needs a person — we'll be in touch to sort it properly." />;
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
    exteriorAddOptions(ctx.rateItems));
  // Batch 4: an estimate with exterior blocks but NO sides structure
  // predates the rebuild — the old editor is deleted, so it gets a polite
  // restart message, never a broken surface. (Tom's ruling: archive +
  // no fallback.)
  const hasExteriorBlocks = blocks.some((b) => (b as { kind?: string; type?: string }).kind === "area" && (b as { kind?: string; type?: string }).type === "Exterior");
  if (hasExteriorBlocks && !sides) {
    return <Holding line="This estimate was made before our new editor — start a fresh one and it takes about two minutes." />;
  }

  if (sides && interiorRooms.length === 0) {
    return (
      <div className="wz">
        <SidesEditor
          estimateId={estimate.id as string}
          initial={customer}
          initialSides={sides}
          initialExterior={customerExteriorView(blocks)}
          initialLadder={{
            tier: selfServe ? "self_serve" : "visit",
            reason: selfServe ? null : visitReason(sidesMeta, deferred),
            visitSlots: offeredVisitSlots(editorFlags),
          }}
          docs={docs}
          logoUrl={headerLogoUrl}
        />
      </div>
    );
  }

  // R3: the interior confirm loop's initial state.
  const interiorLoop = interiorRooms.length > 0 ? {
    rooms: roomLoopViews(blocks, new Set(ctx.rateItems.map((r) => r.code))),
    dw: { ...interiorDwTotals(blocks), ok: interiorMeta.dwOk },
    meta: interiorMeta,
    progress: interiorProgress(blocks, interiorMeta),
    // R5: every interior surface the live card can price.
    catalogue: interiorAddOptions(ctx.rateItems),
  } : null;

  return (
    <div className="wz">
      <ScopeEditor
        estimateId={estimate.id as string}
        initial={customer}
        initialRooms={interiorRooms}
        initialSides={sides}
        initialExterior={customerExteriorView(blocks)}
        initialLadder={{ tier: selfServe ? "self_serve" : "visit", visitSlots: offeredVisitSlots(editorFlags) }}
        initialInteriorLoop={interiorLoop}
        roomTypes={roomTypes}
        liveRange={editorFlags.liveRange !== false}
        docs={docs}
        logoUrl={headerLogoUrl}
      />
    </div>
  );
}
