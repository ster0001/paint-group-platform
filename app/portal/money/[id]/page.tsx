import { notFound } from "next/navigation";
import { moneyAbs as money } from "@/lib/format/money";
import Link from "next/link";
import { requireContractor } from "@/lib/contractor/session";
import { missingProfileFields } from "@/lib/contractor/model";
import { createClient } from "@/lib/supabase/server";
import { signedDocUrl } from "@/lib/invoicing/pdf";
import { ciDocumentHeading } from "@/lib/invoicing/ciStateMachine";
import { gstFromIncCents } from "@/lib/invoicing/gst";
import SubmitInvoice from "./SubmitInvoice";

export const dynamic = "force-dynamic";

const dateFmt = (iso: string | null) =>
  iso ? new Date(iso.slice(0, 10) + "T00:00:00").toLocaleDateString("en-AU", { day: "numeric", month: "long", year: "numeric" }) : "";

type DeductionLine = { label?: string; cents?: number; note?: string; manual?: boolean };

/**
 * One contractor invoice, reviewed before the one-tap submit (Step 5).
 *
 * While it's a DRAFT the figures shown are LIVE — the same rule the submit
 * RPC applies (offer + accepted additions − deductions, manual deduction
 * winning) — so a deduction the office set five minutes ago is already on
 * screen. Once submitted, the stored, pinned figures are the document.
 */
