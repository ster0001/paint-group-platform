"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import type { PricingContext } from "@/lib/pricing/estimate";
import type { RateItem, Product } from "@/lib/pricing/types";
import { diffRevision, type RevisionState } from "@/lib/revision/diff";
import { emailConfigured, sendEmail, sendSms, smsConfigured } from "@/lib/messaging/send";
import { normalisePhoneAU } from "@/lib/messaging/config";
import { buildInvoiceEmailHtml } from "@/lib/invoicing/sendInvoice";

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
  /** The wo_variations row id — what a photo attaches to. */
  variationId: string | null;
  state: "drafted" | "updated" | "cancelled" | "no_change" | "error";
  message?: string;
};

export type DraftResult =
  | {
      ok: true;
      drafted: DraftedVariation[];
      workOrderId: string;
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
        // The tick rows this addition brings (20270193): applied to
        // wo_surfaces by the database the moment the customer signs.
        surfaces: credit ? [] : change.addedSurfaces,
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
      variationId: null,
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
      variationId: null,
      token: null,
      state: String(data ?? "") === "ok:cancelled" ? "cancelled" : "no_change",
    });
  }

  // The RPC returns the OFFER's token — every pending draft on the job shares
  // it since 20270192 — so the photo uploader resolves each row's id by block.
  if (drafted.some((d) => d.token)) {
    const { data: idRows } = await supabase
      .from("wo_variations").select("id, revision_block_ref")
      .eq("work_order_id", scope.work_order_id).eq("status", "priced")
      .not("revision_block_ref", "is", null);
    const byRef = new Map(((idRows ?? []) as { id: string; revision_block_ref: string }[])
      .map((r) => [r.revision_block_ref, r.id]));
    for (const d of drafted) {
      if (d.token) d.variationId = byRef.get(d.blockRef) ?? null;
    }
  }

  revalidatePath("/quote");
  revalidatePath("/pc");
  return {
    ok: true,
    drafted,
    workOrderId: scope.work_order_id as string,
    acceptedIncCents: diff.acceptedIncCents,
    workingIncCents: diff.workingIncCents,
  };
}

// ---- send a variation for signature (email + SMS) --------------------------

export type SendVariationResult = {
  ok: boolean;
  email?: { status: string; message?: string };
  sms?: { status: string; message?: string };
  message?: string;
};

/**
 * Tom's follow-up (24 Aug): the signing link goes out through the SAME
 * messaging rails as estimates — email and text, ⚑16 log-driver when
 * unconfigured. Recipient comes from the estimate's own contact; nothing is
 * typed. Re-sending is fine — the link is stable per offer.
 *
 * Since 20270192 the link is the OFFER: every pending change on the job sits
 * behind one token and the customer signs (or declines) them together, so the
 * message names the count and the NET figure, and the photo rule holds for
 * every addition in the list before anything goes out.
 */
