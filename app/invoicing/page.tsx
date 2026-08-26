import { createClient } from "@/lib/supabase/server";
import { melbourneDate } from "@/lib/workorder/console";
import {
  agedBucketsCents,
  ageInfo,
  dashboardTiles,
  daysBetween,
  invoiceBalanceCents,
  payablesTiles,
  stageDots,
  type DeriveInvoice,
} from "@/lib/invoicing/derive";
import { loadCostCapture, loadDashboard, toDerive, toDerivePayments, type EventRow, type InvoiceRow } from "./data";
import { STAGE_LANES, visibleStage, type WoStage } from "@/lib/workorder/stages";
import { accuracyReadout, jobCode, queueRows, SOURCE_LABEL, type ExtractedBill, type IntakeRow, type IntakeSource } from "@/lib/costs/intake";
import { COST_DOCS_BUCKET } from "@/lib/costs/store";
import { fmt2, KIND_LABEL, kindLabelWithContext, shortDay } from "./format";
import Dashboard, { type ActivityProp, type PayableRowProp, type RowProp } from "./Dashboard";
import type { CostPayableRowProp, ExpenseClaimProp, IntakeCardProp, JobPickProp, PreapprovalProp, UnmatchedMaterialProp } from "./PayablesCosts";

export const dynamic = "force-dynamic";

/**
 * §7.2 — the business-wide invoicing dashboard. Where PC Command answers
 * "what needs me today", this answers "where is every dollar, and what stage
 * is it at". Every figure below comes from lib/invoicing over raw rows —
 * the client component only renders.
 */

const METHOD_LABEL: Record<string, string> = {
  stripe_card: "card via Stripe",
  bank_transfer: "bank transfer",
  cash: "cash",
  other: "payment",
};

function eventLine(e: EventRow, byId: Map<string, InvoiceRow>): ActivityProp {
  const inv = byId.get(e.invoice_id);
  const job = inv?.estimates?.job_address || inv?.estimates?.title || "—";
  const num = inv?.number ?? (inv ? `${KIND_LABEL[inv.kind]} draft` : "");
  const meta = (v: string) => [job, num, v].filter(Boolean).join(" · ");
  const at = shortDay(e.created_at);
  const m = e.meta as { method?: string; amount_cents?: number; auto?: string; deposit_pct?: number; total_inc_cents?: number; reason?: string };
  switch (e.type) {
    case "payment_received":
      return { tone: "emerald", title: `Payment received — ${METHOD_LABEL[m.method ?? ""] ?? "payment"}`,
               meta: meta(`${fmt2(m.amount_cents ?? 0)} · ${at}`) };
    case "drafted":
      if (m.auto === "acceptance")
        return { tone: "amber", title: "Deposit auto-drafted on acceptance",
                 meta: meta(`${m.deposit_pct ?? ""}% · ${fmt2(m.total_inc_cents ?? 0)} · ${at}`) };
      if (m.auto === "final")
        return { tone: "amber", title: "Final invoice auto-drafted at sign-off",
                 meta: meta(`${fmt2(m.total_inc_cents ?? 0)} · ${at}`) };
      return { tone: "amber", title: "Payment request drafted", meta: meta(`${fmt2(m.total_inc_cents ?? 0)} · ${at}`) };
    case "issued":
      return { tone: "cyan", title: "Invoice issued", meta: meta(at) };
    case "sent":
      return { tone: "cyan", title: "Invoice sent", meta: meta(at) };
    case "viewed":
      return { tone: "cyan", title: "Invoice viewed by customer", meta: meta(at) };
    case "voided":
      return { tone: "clay", title: "Invoice voided", meta: meta(`${m.reason ?? ""} · ${at}`) };
    case "written_off":
      return { tone: "clay", title: "Invoice written off", meta: meta(at) };
    case "extension":
      return { tone: "amber", title: "Payment terms extended", meta: meta(at) };
    case "amended":
      return { tone: "amber", title: "Draft amended", meta: meta(at) };
    default:
      return { tone: "", title: e.type.replaceAll("_", " "), meta: meta(at) };
  }
}

