/**
 * Part B · write one built job. Shared by scripts/import/paintscout-booked.ts
 * and app/api/inbound/airtable-jobs, so the sequence exists once:
 *
 *   1. the customer: lib/accounts/link.ts `ensureAccountAndProperty` — the
 *      same identity rule the wizard uses (email OR phone, address key) —
 *      then the provenance columns on anything it created;
 *   2. `import_booked_job` (migration 20270152): estimate + working scope +
 *      silent acceptance + the work order in the tray, in one transaction
 *      under the import switch. Idempotent on the import key.
 *
 * Runs with the service client only. Nothing here sends anything.
 */

import { randomBytes } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import { ensureAccountAndProperty } from "@/lib/accounts/link";
import { loadPricingContext } from "@/lib/pricing/context";
import type { PricingContext } from "@/lib/pricing/estimate";
import { buildBookedJob, IMPORT_NAME, SubstrateResolver, type BuiltBookedJob, type CompanyLetterhead } from "./build";
import type { BookedJob } from "./types";

export type BookedWriteContext = {
  pricing: PricingContext;
  company: CompanyLetterhead;
  card: { id: string; version: number | null };
};

/** The reference data a write needs, loaded once per run. */
export async function loadBookedWriteContext(db: SupabaseClient): Promise<BookedWriteContext> {
  const [pricing, cardRes, companyRes] = await Promise.all([
    loadPricingContext(db),
    db.from("rate_cards").select("id, version").eq("is_active", true).single(),
    db.from("settings").select("value").eq("key", "company_profile").maybeSingle(),
  ]);
  if (cardRes.error || !cardRes.data) throw new Error(`no active rate card: ${cardRes.error?.message ?? "none"}`);
  if (pricing.rateItems.length === 0) throw new Error("the active rate card has no rate items");
  const raw = (companyRes.data?.value ?? {}) as Partial<CompanyLetterhead>;
  const company: CompanyLetterhead = {
    name: raw.name ?? "", addressLine1: raw.addressLine1 ?? "", addressLine2: raw.addressLine2 ?? "", phone: raw.phone ?? "",
    abn: raw.abn ?? "", email: raw.email ?? "", estimatorName: raw.estimatorName ?? "", estimatorTitle: raw.estimatorTitle ?? "",
    estimatorPhone: raw.estimatorPhone ?? "", logoUrl: raw.logoUrl ?? "", logoUrlLight: raw.logoUrlLight,
  };
  return { pricing, company, card: { id: cardRes.data.id as string, version: (cardRes.data.version as number | null) ?? null } };
}

/** ≥ 24 chars from crypto.randomBytes, base64url (CLAUDE.md · public tokens). */
export function newShareToken(): string {
  return randomBytes(42).toString("base64url");
}

export type BookedWriteResult = {
  quoteNo: string;
  status: "created" | "exists" | "note_updated";
  estimateId: string;
  workOrderId: string | null;
  accountId: string;
  propertyId: string | null;
  accountCreated: boolean;
  totals: BuiltBookedJob["totals"];
  roundingNotes: string[];
};

export async function writeBookedJob(
  db: SupabaseClient,
  job: BookedJob,
  resolver: SubstrateResolver,
  wctx: BookedWriteContext,
  opts: { importName?: string; updateNote?: boolean; hoursPending?: boolean } = {},
): Promise<BookedWriteResult> {
  const importName = opts.importName ?? IMPORT_NAME;
  const shareToken = newShareToken();
  const built = buildBookedJob(job, resolver, wctx.pricing, wctx.company, shareToken);

  // 1 · the customer, through the platform's own identity rule.
  const before = await db.from("accounts").select("id").eq("email", job.email.trim().toLowerCase()).maybeSingle();
  const linked = await ensureAccountAndProperty(db, {
    email: job.email || null, name: job.customer_name, phone: job.phone || null,
    address: { street: job.address || job.paintscout_address, suburb: job.suburb || null, postcode: job.postcode || null, state: "VIC" },
  });
  if (!linked.accountId) throw new Error(`quote ${job.quote_no}: no reachable customer (email "${job.email}", phone "${job.phone}")`);
  const accountCreated = !before.data;
  if (accountCreated) {
    await db.from("accounts").update({
      source: "paintscout", external_ref: { account_key: job.account_key || null, quote_no: job.quote_no, origin: "paintscout-booked" },
    }).eq("id", linked.accountId).is("external_ref", null);
    await db.from("crm_import_keys").upsert(
      { import: importName, key: `${job.account_key || `acc_q${job.quote_no}`}`, table_name: "accounts", row_id: linked.accountId },
      { onConflict: "import,key", ignoreDuplicates: true },
    );
  }
  if (linked.propertyId) {
    await db.from("properties").update({ source: "paintscout", external_ref: { quote_no: job.quote_no, paintscout_address: job.paintscout_address || null } })
      .eq("id", linked.propertyId).is("external_ref", null).eq("source", "platform");
  }

  // 2 · the job, silently.
  const payload = {
    import: importName,
    key: `bk_${job.quote_no}`,
    account_id: linked.accountId,
    property_id: linked.propertyId,
    title: built.title,
    level_of_finish: job.level_of_finish,
    size_band: job.total_inc_gst_cents < 1_000_000 ? "under_10k" : job.total_inc_gst_cents < 2_000_000 ? "10_to_20k" : "over_20k",
    job_kind: "residential",
    rate_card_id: wctx.card.id,
    rate_card_version: wctx.card.version,
    subtotal_cents: built.totals.subtotalCents,
    total_cents: built.totals.totalCents,
    accepted_at: new Date(job.date_accepted_ms).toISOString(),
    accepted_name: job.customer_name,
    share_token: shareToken,
    builder_state: built.builderState,
    sent_snapshot: built.sentSnapshot,
    external_ref: { ...built.externalRef, hours_pending: opts.hoursPending === true },
    wo_ref: `PS-${job.quote_no}`,
    contractor_payment_cents: job.contractor_offer_cents ?? null,
    wo_snapshot: built.woDoc,
    access_notes: "",
    tray_note: built.trayNote,
    update_note: opts.updateNote === true,
  };
  const { data, error } = await db.rpc("import_booked_job", { p: payload });
  if (error) throw new Error(`quote ${job.quote_no}: import_booked_job: ${error.message}`);
  const r = data as { status: BookedWriteResult["status"]; estimate_id: string; work_order_id: string | null };
  return {
    quoteNo: job.quote_no, status: r.status, estimateId: r.estimate_id, workOrderId: r.work_order_id ?? null,
    accountId: linked.accountId, propertyId: linked.propertyId, accountCreated,
    totals: built.totals, roundingNotes: built.roundingNotes,
  };
}
