import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { melbourneDate } from "@/lib/workorder/console";
import {
  ageInfo,
  invoiceBalanceCents,
  invoicePaidCents,
  paymentStages,
} from "@/lib/invoicing/derive";
import { loadJobMoney, toDerive, toDerivePayments } from "../../data";
import { fmt2, KIND_LABEL, shortDay, STATUS_LABEL } from "../../format";
import MoneyView, { type InvoiceCardProp, type FeedProp } from "./MoneyView";

export const dynamic = "force-dynamic";

/**
 * §7.1 — one job's money view: the ledger, three tabs, two primary actions.
 * Reachable from the PC work-order view's money strip and from the dashboard.
 */
export default async function JobMoneyPage({
  params,
}: {
  params: Promise<{ estimateId: string }>;
}) {
  const { estimateId } = await params;
  const supabase = await createClient();
  const today = melbourneDate(new Date());
  const job = await loadJobMoney(supabase, estimateId);
  if (!job.estimate || !job.ledger) notFound();

  const derive = toDerive(job.invoices);
  const pays = toDerivePayments(job.payments);
  const stages = paymentStages(derive, pays, Number(job.ledger.balance_cents), today);

  const cards: InvoiceCardProp[] = job.invoices
    .slice()
    .reverse()
    .map((r) => {
      const d = derive.find((x) => x.id === r.id)!;
      const age = ageInfo(d, pays, today);
      const paid = invoicePaidCents(d, pays);
      const overdue = age !== null && "overdueDays" in age;
      const pay = job.payments.find((p) => p.invoice_id === r.id && p.status === "succeeded");
      return {
        invoiceId: r.id,
        num: `${r.number ?? "Draft"} · ${KIND_LABEL[r.kind]}${r.status === "draft" ? " (unnumbered)" : ""}`,
        statusLabel: overdue
          ? `Overdue · was due ${shortDay(r.due_on)}`
          : r.status === "draft" ? "Draft"
          : r.due_on && ["issued", "sent", "viewed", "partially_paid"].includes(r.status)
            ? `${STATUS_LABEL[r.status]} · due ${shortDay(r.due_on)}`
            : STATUS_LABEL[r.status],
        chip: overdue ? "overdue" : r.status === "draft" ? "draft"
          : r.status === "paid" ? "paid"
          : ["sent", "viewed"].includes(r.status) ? "sent" : "awaiting",
        totalCents: r.total_inc_cents,
        paidCents: paid,
        balanceCents: invoiceBalanceCents(d, pays),
        issued: shortDay(r.issued_on),
        method: pay?.method ?? null,
        receipt: pay?.receipt_number ?? null,
        isDraft: r.status === "draft",
        isOpen: ["issued", "sent", "viewed", "partially_paid"].includes(r.status),
        kind: r.kind,
      };
    });

  const feed: FeedProp[] = job.events.map((e) => {
    const m = e.meta as { method?: string; amount_cents?: number; auto?: string; deposit_pct?: number; total_inc_cents?: number; reason?: string; number?: string; receipt?: string };
    const at = shortDay(e.created_at);
    switch (e.type) {
      case "payment_received":
        return { tone: "emerald", title: `Payment received — ${m.method === "bank_transfer" ? "bank transfer" : m.method ?? "payment"}`,
                 meta: `${fmt2(m.amount_cents ?? 0)} · receipt ${m.receipt ?? "—"} · ${at}` };
      case "drafted":
        return m.auto === "acceptance"
          ? { tone: "amber", title: `Deposit auto-drafted on acceptance — ${m.deposit_pct}%`, meta: `${fmt2(m.total_inc_cents ?? 0)} · ${at}` }
          : m.auto === "final"
            ? { tone: "amber", title: "Final invoice auto-drafted at sign-off", meta: `${fmt2(m.total_inc_cents ?? 0)} · ${at}` }
            : { tone: "amber", title: "Payment request drafted", meta: `${fmt2(m.total_inc_cents ?? 0)} · ${at}` };
      case "issued": return { tone: "cyan", title: `Invoice issued${m.number ? ` — ${m.number}` : ""}`, meta: at };
      case "sent": return { tone: "cyan", title: "Invoice sent", meta: at };
      case "viewed": return { tone: "cyan", title: "Invoice viewed by customer", meta: at };
      case "voided": return { tone: "clay", title: `Invoice voided${m.number ? ` — ${m.number}` : ""}`, meta: `${m.reason ?? ""} · ${at}` };
      case "amended": return { tone: "amber", title: "Draft amended", meta: at };
      default: return { tone: "", title: e.type.replaceAll("_", " "), meta: at };
    }
  });

  // Costs tab — contractor group only until Steps 5–6 fill the rest.
  const offerCents = Number(job.wo?.contractor_payment ?? 0) || 0;
  const acceptedDeltaCents = job.variations
    .filter((v) => v.status === "contractor_accepted")
    .reduce((a, v) => a + (v.contractor_delta_cents ?? 0), 0);

  return (
    <MoneyView
      estimateId={estimateId}
      woId={job.wo?.id ?? null}
      woRef={job.wo?.wo_ref ?? null}
      address={job.estimate.job_address || job.estimate.title || "Untitled job"}
      jobTitle={job.estimate.job_title || ""}
      stages={stages}
      strip={{
        contractCents: Number(job.ledger.accepted_total_cents),
        variationsCents: Number(job.ledger.variations_cents),
        invoicedCents: Number(job.ledger.invoiced_cents),
        paidCents: Number(job.ledger.paid_cents),
        balanceCents: Number(job.ledger.balance_cents),
        adjustedCents: Number(job.ledger.adjusted_contract_cents),
      }}
      cards={cards}
      feed={feed}
      costs={{ offerCents, acceptedDeltaCents }}
    />
  );
}