export default async function ContractorInvoicePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { contractor } = await requireContractor();
  const supabase = await createClient();

  const { data } = await supabase
    .from("contractor_invoices")
    .select("id, number, status, offer_cents, variation_delta_cents, deduction_lines, subtotal_ex_cents, gst_cents, total_inc_cents, due_on, submitted_at, approved_at, paid_at, bank_reference, remittance_number, remittance_pdf_path, gst_registered_at_submit, entity_snapshot, rcti, work_order_id, auto_draft_source, claim_pct, previously_invoiced_cents, invoice_pdf_path, work_orders(wo_ref, contractor_payment_cents, wo_snapshot)")
    .eq("id", id).maybeSingle();
  const ci = data as {
    id: string; number: string | null; status: string;
    offer_cents: number; variation_delta_cents: number; deduction_lines: DeductionLine[];
    subtotal_ex_cents: number; gst_cents: number; total_inc_cents: number;
    due_on: string | null; submitted_at: string | null; approved_at: string | null;
    paid_at: string | null; bank_reference: string; remittance_number: string | null;
    remittance_pdf_path: string | null; gst_registered_at_submit: boolean | null;
    entity_snapshot: Record<string, string>; rcti: boolean; work_order_id: string;
    auto_draft_source: string; claim_pct: number | null;
    previously_invoiced_cents: number; invoice_pdf_path: string | null;
    work_orders: { wo_ref: string; contractor_payment_cents: number | null; wo_snapshot: { jobTitle?: string; jobAddress?: string } | null } | null;
  } | null;
  if (!ci) notFound();

  const draft = ci.status === "draft";

  // Live figures for a draft — the same arithmetic the submit RPC runs.
  let offer = ci.offer_cents;
  let additions = ci.variation_delta_cents;
  let deductions: DeductionLine[] = Array.isArray(ci.deduction_lines) ? ci.deduction_lines : [];
  let pendingDeduction = false;
  if (draft) {
    const { data: varRows } = await supabase
      .from("wo_variations")
      .select("comment, category, status, credit, contractor_delta_cents, deduction_cents, needs_manual_deduction, deduction_note, created_at")
      .eq("work_order_id", ci.work_order_id)
      .order("created_at");
    const vars = ((varRows ?? []) as {
      comment: string; category: string; status: string; credit: boolean;
      contractor_delta_cents: number | null; deduction_cents: number | null;
      needs_manual_deduction: boolean; deduction_note: string;
    }[]);
    offer = ci.work_orders?.contractor_payment_cents ?? ci.offer_cents;
    additions = vars
      .filter((v) => v.status === "contractor_accepted" && !v.credit)
      .reduce((s, v) => s + (v.contractor_delta_cents ?? 0), 0);
    deductions = vars
      .filter((v) => v.status === "contractor_accepted" && v.credit)
      .map((v) => ({
        label: v.comment?.trim() || v.category.replace(/_/g, " "),
        cents: v.needs_manual_deduction
          ? v.deduction_cents ?? 0
          : v.deduction_cents ?? v.contractor_delta_cents ?? 0,
        note: v.deduction_note,
        manual: v.needs_manual_deduction,
      }))
      .filter((d) => (d.cents ?? 0) > 0);
    pendingDeduction = vars.some(
      (v) => v.credit && v.needs_manual_deduction && v.deduction_cents == null
        && (v.status === "customer_approved" || v.status === "contractor_accepted"),
    );
  }
  const deductionCents = deductions.reduce((s, d) => s + (d.cents ?? 0), 0);
  // A final only claims what earlier invoices haven't (claims live here too).
  let prevInvoiced = ci.previously_invoiced_cents ?? 0;
  if (draft) {
    const { data: siblings } = await supabase
      .from("contractor_invoices").select("total_inc_cents")
      .eq("work_order_id", ci.work_order_id).neq("status", "draft");
    prevInvoiced = ((siblings ?? []) as { total_inc_cents: number }[])
      .reduce((s, r) => s + r.total_inc_cents, 0);
  }
  const isClaim = ci.auto_draft_source === "claim";
  const total = draft
    ? Math.max(0, offer + additions - deductionCents - prevInvoiced)
    : ci.total_inc_cents;
  const gstRegistered = draft ? (contractor?.gst_registered ?? false) : (ci.gst_registered_at_submit ?? false);
  const gst = draft ? (gstRegistered ? gstFromIncCents(total) : 0) : ci.gst_cents;
  const heading = ciDocumentHeading(gstRegistered);

  const missing = missingProfileFields(contractor);
  const blocked = !draft ? null
    : missing.length
      ? `Submitting is held until your company profile has ${missing.join(", ")} — finish it under Profile.`
      : pendingDeduction
        ? "The office is finalising a pay adjustment on this job — the figure appears here before you can submit."
        : null;

  const remittanceUrl = ci.remittance_pdf_path ? await signedDocUrl(ci.remittance_pdf_path) : null;
  const title = ci.work_orders?.wo_snapshot?.jobTitle || ci.work_orders?.wo_snapshot?.jobAddress || ci.work_orders?.wo_ref;

  return (
    <div className="wrap">
      <Link href="/portal/money" className="btn dim" style={{ marginBottom: 10 }}>← Invoicing</Link>
      <h1>{ci.number ?? "Draft invoice"}</h1>
      <p className="slab">{title} · {ci.work_orders?.wo_ref}</p>

      <div className="card" data-testid="ci-document">
        <div style={{ display: "flex", alignItems: "baseline", gap: 10 }}>
          {/* The heading is a legal statement: only a GST-registered entity
              issues a TAX INVOICE. Pinned at submission. */}
          <b data-testid="ci-heading" style={{ letterSpacing: ".06em" }}>{heading}</b>
          <span className={`chip ${ci.status === "paid" ? "grn" : ci.status === "approved" ? "cyn" : "amb"}`} data-testid="ci-status">
            {ci.status === "draft" ? "Ready to check & submit"
              : ci.status === "submitted" ? "With the office"
              : ci.status === "approved" ? "Approved — payment coming"
              : "Paid"}
          </span>
          {ci.rcti && <span className="chip gry">RCTI</span>}
        </div>

        <div style={{ marginTop: 12, fontSize: "13px" }}>
          {isClaim ? (
            <div style={{ display: "flex", padding: "8px 0", borderBottom: "1px solid var(--line)" }} data-testid="ci-claim-line">
              <span>
                Progress payment claim — {ci.work_orders?.wo_ref}
                {ci.claim_pct ? ` (${Number(ci.claim_pct)}% of contract)` : ""}
              </span>
              <b style={{ marginLeft: "auto", fontFamily: "var(--mono, monospace)" }}>{money(ci.total_inc_cents)}</b>
            </div>
          ) : (
          <>
          <div style={{ display: "flex", padding: "8px 0", borderBottom: "1px solid var(--line)" }}>
            <span>Contract work — {ci.work_orders?.wo_ref}</span>
            <b style={{ marginLeft: "auto", fontFamily: "var(--mono, monospace)" }}>{money(offer)}</b>
          </div>
          {additions > 0 && (
            <div style={{ display: "flex", padding: "8px 0", borderBottom: "1px solid var(--line)" }}>
              <span>Approved variations</span>
              <b style={{ marginLeft: "auto", fontFamily: "var(--mono, monospace)" }} data-testid="ci-additions">{money(additions)}</b>
            </div>
          )}
          {deductions.map((d, i) => (
            <div key={i} style={{ display: "flex", padding: "8px 0", borderBottom: "1px solid var(--line)" }} data-testid={`ci-deduction-${i}`}>
              <span>
                Less — {d.label}
                {d.manual ? <em style={{ color: "var(--muted)" }}> (set by the office)</em> : null}
                {d.note ? <span style={{ display: "block", fontSize: "11.5px", color: "var(--muted)" }}>{d.note}</span> : null}
              </span>
              <b style={{ marginLeft: "auto", fontFamily: "var(--mono, monospace)", color: "var(--clay)" }}>−{money(d.cents ?? 0)}</b>
            </div>
          ))}
          {prevInvoiced > 0 && (
            <div style={{ display: "flex", padding: "8px 0", borderBottom: "1px solid var(--line)" }} data-testid="ci-prev-invoiced">
              <span>Less previously invoiced</span>
              <b style={{ marginLeft: "auto", fontFamily: "var(--mono, monospace)", color: "var(--clay)" }}>−{money(prevInvoiced)}</b>
            </div>
          )}
          </>
          )}
          <div style={{ display: "flex", padding: "10px 0 2px", fontSize: "15px" }}>
            <b>Total</b>
            <b style={{ marginLeft: "auto", fontFamily: "var(--mono, monospace)" }} data-testid="ci-total">{money(total)}</b>
          </div>
          <div style={{ display: "flex", fontSize: "12px", color: "var(--muted)" }}>
            <span>{gstRegistered ? "Includes GST of" : "No GST — not registered"}</span>
            <span style={{ marginLeft: "auto", fontFamily: "var(--mono, monospace)" }} data-testid="ci-gst">
              {gstRegistered ? money(gst) : "$0.00"}
            </span>
          </div>
        </div>

        {ci.due_on && ci.status !== "paid" && (
          <p className="hint" style={{ marginTop: 10 }}>Payment due {dateFmt(ci.due_on)}.</p>
        )}

        {ci.status !== "draft" && (
          <a className="btn gh" href={`/portal/money/${ci.id}/pdf`} target="_blank" rel="noreferrer"
            data-testid="ci-pdf-link" style={{ marginTop: 10 }}>
            Download invoice PDF
          </a>
        )}

        {draft && (
          <>
            <p className="hint" style={{ marginTop: 10 }}>
              Drafted for you at sign-off. Check the figures — submitting locks
              them and sends the invoice to the office under your company
              details{gstRegistered ? " as a Tax Invoice" : " (no GST — you're not registered)"}.
            </p>
            <SubmitInvoice id={ci.id} totalIncCents={total} blocked={blocked} />
          </>
        )}

        {ci.status === "submitted" && (
          <p className="hint" style={{ marginTop: 10 }}>
            Submitted {ci.submitted_at ? dateFmt(ci.submitted_at) : ""} — the office reviews and approves it, then pays by bank transfer.
          </p>
        )}
        {ci.status === "approved" && (
          <p className="hint" style={{ marginTop: 10 }}>
            Approved{ci.approved_at ? ` ${dateFmt(ci.approved_at)}` : ""} — payment is on its way to your account on file.
          </p>
        )}
        {ci.status === "paid" && (
          <div style={{ marginTop: 10 }} data-testid="ci-paid">
            <p className="hint">
              Paid{ci.paid_at ? ` ${dateFmt(ci.paid_at)}` : ""}
              {ci.bank_reference ? ` · bank reference ${ci.bank_reference}` : ""}
              {ci.remittance_number ? ` · remittance ${ci.remittance_number}` : ""}.
            </p>
            {remittanceUrl && (
              <a className="btn gh" href={remittanceUrl} target="_blank" rel="noreferrer" data-testid="remittance-link">
                Download remittance advice
              </a>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
