import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { melbourneDate } from "@/lib/workorder/console";
import {
  ageInfo,
  invoiceBalanceCents,
  invoicePaidCents,
  paymentStages,
} from "@/lib/invoicing/derive";
import { contractorInvoiceTone } from "@/lib/invoicing/contractorInvoiceTone";
import { loadJobCosts, loadJobMoney, toDerive, toDerivePayments } from "../../data";
import { contractorVariationsCents } from "@/lib/workorder/contractorPay";
import { SOURCE_LABEL, type IntakeSource } from "@/lib/costs/intake";
import { COST_DOCS_BUCKET } from "@/lib/costs/store";
import { fmt2, kindLabelWithContext, shortDay, STATUS_LABEL } from "../../format";
import { parseBackTo } from "@/lib/navigation/backTo";
import { jobMoneyPage } from "@/lib/invoicing/jobMoney";
import { paymentsSettings } from "@/lib/invoicing/settings";
import { melbourneToday } from "@/lib/invoicing/derive";
import { reportError } from "@/lib/monitoring/report";
import { loadJobMoneyInput } from "../../jobMoneyData";
import { JobPanel } from "../../payments/JobPanel";
import { loadJobPanel } from "../../payments/panelData";
import { PaymentsUiProvider } from "../../payments/ActionsClient";
import { pickerJobs } from "../../payments/labels";
import "../../payments/payments.css";
import MoneyView, {
  type InvoiceCardProp, type FeedProp, type JobCostItemProp, type MaterialItemProp,
} from "./MoneyView";

export const dynamic = "force-dynamic";
/** One-press "✓ Paid" sends its receipt after the Undo window (⚑P2), behind the response. */
export const maxDuration = 60;

type Search = { from?: string; tab?: string; addcost?: string; jt?: string };

/**
 * One job's money (payments-merge brief §4.7, Step 7): the job panel from
 * /invoicing/payments, full page — the same component, the same figures as
 * the job's row. Reached from PC Command's money strip, the dashboard, and
 * any link outside the Payments page.
 */
export default async function JobMoneyPage({ params, searchParams }: { params: Promise<{ estimateId: string }>; searchParams: Promise<Search> }) {
  const { estimateId } = await params;
  const sp = await searchParams;
  // Tom, 1 Oct: opened from Invoicing, the crumb goes back to Invoicing (with its
  // filters), not to PC Command. Validated — `from` comes off the URL.
  const backTo = parseBackTo(sp.from);
  const supabase = await createClient();
  const now = new Date();
  const [{ input }, settingsRes] = await Promise.all([
    loadJobMoneyInput(supabase, now),
    supabase.from("settings").select("key, value").eq("key", "invoicing"),
  ]);
  if (settingsRes.error) reportError(settingsRes.error, { where: "JobMoneyPage.settings", bestEffort: true });
  const settings = paymentsSettings((settingsRes.data ?? []) as { key: string; value: unknown }[]);
  const page = input ? jobMoneyPage({ ...input, paymentTermsDays: settings.paymentTermsDays }) : null;
  const panel = page ? await loadJobPanel(supabase, page, estimateId, now) : null;
  // A job outside the payments model (no accepted estimate on the board) keeps
  // the old view until the switch-over (Step 8).
  if (!page || !panel) return legacyJobMoney(estimateId, sp, backTo, supabase, now);

  const addCost = sp.addcost === "1";
  // ?tab=costs is what links written before the panel say (PC Command, emails).
  const tab = addCost || sp.jt === "out" || sp.tab === "costs" ? "out" : "in";
  const self = (t: "in" | "out") => {
    const q = new URLSearchParams();
    if (sp.from && backTo) q.set("from", sp.from);
    if (t === "out") q.set("jt", "out");
    const s = q.toString();
    return `/invoicing/job/${estimateId}${s ? `?${s}` : ""}`;
  };
  return (
    <div className="pm">
      <PaymentsUiProvider settings={{ depositOptionsPct: settings.depositOptionsPct, notifyPaymentDefault: settings.notifyPaymentDefault, today: melbourneToday(now) }}
        jobs={pickerJobs(page.rows)}>
        <main className="pm-jobpage" data-testid="pm-panel">
          <JobPanel d={panel} tab={tab} tabHref={self} closeHref={backTo?.href ?? "/invoicing/payments"}
            closeLabel={backTo ? backTo.label.replace(/^Back to /, "").replace(/^./, (c) => c.toUpperCase()) : "Payments"}
            today={melbourneToday(now)} termsDays={settings.paymentTermsDays} startAddCost={addCost} />
        </main>
      </PaymentsUiProvider>
    </div>
  );
}