export async function sendVariationForSignatureAction(raw: unknown): Promise<SendVariationResult> {
  const parsed = z.object({
    variationId: uuid.optional(),
    token: z.string().min(24).max(200).optional(),
    // Tom (24 Aug close-off): the sender chooses the channel.
    via: z.enum(["email", "sms", "both"]).default("both"),
  }).refine((d) => d.variationId || d.token).safeParse(raw);
  if (!parsed.success) return { ok: false, message: "Invalid input." };

  const supabase = await createClient();
  type VRow = {
    id: string; customer_token: string | null; status: string;
    price_cents: number | null; credit: boolean; comment: string;
    work_orders: { estimate_id: string; wo_ref: string } | null;
  };
  const COLS = "id, customer_token, status, price_cents, credit, comment, work_orders(estimate_id, wo_ref)";

  // Looked up by row id? Widen to the whole offer behind that row's token.
  let token = parsed.data.token ?? null;
  if (!token && parsed.data.variationId) {
    const { data: one } = await supabase.from("wo_variations")
      .select("customer_token").eq("id", parsed.data.variationId).maybeSingle();
    token = (one as { customer_token: string | null } | null)?.customer_token ?? null;
  }
  if (!token) return { ok: false, message: "Price it first — there's no signing link yet." };

  const { data: rowsRaw, error: rowsError } = await supabase
    .from("wo_variations").select(COLS).eq("customer_token", token)
    .order("created_at", { ascending: true });
  if (rowsError) return { ok: false, message: rowsError.message };
  const offer = ((rowsRaw ?? []) as unknown as VRow[]);
  if (offer.length === 0) return { ok: false, message: "Price it first — there's no signing link yet." };
  const pending = offer.filter((v) => v.status === "priced");
  if (pending.length === 0) return { ok: false, message: "This one has already been answered." };

  // Tom's ruling (1 Sep): a variation goes to the customer WITH a photo of
  // what was found — they sign what they can see. Credits (scope removals)
  // are exempt; there is nothing on site to photograph. Every addition in
  // the offer needs one before the offer goes.
  const additions = pending.filter((v) => !v.credit);
  if (additions.length > 0) {
    const { data: photoRows, error: photoError } = await supabase
      .from("wo_photos").select("variation_id")
      .in("variation_id", additions.map((a) => a.id));
    if (photoError) return { ok: false, message: photoError.message };
    const withPhoto = new Set(((photoRows ?? []) as { variation_id: string | null }[]).map((p) => p.variation_id));
    const missing = additions.filter((a) => !withPhoto.has(a.id));
    if (missing.length > 0) {
      return {
        ok: false,
        message: missing.length === 1 && pending.length === 1
          ? "Attach a photo of the change first — the customer signs what they can see."
          : `Attach a photo to each addition first (${missing.length} still without one) — the customer signs what they can see.`,
      };
    }
  }

  const variation = pending[0];
  const netCents = pending.reduce((s, v) => s + (v.credit ? -(v.price_cents ?? 0) : (v.price_cents ?? 0)), 0);

  const [{ data: est, error: estError }, { data: settingsRows }] = await Promise.all([
    supabase.from("estimates").select("builder_state, title").eq("id", variation.work_orders?.estimate_id ?? "").maybeSingle(),
    supabase.from("settings").select("key, value").eq("key", "company_profile").maybeSingle()
      .then((r) => ({ data: r.data ? [r.data] : [] })),
  ]);
  if (estError) return { ok: false, message: estError.message };
  const contact = ((est?.builder_state as { contact?: { first_name?: string; email?: string; phone?: string } } | null)?.contact) ?? null;
  const company = ((settingsRows?.[0] as { value?: { name?: string; email?: string } } | undefined)?.value) ?? {};

  const link = `${process.env.NEXT_PUBLIC_SITE_URL ?? "https://paint-group-platform.vercel.app"}/v/${token}`;
  const money = "$" + (Math.abs(netCents) / 100).toLocaleString("en-AU", { minimumFractionDigits: 2 });
  const first = contact?.first_name || "there";
  const n = pending.length;
  const what = n === 1
    ? (variation.credit
        ? `a change that takes ${money} off your job total`
        : `a change adding ${money} to your job total`)
    : netCents < 0
      ? `${n} changes that together take ${money} off your job total`
      : netCents === 0
        ? `${n} changes that leave your job total where it is`
        : `${n} changes adding ${money} to your job total`;
  const described = pending.map((v) => v.comment || "a scope change");
  const heading = n === 1
    ? "A change to your job needs your signature"
    : `${n} changes to your job need your signature`;

  const via = parsed.data.via;
  const wantEmail = via !== "sms";
  const wantSms = via !== "email";
  const result: SendVariationResult = { ok: false };

  if (wantEmail && !contact?.email && via === "email") {
    return { ok: false, message: "No email on the estimate's contact — add one, or text it instead." };
  }
  if (wantSms && !contact?.phone && via === "sms") {
    return { ok: false, message: "No mobile on the estimate's contact — add one, or email it instead." };
  }

  if (wantEmail && contact?.email) {
    if (!emailConfigured()) {
      console.log(`[variation-send:log-driver] to=${contact.email} link=${link}`);
      result.email = { status: "not_configured" };
    } else {
      const sent = await sendEmail({
        ctx: { estimateId: variation.work_orders?.estimate_id ?? null, kind: "variation" },
        to: contact.email,
        subject: `${heading} — ${company.name ?? "Paint Group"}`,
        replyTo: company.email || undefined,
        html: buildInvoiceEmailHtml({
          companyName: company.name ?? "Paint Group",
          heading,
          intro:
            `Hello ${first},\n\n` +
            `There's ${what}: ${n === 1 ? described[0] : described.join("; ")}. ` +
            `Please review and sign ${n === 1 ? "it" : "them"} at the link below — ` +
            `${n === 1 ? "nothing changes on your invoice until you do." : "they are approved together, and nothing changes on your invoice until you do."}`,
          link,
          buttonLabel: n === 1 ? "Review & sign the change" : "Review & sign the changes",
          bank: {},
          reference: null,
        }),
      });
      result.email = { status: sent.status, ...("message" in sent ? { message: sent.message } : {}) };
    }
  }

  if (wantSms && contact?.phone) {
    const to = normalisePhoneAU(contact.phone);
    if (!smsConfigured()) {
      console.log(`[variation-send:log-driver] sms=${contact.phone} link=${link}`);
      result.sms = { status: "not_configured" };
    } else if (!to) {
      result.sms = { status: "error", message: "That mobile number doesn't look Australian." };
    } else {
      const sent = await sendSms({
        ctx: { estimateId: variation.work_orders?.estimate_id ?? null, kind: "variation" },
        to,
        body: `${company.name ?? "Paint Group"}: ${what} on your job need${n === 1 ? "s" : ""} your signature. Review & sign: ${link}`,
      });
      result.sms = { status: sent.status, ...("message" in sent ? { message: sent.message } : {}) };
    }
  }

  if (!result.email && !result.sms) {
    return { ok: false, message: "No email or mobile on the estimate's contact — copy the link instead." };
  }
  result.ok = result.email?.status === "sent" || result.sms?.status === "sent"
    || result.email?.status === "not_configured" || result.sms?.status === "not_configured";
  return result;
}
