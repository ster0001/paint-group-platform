import type { SupabaseClient } from "@supabase/supabase-js";
import type { DeriveInvoice, DerivePayment, InvoiceKind } from "@/lib/invoicing/derive";
import type { InvoiceStatus } from "@/lib/invoicing/stateMachine";

/**
 * Server-side row fetching + mapping for the §7 screens. Read-only: every
 * figure the screens show is computed by lib/invoicing (or the
 * invoice_ledger_staff RPC) over these rows — never in a component.
 */

export type InvoiceRow = {
  id: string;
  estimate_id: string;
  work_order_id: string | null;
  kind: InvoiceKind;
  status: InvoiceStatus;
  number: string | null;
  total_inc_cents: number;
  subtotal_ex_cents: number;
  gst_cents: number;
  issued_on: string | null;
  due_on: string | null;
  created_at: string;
  token: string;
  voided_reason: string;
  estimates?: {
    title: string | null; accepted_name: string | null; job_address: string | null;
    accepted_total_cents?: number | null;
  } | null;
};

export type PaymentRow = {
  id: string;
  invoice_id: string;
  amount_cents: number;
  surcharge_cents: number;
  status: string;
  method: string | null;
  paid_on: string | null;
  receipt_number: string | null;
  reference: string;
};

export type LineRow = {
  id: string;
  invoice_id: string;
  sort: number;
  source: "estimate_snapshot" | "variation" | "manual" | "adjustment";
  source_ref: string | null;
  description: string;
  amount_ex_cents: number;
};

export type EventRow = {
  id: string;
  invoice_id: string;
  type: string;
  actor_kind: string;
  meta: Record<string, unknown>;
  created_at: string;
};

export type Ledger = {
  accepted_total_cents: number;
  variations_cents: number;
  adjusted_contract_cents: number;
  invoiced_cents: number;
  paid_cents: number;
  balance_cents: number;
};

export const INVOICE_SELECT =
  "id, estimate_id, work_order_id, kind, status, number, total_inc_cents, subtotal_ex_cents, gst_cents, issued_on, due_on, created_at, token, voided_reason";

export function toDerive(rows: readonly InvoiceRow[]): DeriveInvoice[] {
  return rows.map((r) => ({
    id: r.id,
    estimateId: r.estimate_id,
    kind: r.kind,
    status: r.status,
    totalIncCents: r.total_inc_cents,
    dueOn: r.due_on,
    issuedOn: r.issued_on,
  }));
}

export function toDerivePayments(rows: readonly PaymentRow[]): DerivePayment[] {
  return rows.map((p) => ({
    invoiceId: p.invoice_id,
    amountCents: p.amount_cents,
    status: p.status,
    paidOn: p.paid_on,
  }));
}

export type ContractorInvoiceRow = {
  id: string; number: string | null; status: string;
  total_inc_cents: number; due_on: string | null;
  submitted_at: string | null; approved_at: string | null; paid_at: string | null;
  rcti: boolean; auto_draft_source: string; claim_pct: number | null;
  invoice_pdf_path: string | null;
  contractors: { company_name: string | null } | null;
  work_orders: { wo_ref: string; estimate_id: string; stage: string; job_address: string | null } | null;
};

// ---- Step 6a: cost capture rows -------------------------------------------

export type IntakeDbRow = {
  id: string;
  source: string;
  raw_doc_path: string | null;
  from_email: string;
  subject: string;
  extracted: Record<string, unknown>;
  extract_status: string;
  proposed_vendor_id: string | null;
  proposed_wo_id: string | null;
  match_reason: string;
  status: string;
  duplicate_of: string | null;
  confirmed_wo_id: string | null;
  confirmed_at: string | null;
  created_at: string;
};

export type JobCostRow = {
  id: string;
  work_order_id: string;
  category: string;
  description: string;
  amount_ex_cents: number;
  gst_cents: number;
  doc_path: string | null;
  estimate_line_ref: string | null;
  status: string;
  paid_with: string;
  invoice_no: string;
  invoice_date: string | null;
  intake_id: string | null;
  created_at: string;
  vendors: { name: string } | null;
  work_orders: { estimate_id: string; wo_ref: string; job_no: number | null; job_address: string | null } | null;
};

export type MaterialCostRow = {
  id: string;
  work_order_id: string | null;
  supplier: string;
  brand: string;
  order_ref: string;
  address_text: string;
  amount_cents: number;
  invoice_date: string | null;
  source: string;
  intake_id: string | null;
  created_at: string;
};

export type JobPickRow = {
  id: string; // work order id
  estimate_id: string;
  job_no: number | null;
  stage: string;
  job_address: string | null;
};

/**
 * The 6a rows, fetched tolerantly: until migration 20261122 runs these tables
 * and columns don't exist, and every query degrades to an empty list so the
 * deployed code stays inert-but-safe (house law).
 */
