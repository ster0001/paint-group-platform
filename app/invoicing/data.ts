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
  estimates?: { title: string | null; accepted_name: string | null; job_address: string | null } | null;
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

/** Everything the dashboard needs, three round trips. */
export async function loadDashboard(supabase: SupabaseClient) {
  const { data: invoices } = await supabase
    .from("invoices")
    .select(`${INVOICE_SELECT}, estimates(title, accepted_name, job_address:sent_snapshot->>jobAddress)`)
    .order("created_at", { ascending: false })
    .limit(400);
  const rows = (invoices ?? []) as unknown as InvoiceRow[];

  const ids = rows.map((r) => r.id);
  const [{ data: payments }, { data: events }] = await Promise.all([
    ids.length
      ? supabase.from("payments")
          .select("id, invoice_id, amount_cents, surcharge_cents, status, method, paid_on, receipt_number, reference")
          .in("invoice_id", ids)
      : Promise.resolve({ data: [] }),
    supabase.from("invoice_events")
      .select("id, invoice_id, type, actor_kind, meta, created_at")
      .order("created_at", { ascending: false })
      .limit(60),
  ]);

  return {
    invoices: rows,
    payments: (payments ?? []) as PaymentRow[],
    events: (events ?? []) as EventRow[],
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

  const [{ data: payments }, { data: events }, { data: variations }] = await Promise.all([
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
          .select("id, category, comment, status, price_cents, credit, contractor_delta_cents, customer_responded_at")
          .eq("work_order_id", woId)
      : Promise.resolve({ data: [] }),
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
      customer_responded_at: string | null;
    }[],
    wo: wo as { id: string; wo_ref: string; stage: string; contractor_payment: string | null } | null,
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