export default async function InvoicingDashboardPage({
  searchParams,
}: {
  searchParams: Promise<{ f?: string; tab?: string }>;
}) {
  const { f, tab } = await searchParams;
  const supabase = await createClient();
  const today = melbourneDate(new Date());
  const [{ invoices, payments, events, contractorInvoices }, capture] = await Promise.all([
    loadDashboard(supabase),
    loadCostCapture(supabase),
  ]);

  const derive = toDerive(invoices);
  const dPays = toDerivePayments(payments);
  const byEstimate = new Map<string, DeriveInvoice[]>();
  for (const d of derive) {
    (byEstimate.get(d.estimateId) ?? byEstimate.set(d.estimateId, []).get(d.estimateId)!).push(d);
  }
  const byId = new Map(invoices.map((r) => [r.id, r]));

  const rows: RowProp[] = invoices.map((r) => {
    const d = derive.find((x) => x.id === r.id)!;
    const balance = invoiceBalanceCents(d, dPays);
    const age = ageInfo(d, dPays, today);
    const job = r.estimates?.job_address || r.estimates?.title || "Untitled job";
    const dots = stageDots(byEstimate.get(r.estimate_id) ?? [], dPays, today);

    let filter: RowProp["filter"] = "other";
    let ageLabel = "";
    let ageTone: RowProp["ageTone"] = "";
    if (r.status === "draft") {
      filter = "draft"; ageTone = "amber";
      ageLabel = "Awaiting review — amend or issue";
    } else if (r.status === "paid") {
      filter = "paid"; ageTone = "emerald";
      ageLabel = "Paid in full";
    } else if (age && "overdueDays" in age) {
      filter = "overdue"; ageTone = "clay";
      ageLabel = `${age.overdueDays} day${age.overdueDays === 1 ? "" : "s"} overdue`;
    } else if (r.status === "partially_paid") {
      filter = "partial"; ageTone = "cyan";
      ageLabel = age && "dueInDays" in age ? `Part paid · due in ${age.dueInDays} days` : "Part paid";
    } else if (age && "dueInDays" in age) {
      filter = "awaiting";
      ageTone = r.status === "viewed" ? "cyan" : "amber";
      const hint = r.status === "viewed" ? "viewed" : r.status === "sent" ? "sent, not yet viewed" : "issued, not yet sent";
      ageLabel = `${age.dueInDays === 0 ? "Due today" : `Due in ${age.dueInDays} days`} · ${hint}`;
    } else if (r.status === "void") {
      ageLabel = `Void — ${r.voided_reason}`;
    } else {
      ageLabel = r.status.replaceAll("_", " ");
    }

    const refBits = [
      r.number ?? "Draft (unnumbered)",
      // "$788.61 · Deposit" read as a mis-priced job (Tom, 25 Aug) — a
      // deposit row now names its fraction and the contract it's against.
      kindLabelWithContext(r.kind, r.total_inc_cents, r.estimates?.accepted_total_cents),
      r.status === "paid" ? fmt2(r.total_inc_cents) : `balance ${fmt2(balance)}`,
    ];
    // Chase-order sort key: overdue oldest first, then due soonest, then
    // drafts, then the rest, paid last.
    const overdueDays = age && "overdueDays" in age ? age.overdueDays : 0;
    const dueIn = age && "dueInDays" in age ? age.dueInDays : 9_999;
    const sortKey =
      filter === "overdue" ? 0 - overdueDays / 10_000
      : filter === "awaiting" || filter === "partial" ? 1 + dueIn / 10_000
      : filter === "draft" ? 2
      : filter === "paid" ? 3
      : 4;

    return {
      invoiceId: r.id, estimateId: r.estimate_id, job,
      ref: refBits.join(" · "),
      filter, ageLabel, ageTone,
      amtCents: filter === "paid" ? 0 : balance > 0 ? balance : r.total_inc_cents,
      dots, overdue: filter === "overdue", draft: filter === "draft",
      sortKey,
    };
  }).sort((a, b) => a.sortKey - b.sortKey);

  const tiles = dashboardTiles(derive, dPays, today);
  const buckets = agedBucketsCents(derive, dPays, today);
  const activity = events.map((e) => eventLine(e, byId));

  // Step 5 — the Payables tab: submitted first (they need a decision), then
  // approved by due date, drafts (visible, RCTI approvable), paid last.
  const payables = payablesTiles(
    contractorInvoices.map((c) => ({
      status: c.status, totalIncCents: c.total_inc_cents, dueOn: c.due_on,
    })),
    today,
  );
  const CI_SORT: Record<string, number> = { submitted: 0, approved: 1, draft: 2, paid: 3 };
  const payableRows: PayableRowProp[] = contractorInvoices
    .map((c) => {
      const due = c.due_on ? daysBetween(today, c.due_on) : null;
      const dueLabel =
        c.status === "paid" ? "Paid"
        : c.status === "draft" ? (c.rcti ? "Drafted at sign-off — RCTI, approve to issue" : "With the contractor — drafted at sign-off")
        : c.status === "submitted" ? "Submitted — approve or query"
        : due == null ? "Approved — pay when ready"
        : due < 0 ? `Approved · ${-due} day${due === -1 ? "" : "s"} past terms`
        : due === 0 ? "Approved · due today"
        : `Approved · due in ${due} day${due === 1 ? "" : "s"}`;
      const stage = c.work_orders?.stage as WoStage | undefined;
      return {
        ciId: c.id,
        estimateId: c.work_orders?.estimate_id ?? null,
        company: c.contractors?.company_name ?? "Contractor",
        ref: [
          c.number ?? "Draft (unnumbered)",
          c.auto_draft_source === "claim" ? `claim${c.claim_pct ? ` ${Number(c.claim_pct)}%` : ""}` : null,
          c.work_orders?.wo_ref, c.work_orders?.job_address,
        ].filter(Boolean).join(" · "),
        status: c.status as PayableRowProp["status"],
        amtCents: c.total_inc_cents,
        dueLabel,
        rcti: c.rcti,
        stageLabel: stage ? STAGE_LANES[visibleStage(stage)].title : "",
        hasPdf: Boolean(c.invoice_pdf_path),
      };
    })
    .sort((a, b) => (CI_SORT[a.status] ?? 9) - (CI_SORT[b.status] ?? 9));

  // ---- Step 6a: the cost-capture section of the Payables tab ----
  const jobsForPick: JobPickProp[] = capture.jobs.map((j) => ({
    woId: j.id,
    estimateId: j.estimate_id,
    label: [jobCode(j.job_no), j.job_address ?? "Unnamed job"].filter(Boolean).join(" · "),
  }));
  const jobLabelByWo = new Map(jobsForPick.map((j) => [j.woId, j.label]));

  const queue = queueRows(
    capture.intake.map((r) => ({ ...r, status: r.status as IntakeRow["status"] })),
  );
  const docPaths = [
    ...queue.map((q) => q.raw_doc_path),
    ...capture.jobCosts.map((c) => c.doc_path),
    ...capture.expenses.map((e) => e.receipt_path),
  ].filter((p): p is string => Boolean(p));
  const docUrlByPath = new Map<string, string>();
  if (docPaths.length) {
    const { data: signed } = await supabase.storage
      .from(COST_DOCS_BUCKET)
      .createSignedUrls([...new Set(docPaths)], 600);
    for (const s of signed ?? []) {
      if (s.signedUrl && s.path) docUrlByPath.set(s.path, s.signedUrl);
    }
  }

  const MATCH_WHY: Record<string, string> = {
    order_ref: "matched on order reference",
    address: "address found in the document",
    vendor_memory: "known vendor — job unmatched",
    none: "",
  };
  const cards: IntakeCardProp[] = queue.map((q) => {
    const e = (q.extracted ?? {}) as ExtractedBill;
    const failed = q.extract_status === "failed";
    const isPdf = Boolean(q.raw_doc_path?.toLowerCase().endsWith(".pdf"));
    const conf =
      q.match_reason === "order_ref" && typeof e.confidence?.order_ref === "number"
        ? Math.round(e.confidence.order_ref * 100)
        : null;
    return {
      intakeId: q.id,
      title: `${e.supplier || q.from_email || "Document"} — ${q.source === "photo" ? "receipt" : "invoice"}`,
      sourceChip: `${SOURCE_LABEL[q.source as IntakeSource] ?? q.source}${isPdf ? " · PDF" : ""}`,
      kv: [
        { k: "Invoice no.", v: e.invoice_no || "—" },
        { k: "Date", v: e.invoice_date ? shortDay(e.invoice_date) : "—" },
        { k: "Total inc GST", v: e.total_cents ? fmt2(e.total_cents) : "—" },
        { k: "GST", v: e.gst_cents ? fmt2(e.gst_cents) : "—" },
        // Tom's ruling 25 Aug: the supplier's reference IS the job address —
        // show it so the proposed match can be sanity-checked at a glance.
        { k: "Reference", v: e.order_ref || "—" },
      ],
      failed,
      duplicate: q.status === "duplicate",
      duplicateNote:
        "Looks like a document already recorded (same vendor + invoice number, or same total, date and sender). No cost was written.",
      matchLabel: q.proposed_wo_id ? jobLabelByWo.get(q.proposed_wo_id) ?? null : null,
      matchWhy: MATCH_WHY[q.match_reason] || null,
      confidencePct: conf,
      proposedWoId: q.proposed_wo_id,
      vendorId: q.proposed_vendor_id,
      vendorName: e.supplier ?? "",
      totalCents: e.total_cents ?? 0,
      gstCents: e.gst_cents ?? 0,
      invoiceNo: e.invoice_no ?? "",
      invoiceDate: e.invoice_date ?? null,
      docUrl: q.raw_doc_path ? docUrlByPath.get(q.raw_doc_path) ?? null : null,
    };
  });

  const unmatched: UnmatchedMaterialProp[] = capture.unmatchedMaterials.map((m) => ({
    id: m.id,
    label: [m.supplier || "Materials", fmt2(m.amount_cents), m.invoice_date ? shortDay(m.invoice_date) : null]
      .filter(Boolean).join(" · "),
    hint: [m.order_ref, m.address_text].filter(Boolean).join(" · ") || "no reference on the record",
  }));

  const costRows: CostPayableRowProp[] = capture.jobCosts
    .filter((c) => c.status !== "paid")
    .map((c) => ({
      id: c.id,
      estimateId: c.work_orders?.estimate_id ?? null,
      vendor: c.vendors?.name || c.description || "Cost",
      ref: [
        c.invoice_no || null,
        c.category.replaceAll("_", " "),
        jobCode(c.work_orders?.job_no ?? null) || null,
        c.work_orders?.job_address ?? null,
      ].filter(Boolean).join(" · "),
      status: c.status as CostPayableRowProp["status"],
      amtCents: c.amount_ex_cents + c.gst_cents,
      docUrl: c.doc_path ? docUrlByPath.get(c.doc_path) ?? null : null,
    }));

  const expenseClaims: ExpenseClaimProp[] = capture.expenses.map((e) => ({
    id: e.id,
    contractor: e.contractors?.company_name || "Contractor",
    ref: [
      e.category.replaceAll("_", " "),
      jobCode(e.work_orders?.job_no ?? null) || null,
      e.work_orders?.job_address ?? null,
    ].filter(Boolean).join(" · "),
    amtCents: e.amount_cents,
    overThreshold: e.over_threshold_unapproved,
    note: e.note,
    receiptUrl: docUrlByPath.get(e.receipt_path) ?? null,
  }));
  const preapprovalCards: PreapprovalProp[] = capture.preapprovals.map((p) => ({
    id: p.id,
    contractor: p.contractors?.company_name || "Contractor",
    ref: [
      jobCode(p.work_orders?.job_no ?? null) || null,
      p.work_orders?.job_address ?? null,
    ].filter(Boolean).join(" · "),
    description: p.description,
    estCents: p.est_cents,
  }));

  const accuracy = accuracyReadout(
    capture.intake.map((r) => ({
      status: r.status as IntakeRow["status"],
      match_reason: r.match_reason as IntakeRow["match_reason"],
      proposed_wo_id: r.proposed_wo_id,
      confirmed_wo_id: r.confirmed_wo_id,
      confirmed_at: r.confirmed_at,
    })),
    today,
  );

  return (
    <Dashboard
      tiles={tiles}
      buckets={buckets}
      rows={rows}
      activity={activity}
      initialFilter={f ?? "all"}
      initialTab={tab ?? "recv"}
      payables={payables}
      payableRows={payableRows}
      costs={{ cards, jobs: jobsForPick, unmatched, costRows, accuracy, expenseClaims, preapprovals: preapprovalCards }}
    />
  );
}