export async function loadCostCapture(supabase: SupabaseClient) {
  const [intake, jobCosts, unmatched, jobs] = await Promise.all([
    supabase.from("cost_intake")
      .select("id, source, raw_doc_path, from_email, subject, extracted, extract_status, proposed_vendor_id, proposed_wo_id, match_reason, status, duplicate_of, confirmed_wo_id, confirmed_at, created_at")
      .order("created_at", { ascending: false })
      .limit(200),
    supabase.from("job_costs")
      .select("id, work_order_id, category, description, amount_ex_cents, gst_cents, doc_path, estimate_line_ref, status, paid_with, invoice_no, invoice_date, intake_id, created_at, vendors(name), work_orders(estimate_id, wo_ref, job_no, job_address:wo_snapshot->>jobAddress)")
      .order("created_at", { ascending: false })
      .limit(200),
    supabase.from("material_costs")
      .select("id, work_order_id, supplier, brand, order_ref, address_text, amount_cents, invoice_date, source, intake_id, created_at")
      .is("work_order_id", null)
      .order("created_at", { ascending: false })
      .limit(100),
    supabase.from("work_orders")
      .select("id, estimate_id, job_no, stage, job_address:wo_snapshot->>jobAddress")
      .neq("stage", "closed")
      .order("created_at", { ascending: false })
      .limit(100),
  ]);
  return {
    intake: (intake.error ? [] : intake.data ?? []) as unknown as IntakeDbRow[],
    jobCosts: (jobCosts.error ? [] : jobCosts.data ?? []) as unknown as JobCostRow[],
    unmatchedMaterials: (unmatched.error ? [] : unmatched.data ?? []) as unknown as MaterialCostRow[],
    jobs: (jobs.error ? [] : jobs.data ?? []) as unknown as JobPickRow[],
  };
}

/** One job's costs (§7.1 Costs tab) — tolerant like loadCostCapture. */
export async function loadJobCosts(supabase: SupabaseClient, woId: string) {
  const [jobCosts, materials] = await Promise.all([
    supabase.from("job_costs")
      .select("id, work_order_id, category, description, amount_ex_cents, gst_cents, doc_path, estimate_line_ref, status, paid_with, invoice_no, invoice_date, intake_id, created_at, vendors(name)")
      .eq("work_order_id", woId)
      .order("created_at", { ascending: true }),
    supabase.from("material_costs")
      .select("id, work_order_id, supplier, brand, order_ref, address_text, amount_cents, invoice_date, source, intake_id, created_at")
      .eq("work_order_id", woId)
      .order("created_at", { ascending: true }),
  ]);
  return {
    jobCosts: (jobCosts.error ? [] : jobCosts.data ?? []) as unknown as (Omit<JobCostRow, "work_orders">)[],
    materials: (materials.error ? [] : materials.data ?? []) as unknown as MaterialCostRow[],
  };
}

/** Everything the dashboard needs, four round trips. */
export async function loadDashboard(supabase: SupabaseClient) {
  const { data: invoices } = await supabase
    .from("invoices")
    .select(`${INVOICE_SELECT}, estimates(title, accepted_name, accepted_total_cents, job_address:sent_snapshot->>jobAddress)`)
    .order("created_at", { ascending: false })
    .limit(400);
  const rows = (invoices ?? []) as unknown as InvoiceRow[];

  const ids = rows.map((r) => r.id);
  const [{ data: payments }, { data: events }, { data: cis }] = await Promise.all([
    ids.length
      ? supabase.from("payments")
          .select("id, invoice_id, amount_cents, surcharge_cents, status, method, paid_on, receipt_number, reference")
          .in("invoice_id", ids)
      : Promise.resolve({ data: [] }),
    supabase.from("invoice_events")
      .select("id, invoice_id, type, actor_kind, meta, created_at")
      .order("created_at", { ascending: false })
      .limit(60),
    // Step 5: the Payables tab — contractor invoices across every job.
    supabase.from("contractor_invoices")
      .select("id, number, status, total_inc_cents, due_on, submitted_at, approved_at, paid_at, rcti, auto_draft_source, claim_pct, invoice_pdf_path, contractors(company_name), work_orders(wo_ref, estimate_id, stage, job_address:wo_snapshot->>jobAddress)")
      .order("created_at", { ascending: false })
      .limit(200),
  ]);

  return {
    invoices: rows,
    payments: (payments ?? []) as PaymentRow[],
    events: (events ?? []) as EventRow[],
    contractorInvoices: (cis ?? []) as unknown as ContractorInvoiceRow[],
  };
}

