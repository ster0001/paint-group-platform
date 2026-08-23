import { createClient } from "@/lib/supabase/server";
import { melbourneDate } from "@/lib/workorder/console";
import {
  agedBucketsCents,
  ageInfo,
  dashboardTiles,
  invoiceBalanceCents,
  stageDots,
  type DeriveInvoice,
} from "@/lib/invoicing/derive";
import { loadDashboard, toDerive, toDerivePayments, type EventRow, type InvoiceRow } from "./data";
import { fmt2, KIND_LABEL, shortDay } from "./format";
import Dashboard, { type ActivityProp, type RowProp } from "./Dashboard";

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
  const { invoices, payments, events } = await loadDashboard(supabase);

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
      KIND_LABEL[r.kind],
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

  return (
    <Dashboard
      tiles={tiles}
      buckets={buckets}
      rows={rows}
      activity={activity}
      initialFilter={f ?? "all"}
      initialTab={tab ?? "recv"}
    />
  );
}
