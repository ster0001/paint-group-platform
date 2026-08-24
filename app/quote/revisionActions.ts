"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import type { PricingContext } from "@/lib/pricing/estimate";
import type { RateItem, Product } from "@/lib/pricing/types";
import { diffRevision, type RevisionState } from "@/lib/revision/diff";

/**
 * The revision builder's server side (addendum A2).
 *
 * The browser edits and PREVIEWS; every figure that reaches the database is
 * recomputed here from the SAVED working scope, priced with the estimate's OWN
 * rate card (never the active one — a signed job must not silently reprice on
 * a newer card), and written through wo_draft_revision_variation, which stamps
 * the contractor's money in SQL. The browser sends an estimate id, nothing
 * else.
 *
 * Already-signed revision variations for a block SUBTRACT from that block's
 * fresh delta, so editing a block twice drafts only the increment beyond what
 * the customer already signed — the ledger's "accepted + Σ signed variations"
 * arithmetic stays exact however many rounds a job goes.
 */

const uuid = z.string().uuid();

export type SaveScopeResult = { ok: true } | { ok: false; message: string };

const saveInput = z.object({
  estimateId: uuid,
  state: z.record(z.string(), z.unknown()),
});

export async function saveWorkingScopeAction(raw: unknown): Promise<SaveScopeResult> {
  const parsed = saveInput.safeParse(raw);
  if (!parsed.success) return { ok: false, message: "That didn't look like a working scope." };

  const supabase = await createClient();
  const { data, error } = await supabase.rpc("wo_save_working_scope", {
    p_estimate_id: parsed.data.estimateId,
    p_state: parsed.data.state,
  });
  if (error) return { ok: false, message: error.message };
  const s = String(data ?? "");
  if (s === "ok") { revalidatePath("/quote"); return { ok: true }; }
  if (s === "error:not_found") return { ok: false, message: "Open the revision again — the working scope isn't there yet." };
  if (s === "error:not_staff") return { ok: false, message: "Staff only." };
  return { ok: false, message: "Couldn't save the working scope." };
}

export type DraftedVariation = {
  blockRef: string;
  title: string;
  priceIncCents: number;
  credit: boolean;
  hours: number;
  token: string | null;
  state: "drafted" | "updated" | "cancelled" | "no_change" | "error";
  message?: string;
};

export type DraftResult =
  | {
      ok: true;
      drafted: DraftedVariation[];
      acceptedIncCents: number;
      workingIncCents: number;
    }
  | { ok: false; message: string };

