import type { SupabaseClient } from "@supabase/supabase-js";
import { loadScopeRules } from "@/lib/extract/scope-cache";
import { adjustmentsFrom, loadPricingContext } from "@/lib/pricing/context";
import { editorPayload, type WizardDeferred, type WizardEditorPayload } from "@/lib/wizard/view";
import { bandsFromSettings, policyFromSettings, rangeBandPct, rangeFromTotal, settingValue, type WizardPolicySettings } from "@/lib/wizard/policy";
import { wizardStateSchema } from "@/lib/wizard/state";
import { PAINT_SYSTEMS_KEY, paintSystemsFrom } from "@/lib/pricing/systems";
import { deskCheckPack, recommendedOutcome, type DeskCheckOutcome, type DeskCheckPack } from "@/lib/wizard/desk-check";
import { packDrift } from "@/lib/wizard/confirmation";
import { estimateDocuments, type EstimateDocuments } from "@/lib/wizard/documents";
import { loopProgress } from "@/lib/wizard/confirm-state";
import { defaultInteriorLoop, type InteriorLoopMeta } from "@/lib/wizard/rooms-loop";
import { defaultSidesLoop, type SidesLoopMeta } from "@/lib/wizard/sides";
import { loopConfirmState } from "@/lib/wizard/confirm-state";

/**
 * C7b — ONE read of the pack for the estimate shell.
 *
 * The strip under the header (brief step 3.1) shows the same figures the Pack
 * tab shows: rooms confirmed, the band, photos, repairs to price, the cap
 * verdict and the rules' suggestion. Deriving them twice — once for the strip
 * and once for the pane — would be two reads of one record that could
 * disagree by a builder save in between. So the shell calls this once and
 * hands the bundle to both.
 *
 * Everything is re-derived LIVE from the tree (the pack's own rule: a builder
 * edit after sending must never be hidden from the person about to fix a
 * price); the frozen copy on the request is compared, never trusted.
 */

export type HistoryRow = { id: string; title: string | null; status: string; total_cents: number | null; created_at: string };

export type PackRequest = {
  id: string; requested_at: string; requested_by: string; kind: string; status: string;
  suggested_action: DeskCheckOutcome | null; assigned_to: string | null;
  pack: { totalCents?: number } | null;
};

export type PackBundle =
  | { kind: "holding"; line: string; href?: string }
  | {
      kind: "pack";
      estimate: { id: string; title: string | null; status: string; account_id: string | null };
      pack: DeskCheckPack;
      payload: WizardEditorPayload;
      policy: WizardPolicySettings;
      recommended: DeskCheckOutcome;
      /** The latest OPEN request, or null. */
      request: PackRequest | null;
      assignee: { full_name: string | null; email: string | null } | null;
      drift: ReturnType<typeof packDrift>;
      bandPct: number;
      range: { loCents: number; hiCents: number };
      docs: EstimateDocuments;
      /** Loop areas confirmed / total, for "9 of 9 rooms confirmed". */
      loop: { confirmed: number; total: number; unit: "rooms" | "sides" } | null;
      history: HistoryRow[];
    };

export async function loadPackBundle(supabase: SupabaseClient, id: string | undefined): Promise<PackBundle> {
  if (!id) return { kind: "holding", line: "That link is missing its estimate." };

  const { data: estimate } = await supabase
    .from("estimates")
    // No total column: the pack prices LIVE from the tree below, so a stored
    // total could only disagree with what the estimator is looking at.
    .select("id, title, status, account_id, builder_state")
    .eq("id", id)
    .maybeSingle();
  if (!estimate) return { kind: "holding", line: "We couldn't find that estimate." };

  const state = (estimate.builder_state ?? {}) as Record<string, unknown>;
  const blocks = Array.isArray(state.blocks) ? (state.blocks as Array<Record<string, unknown>>) : [];
  const deferred: WizardDeferred[] = Array.isArray(state.aiDeferred) ? (state.aiDeferred as WizardDeferred[]) : [];
  const snap = wizardStateSchema.safeParse((state.wizard as { state?: unknown } | undefined)?.state);

  const [rules, ctx, docs, requestRes] = await Promise.all([
    loadScopeRules(supabase),
    loadPricingContext(supabase),
    estimateDocuments(supabase, id),
    /**
     * C5 — the promise itself. The pack below is re-derived LIVE, deliberately:
     * a builder edit after sending must never be hidden from the person about
     * to fix a price. This row is what the customer was actually told, and the
     * two can disagree — which is the one thing an estimator must not find out
     * from the customer.
     */
    supabase.from("confirmation_requests")
      .select("id, requested_at, requested_by, kind, status, suggested_action, assigned_to, pack")
      .eq("estimate_id", id).in("status", ["requested", "question_asked"])
      .order("requested_at", { ascending: false }).limit(1).maybeSingle(),
  ]);
  const request = (requestRes?.data ?? null) as PackRequest | null;
  const assignee = request?.assigned_to
    ? (await supabase.from("profiles").select("full_name, email").eq("id", request.assigned_to).maybeSingle()).data
    : null;
  /**
   * §2.6: "contact and property history" — what we have quoted this account
   * before. Scoped to the account, which is only known once the estimate has
   * loaded, so it cannot join the parallel batch above. An estimate with no
   * account (the pre-spine ones) simply has no history to show.
   */
  const history = estimate.account_id
    ? (((await supabase.from("estimates")
        .select("id, title, status, total_cents, created_at")
        .eq("account_id", estimate.account_id).neq("id", id)
        .order("created_at", { ascending: false }).limit(6)).data) ?? []) as HistoryRow[]
    : [];

  // R5: the confidence score follows the confirm loop, so the loop's state is
  // read BEFORE the estimate is scored — the same order the customer's own
  // scope page uses, so the band here is the band they see.
  const loopState = loopConfirmState(
    blocks,
    (state.interiorLoop as InteriorLoopMeta | undefined) ?? defaultInteriorLoop(),
    (state.sidesLoop as SidesLoopMeta | undefined) ?? defaultSidesLoop(),
  );
  const payload = editorPayload(blocks, ctx, adjustmentsFrom(state), deferred, loopState);

  if (!snap.success) {
    return { kind: "holding", line: "This estimate wasn't built in the wizard, so there's nothing to desk-check. Open it in the builder instead.", href: `/quote?id=${id}` };
  }

  const policy = policyFromSettings(settingValue(ctx.settings, "wizard_policy"));
  const pack = deskCheckPack(blocks, snap.data, {
    totalCents: payload.totals.totalCents,
    rules,
    deferred,
    policy,
    systems: paintSystemsFrom(settingValue(ctx.settings, PAINT_SYSTEMS_KEY)),
  });
  const recommended = recommendedOutcome(pack);
  // What has moved since the promise (null when nothing has, or when a
  // backfilled row has no frozen total to compare against).
  const drift = packDrift({ promisedCents: request?.pack?.totalCents ?? null, liveCents: pack.totalCents });
  // §2.6: the range and its band, not just the midpoint — an estimator fixing
  // a price should see how wide the honest answer still is.
  const bands = bandsFromSettings(settingValue(ctx.settings, "wizard_bands"));
  const bandPct = rangeBandPct(payload.accuracyPct, bands);
  const range = rangeFromTotal(pack.totalCents, bandPct);

  return {
    kind: "pack",
    estimate: { id: estimate.id, title: estimate.title, status: estimate.status, account_id: estimate.account_id },
    pack, payload, policy, recommended, request, assignee, drift, bandPct, range, docs,
    loop: loopProgress(state),
    history,
  };
}