/** The pre-Step-7 job view; deleted with the old Invoicing tabs at Step 8. */
async function legacyJobMoney(estimateId: string, { tab, addcost }: Search, backTo: ReturnType<typeof parseBackTo>, supabase: Awaited<ReturnType<typeof createClient>>, now: Date) {
  const today = melbourneDate(now);
  const job = await loadJobMoney(supabase, estimateId);
  if (!job.estimate || !job.ledger) notFound();

  const derive = toDerive(job.invoices);
  const pays = toDerivePayments(job.payments);
  const stages = paymentStages(derive, pays, Number(job.ledger.balance_cents), now);

  const cards: InvoiceCardProp[] = job.invoices
    .slice()
    .reverse()
    .map((r) => {
      const d = derive.find((x) => x.id === r.id)!;
      const age = ageInfo(d, pays, now);
      const paid = invoicePaidCents(d, pays);
      const overdue = age !== null && "overdueDays" in age;
      const pay = job.payments.find((p) => p.invoice_id === r.id && p.status === "succeeded");
      return {
        invoiceId: r.id,
        token: r.token,
        num: `${r.number ?? "Draft"} · ${kindLabelWithContext(r.kind, r.total_inc_cents, Number(job.ledger?.adjusted_contract_cents ?? 0))}${r.status === "draft" ? " (unnumbered)" : ""}`,
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
        chaseHold: r.chase_hold_reason ?? null,
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
      case "reminders_paused": return { tone: "amber", title: "Reminders paused", meta: `${m.reason ?? ""} · ${at}` };
      case "reminders_resumed": return { tone: "cyan", title: "Reminders resumed", meta: at };
      case "nudge_sent": return { tone: "cyan", title: "Payment message sent", meta: at };
      default: return { tone: "", title: e.type.replaceAll("_", " "), meta: at };
    }
  });

  // Costs tab — contractor group + the 6a cost rows. Credits subtract
  // (manual deduction wins on started work) — one rule, in the lib.
  const offerCents = Number(job.wo?.contractor_payment ?? 0) || 0;
  const acceptedDeltaCents = contractorVariationsCents(job.variations);

  const woId = job.wo?.id ?? null;
  const jobCostData = woId ? await loadJobCosts(supabase, woId) : { jobCosts: [], materials: [], expenses: [], loadError: null };
  const costDocPaths = jobCostData.jobCosts
    .map((c) => c.doc_path)
    .filter((p): p is string => Boolean(p));
  const docUrlByPath = new Map<string, string>();
  if (costDocPaths.length) {
    const { data: signed } = await supabase.storage
      .from(COST_DOCS_BUCKET)
      .createSignedUrls([...new Set(costDocPaths)], 600);
    for (const s of signed ?? []) if (s.signedUrl && s.path) docUrlByPath.set(s.path, s.signedUrl);
  }
  const sourceChip = (source: string | null | undefined, intakeId: string | null) =>
    intakeId || source ? SOURCE_LABEL[(source ?? "manual") as IntakeSource] ?? "manual" : "manual";
  const costRows: JobCostItemProp[] = jobCostData.jobCosts.map((c) => ({
    id: c.id,
    vendor: c.vendors?.name || c.description || "Cost",
    ref: [c.category.replaceAll("_", " "), c.invoice_no || null, c.invoice_date ? shortDay(c.invoice_date) : null]
      .filter(Boolean).join(" · "),
    amtCents: c.amount_ex_cents + c.gst_cents,
    status: c.status as JobCostItemProp["status"],
    sourceChip: c.intake_id ? "bills@/queue" : "manual",
    docUrl: c.doc_path ? docUrlByPath.get(c.doc_path) ?? null : null,
    linked: Boolean(c.estimate_line_ref),
  }));
  const materialRows: MaterialItemProp[] = jobCostData.materials.map((m) => ({
    id: m.id,
    label: [m.supplier || "Materials", fmt2(m.amount_cents), m.invoice_date ? shortDay(m.invoice_date) : null]
      .filter(Boolean).join(" · "),
    sourceChip: sourceChip(m.source, m.intake_id),
    docUrl: null,
  }));

  return (
    <MoneyView
      estimateId={estimateId}
      initialTab={addcost === "1" ? "costs" : tab === "invoices" || tab === "costs" ? tab : "payments"}
      initialAddCost={addcost === "1"}
      backTo={backTo}
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
      loadError={job.loadError}
      costsError={jobCostData.loadError}
      costs={{
        offerCents, acceptedDeltaCents,
        // The same tone as the Payables row (lib/invoicing/contractorInvoiceTone) — one colour per state.
        ci: job.contractorInvoice
          ? (() => { const t = contractorInvoiceTone({ status: job.contractorInvoice.status, dueOn: job.contractorInvoice.due_on }, today); return { number: job.contractorInvoice.number, status: job.contractorInvoice.status, toneClass: t.className, overdueLabel: t.overdueLabel }; })()
          : null,
        rows: costRows, materials: materialRows,
        expenses: jobCostData.expenses.map((e) => ({
          id: e.id,
          label: [e.category.replaceAll("_", " "), e.note || null].filter(Boolean).join(" — "),
          amtCents: e.amount_cents,
          status: e.status,
        })),
      }}
    />
  );
}