export async function draftRevisionVariationsAction(raw: unknown): Promise<DraftResult> {
  const parsed = z.object({ estimateId: uuid }).safeParse(raw);
  if (!parsed.success) return { ok: false, message: "Invalid input." };
  const estimateId = parsed.data.estimateId;

  const supabase = await createClient();

  const [{ data: scope }, { data: estimate }] = await Promise.all([
    supabase.from("wo_working_scopes")
      .select("work_order_id, accepted_state, working_state")
      .eq("estimate_id", estimateId).maybeSingle(),
    supabase.from("estimates")
      .select("id, rate_card_id, status").eq("id", estimateId).maybeSingle(),
  ]);
  if (!scope) return { ok: false, message: "No working scope — open the revision first." };
  if (!estimate || estimate.status !== "accepted") {
    return { ok: false, message: "Revisions only exist on accepted estimates." };
  }

  // The estimate's own card. rate_card_id can be null on ancient rows — fall
  // back to the active card, which is then also what the builder showed.
  let cardId = estimate.rate_card_id as string | null;
  if (!cardId) {
    const { data: active } = await supabase.from("rate_cards").select("id").eq("is_active", true).single();
    cardId = active?.id ?? null;
  }

  const [rateItemsRes, productsRes, modifiersRes, settingsRes] = await Promise.all([
    supabase.from("rate_items").select("*").eq("rate_card_id", cardId ?? ""),
    supabase.from("products").select("*"),
    supabase.from("modifiers").select("*").eq("active", true),
    supabase.from("settings").select("key, value"),
  ]);
  const ctx: PricingContext = {
    rateItems: (rateItemsRes.data ?? []) as unknown as RateItem[],
    products: (productsRes.data ?? []) as unknown as Product[],
    modifiers: (modifiersRes.data ?? []) as PricingContext["modifiers"],
    settings: (settingsRes.data ?? []) as PricingContext["settings"],
  };
  if (ctx.rateItems.length === 0) return { ok: false, message: "The estimate's rate card has no items — cannot price the diff." };

  const diff = diffRevision(
    (scope.accepted_state ?? {}) as RevisionState,
    (scope.working_state ?? {}) as RevisionState,
    ctx,
  );

  // What the customer has already signed, per block.
  const { data: existingRows } = await supabase
    .from("wo_variations")
    .select("id, revision_block_ref, status, price_cents, credit, est_hours")
    .eq("work_order_id", scope.work_order_id)
    .not("revision_block_ref", "is", null);
  const existing = (existingRows ?? []) as {
    id: string; revision_block_ref: string; status: string;
    price_cents: number | null; credit: boolean; est_hours: string | number | null;
  }[];

  const signedDeltaFor = (ref: string) =>
    existing
      .filter((v) => v.revision_block_ref === ref
        && (v.status === "customer_approved" || v.status === "contractor_accepted")
        && v.price_cents != null)
      .reduce((s, v) => s + (v.credit ? -(v.price_cents ?? 0) : (v.price_cents ?? 0)), 0);
  const signedHoursFor = (ref: string) =>
    existing
      .filter((v) => v.revision_block_ref === ref
        && (v.status === "customer_approved" || v.status === "contractor_accepted"))
      .reduce((s, v) => s + (v.credit ? -Number(v.est_hours ?? 0) : Number(v.est_hours ?? 0)), 0);

  const drafted: DraftedVariation[] = [];
  const seenRefs = new Set<string>();

  for (const change of diff.changes) {
    seenRefs.add(change.blockRef);
    const signedInc = signedDeltaFor(change.blockRef);
    const draftDelta = change.deltaIncCents - signedInc;
    const draftHours = Math.max(0, Math.round(Math.abs(change.hoursDelta - signedHoursFor(change.blockRef)) * 100) / 100);
    const credit = draftDelta < 0;
    const priceIncCents = Math.abs(draftDelta);

    const beyondSigned = signedInc !== 0;
    const comment = beyondSigned
      ? `${change.title} — further to the change already signed${change.detail ? ` (${change.detail})` : ""}`
      : `${change.title}${change.detail ? ` — ${change.detail}` : ""}`;
    const pricedLines = beyondSigned
      ? [{ label: `${change.title} — beyond the already-signed change`, cents: draftDelta }]
      : change.pricedLines;

    const { data, error } = await supabase.rpc("wo_draft_revision_variation", {
      p_estimate_id: estimateId,
      p_block_ref: change.blockRef,
      p_category: credit ? "scope_removed" : "extra_scope",
      p_comment: comment,
      p_credit: credit,
      p_surface_keys: change.surfaceKeys,
      p_price_cents: priceIncCents,
      p_inputs: {
        source: "revision_diff",
        blockRef: change.blockRef,
        deltaIncCents: draftDelta,
        signedOffsetIncCents: signedInc,
        rateCardId: cardId,
        incGst: true,
      },
      p_priced_lines: pricedLines,
      p_hours: draftHours,
    });

    const s = String(data ?? "");
    drafted.push({
      blockRef: change.blockRef,
      title: change.title,
      priceIncCents,
      credit,
      hours: draftHours,
      token: s.startsWith("ok:") && s !== "ok:cancelled" && s !== "ok:no_change" ? s.slice(3) : null,
      state: error ? "error"
        : s === "ok:cancelled" ? "cancelled"
        : s === "ok:no_change" ? "no_change"
        : s.startsWith("ok:") ? "drafted"
        : "error",
      message: error?.message ?? (s.startsWith("error:") ? s : undefined),
    });
  }

  // Standing drafts whose block no longer differs: retire them.
  for (const v of existing) {
    if (v.status !== "priced" || seenRefs.has(v.revision_block_ref)) continue;
    const { data } = await supabase.rpc("wo_draft_revision_variation", {
      p_estimate_id: estimateId,
      p_block_ref: v.revision_block_ref,
      p_category: "extra_scope",
      p_comment: "retired",
      p_credit: false,
      p_surface_keys: [],
      p_price_cents: 0,
      p_inputs: {},
      p_priced_lines: [],
      p_hours: 0,
    });
    drafted.push({
      blockRef: v.revision_block_ref,
      title: "No longer changed",
      priceIncCents: 0,
      credit: false,
      hours: 0,
      token: null,
      state: String(data ?? "") === "ok:cancelled" ? "cancelled" : "no_change",
    });
  }

  revalidatePath("/quote");
  revalidatePath("/pc");
  return {
    ok: true,
    drafted,
    acceptedIncCents: diff.acceptedIncCents,
    workingIncCents: diff.workingIncCents,
  };
}