/** One job's whole money picture (§7.1). */
export async function loadJobMoney(supabase: SupabaseClient, estimateId: string) {
  const [{ data: estimate }, ledgerRes, { data: invoices }, { data: wo }] = await Promise.all([
    supabase.from("estimates")
      .select("id, title, accepted_name, accepted_at, job_address:sent_snapshot->>jobAddress, job_title:sent_snapshot->>jobTitle")
      .eq("id", estimateId).maybeSingle(),
    supabase.rpc("invoice_ledger_staff", { p_estimate_id: estimateId }),
    supabase.from("invoices").select(INVOICE_SELECT)
      .eq("estimate_id", estimateId).order("created_at", { ascending: true }),
    supabase.from("work_orders")
      .select("id, wo_ref, stage, contractor_id, contractor_payment:wo_snapshot->>contractorPaymentCents")
      .eq("estimate_id", estimateId).maybeSingle(),
  ]);

  const rows = (invoices ?? []) as InvoiceRow[];
  const ids = rows.map((r) => r.id);
  const woId = (wo as { id?: string } | null)?.id;

  const [{ data: payments }, { data: events }, { data: variations }, { data: ciRow }] = await Promise.all([
    ids.length
      ? supabase.from("payments")
          .select("id, invoice_id, amount_cents, surcharge_cents, status, method, paid_on, receipt_number, reference")
          .in("invoice_id", ids)
      : Promise.resolve({ data: [] }),
    ids.length
      ? supabase.from("invoice_events")
          .select("id, invoice_id, type, actor_kind, meta, created_at")
          .in("invoice_id", ids).order("created_at", { ascending: false }).limit(40)
      : Promise.resolve({ data: [] }),
    woId
      ? supabase.from("wo_variations")
          .select("id, category, comment, status, price_cents, credit, contractor_delta_cents, customer_responded_at, signed_name, signed_at, needs_manual_deduction, deduction_cents")
          .eq("work_order_id", woId)
      : Promise.resolve({ data: [] }),
    woId
      ? supabase.from("contractor_invoices")
          .select("id, number, status, total_inc_cents")
          .eq("work_order_id", woId).order("created_at", { ascending: false }).limit(1).maybeSingle()
      : Promise.resolve({ data: null }),
  ]);

  const ledger = ((ledgerRes.data as Ledger[] | null) ?? [])[0] ?? null;

  return {
    estimate: estimate as {
      id: string; title: string | null; accepted_name: string | null; accepted_at: string | null;
      job_address: string | null; job_title: string | null;
    } | null,
    ledger,
    invoices: rows,
    payments: (payments ?? []) as PaymentRow[],
    events: (events ?? []) as EventRow[],
    variations: (variations ?? []) as {
      id: string; category: string; comment: string; status: string;
      price_cents: number | null; credit: boolean; contractor_delta_cents: number | null;
      customer_responded_at: string | null; signed_name: string | null; signed_at: string | null;
      needs_manual_deduction: boolean; deduction_cents: number | null;
    }[],
    wo: wo as { id: string; wo_ref: string; stage: string; contractor_payment: string | null } | null,
    contractorInvoice: ciRow as {
      id: string; number: string | null; status: string; total_inc_cents: number;
    } | null,
  };
}

/** One invoice document (§7.3). */
export async function loadInvoiceDoc(supabase: SupabaseClient, invoiceId: string) {
  const { data: invoice } = await supabase
    .from("invoices")
    .select(`${INVOICE_SELECT}, estimates(title, accepted_name, job_address:sent_snapshot->>jobAddress, job_title:sent_snapshot->>jobTitle)`)
    .eq("id", invoiceId).maybeSingle();
  if (!invoice) return null;
  const inv = invoice as unknown as InvoiceRow & {
    estimates: { title: string | null; accepted_name: string | null; job_address: string | null; job_title: string | null } | null;
  };

  const [{ data: lines }, jobRes, driftRes, { data: settings }] = await Promise.all([
    supabase.from("invoice_lines")
      .select("id, invoice_id, sort, source, source_ref, description, amount_ex_cents")
      .eq("invoice_id", invoiceId).order("sort", { ascending: true }),
    loadJobMoney(supabase, inv.estimate_id),
    inv.kind === "final" && inv.status === "draft"
      ? supabase.rpc("invoice_final_drift_staff", { p_invoice_id: invoiceId })
      : Promise.resolve({ data: 0 }),
    supabase.from("settings").select("key, value").in("key", ["invoicing_entity", "invoicing_bank"]),
  ]);

  const settingRows = (settings ?? []) as { key: string; value: Record<string, string> }[];
  return {
    invoice: inv,
    lines: (lines ?? []) as LineRow[],
    job: jobRes,
    driftCents: Number(driftRes.data ?? 0),
    entity: settingRows.find((s) => s.key === "invoicing_entity")?.value ?? {},
    bank: settingRows.find((s) => s.key === "invoicing_bank")?.value ?? {},
  };
}
