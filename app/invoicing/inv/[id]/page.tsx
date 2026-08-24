import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { loadInvoiceDoc } from "../../data";
import { shortDay } from "../../format";
import InvoiceDoc, { type DocLine, type DocPayment } from "./InvoiceDoc";

export const dynamic = "force-dynamic";

/**
 * §7.3 — the invoice document: the editor IS the customer-facing document.
 * Draft = editable through server round-trips; issued = locked (the DB
 * enforces it, this page just reflects it). The customer token view (Step 3)
 * renders this same document read-only.
 */
export default async function InvoiceDocPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const supabase = await createClient();
  const doc = await loadInvoiceDoc(supabase, id);
  if (!doc || !doc.job.ledger) notFound();
  const { invoice, job } = doc;

  const variationById = new Map(job.variations.map((v) => [v.id, v]));
  const lines: DocLine[] = doc.lines.map((l) => {
    const v = l.source === "variation" && l.source_ref ? variationById.get(l.source_ref) : undefined;
    return {
      id: l.id,
      source: l.source,
      title: l.description.split(" — ")[0] || l.description,
      detail: l.description.includes(" — ") ? l.description.slice(l.description.indexOf(" — ") + 3) : "",
      description: l.description,
      amountExCents: l.amount_ex_cents,
      approvedOn: v?.customer_responded_at ? shortDay(v.customer_responded_at) : null,
    };
  });

  const payments: DocPayment[] = job.payments
    .filter((p) => p.status === "succeeded")
    .map((p) => {
      const inv = job.invoices.find((i) => i.id === p.invoice_id);
      return {
        label: `${inv ? `${inv.kind[0].toUpperCase()}${inv.kind.slice(1)}` : "Payment"} — ${p.method === "stripe_card" ? "card via Stripe" : p.method === "bank_transfer" ? "bank transfer" : p.method ?? "payment"}`,
        sub: [inv?.number, shortDay(p.paid_on), p.receipt_number ? `receipt ${p.receipt_number}` : null,
              p.surcharge_cents > 0 ? `incl. surcharge` : null, p.reference || null]
          .filter(Boolean).join(" · "),
        amountCents: p.amount_cents,
      };
    });

  // Latest reconciliation decision, so a recorded one-off adjustment rests.
  const decision = job.events.find(
    (e) => e.invoice_id === id && e.type === "amended" &&
      (e.meta as { what?: string }).what === "reconcile_decision",
  );
  const decisionDriftCents = decision
    ? Number((decision.meta as { drift_cents?: number }).drift_cents ?? 0)
    : null;

  const prevNumbers = job.invoices
    .filter((i) => i.id !== id && i.number && !["draft", "void"].includes(i.status))
    .map((i) => `${i.number} ${i.kind}`)
    .join(", ");

  return (
    <InvoiceDoc
      invoiceId={id}
      estimateId={invoice.estimate_id}
      kind={invoice.kind}
      status={invoice.status}
      number={invoice.number}
      token={invoice.token}
      isDraft={invoice.status === "draft"}
      totals={{
        subtotalExCents: invoice.subtotal_ex_cents,
        gstCents: invoice.gst_cents,
        totalIncCents: invoice.total_inc_cents,
        adjustedCents: Number(job.ledger.adjusted_contract_cents),
        previouslyInvoicedCents: Number(job.ledger.invoiced_cents),
        driftCents: doc.driftCents,
        decisionDriftCents,
      }}
      meta={{
        billedTo: invoice.estimates?.accepted_name || job.estimate?.accepted_name || "—",
        address: invoice.estimates?.job_address || "",
        jobTitle: invoice.estimates?.job_title || invoice.estimates?.title || "",
        woRef: job.wo?.wo_ref ?? null,
        issued: invoice.issued_on ? shortDay(invoice.issued_on) : null,
        due: invoice.due_on ? shortDay(invoice.due_on) : null,
      }}
      entity={doc.entity as Record<string, string>}
      bank={doc.bank as Record<string, string>}
      lines={lines}
      payments={payments}
      prevNumbers={prevNumbers}
    />
  );
}
