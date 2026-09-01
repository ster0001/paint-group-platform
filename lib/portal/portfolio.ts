import type { PortalEstimate, PortalWorkOrder } from "./home";
import { dayOfJob } from "./home";
import type { MoneyInvoice, MoneyPayment } from "./money";
import { moneyFmt } from "./money";
import { invoiceIsOverdue, invoiceBalanceCents, type DeriveInvoice, type DerivePayment } from "@/lib/invoicing/derive";

/**
 * 3a-7 · The commercial workspace's view-model (§6, W1): every property,
 * every job, one screen — the PC console's pipeline re-cut for a client's
 * OWN jobs. Pure over the same customer-safe rows the residential portal
 * reads; a trade account is residential plus aggregation, never new schema.
 */

export type PortfolioVariation = {
  id: string;
  estimate_id: string;
  status: string;
  price_cents: number | null;
  customer_token: string | null;
  customer_responded_at: string | null;
};

export type PortfolioTiles = {
  underway: number;
  waitingOnYou: number;
  drafts: number;
  invoicedThisMonthCents: number;
};

export type AttentionItem = {
  key: string;
  address: string;
  meta: string;
  amountCents: number | null;
  cta: { label: string; href: string };
};

export type UnderwayJob = {
  estimateId: string;
  address: string;
  chip: { cls: "cyan" | "amber" | "mut" | "emerald"; label: string };
  meta: string;
  progressPct: number | null;
};

const ACTIVE = new Set(["in_progress", "qa", "completion_prep"]);
const VISIBLE_INVOICE = new Set(["issued", "sent", "viewed", "partially_paid", "paid"]);

function addr(e: PortalEstimate | undefined): string {
  return e?.title?.trim() || "Your property";
}

function toDerive(inv: MoneyInvoice): DeriveInvoice {
  return {
    id: inv.id, estimateId: inv.estimate_id, kind: inv.kind,
    status: inv.status as DeriveInvoice["status"],
    totalIncCents: inv.total_inc_cents, dueOn: inv.due_on, issuedOn: inv.issued_on,
  };
}

export function buildPortfolio(input: {
  estimates: PortalEstimate[];
  workOrders: PortalWorkOrder[];
  invoices: MoneyInvoice[];
  payments: MoneyPayment[];
  variations: PortfolioVariation[];
  todayYmd: string;
}): { tiles: PortfolioTiles; attention: AttentionItem[]; underway: UnderwayJob[] } {
  const { estimates, workOrders, invoices, payments, variations, todayYmd } = input;
  const estById = new Map(estimates.map((e) => [e.id, e]));
  const dPayments: DerivePayment[] = payments.map((p) => ({
    invoiceId: p.invoice_id, amountCents: p.amount_cents, status: p.status, paidOn: p.paid_on,
  }));

  const attention: AttentionItem[] = [];

  // 1 · Variations waiting on the client — the mockup's lead card.
  for (const v of variations) {
    if (v.status !== "priced" || !v.customer_token || v.customer_responded_at) continue;
    const e = estById.get(v.estimate_id);
    if (!e) continue;
    attention.push({
      key: `variation:${v.id}`,
      address: addr(e),
      meta: "Something extra to approve — priced, with photos attached",
      amountCents: v.price_cents,
      cta: { label: "Review & approve", href: `/v/${v.customer_token}` },
    });
  }

  // 2 · Jobs at walkthrough — the office books it, so the action is a call
  //     (⚑11: bookedBy office), never an invented self-serve booking.
  for (const w of workOrders) {
    if (w.stage !== "walkthrough") continue;
    const e = estById.get(w.estimate_id);
    if (!e) continue;
    attention.push({
      key: `walkthrough:${w.estimate_id}`,
      address: addr(e),
      meta: "Painting finished — time to book your walkthrough & sign-off",
      amountCents: null,
      cta: { label: "See the job", href: "/account/project" },
    });
  }

  // 3 · Estimates awaiting a decision.
  for (const e of estimates) {
    if (e.status !== "sent" || !e.share_token) continue;
    attention.push({
      key: `estimate:${e.id}`,
      address: addr(e),
      meta: `Estimate ready — awaiting your acceptance${e.total_cents ? ` · ${moneyFmt(e.total_cents)} inc GST` : ""}`,
      amountCents: null,
      cta: { label: "Open the estimate", href: `/e/${e.share_token}` },
    });
  }

  // 4 · Overdue invoices — same derivation as everywhere else.
  for (const inv of invoices) {
    if (!VISIBLE_INVOICE.has(inv.status) || inv.status === "paid") continue;
    const d = toDerive(inv);
    if (!invoiceIsOverdue(d, dPayments, todayYmd)) continue;
    const e = estById.get(inv.estimate_id);
    attention.push({
      key: `invoice:${inv.id}`,
      address: addr(e),
      meta: `Invoice ${inv.number ?? ""} is overdue`,
      amountCents: invoiceBalanceCents(d, dPayments),
      cta: { label: "View & pay", href: inv.token ? `/i/${inv.token}?portal=1` : "/account/money" },
    });
  }

  const underway: UnderwayJob[] = workOrders
    .filter((w) => ACTIVE.has(w.stage) || w.stage === "walkthrough" || w.stage === "pre_start")
    .map((w): UnderwayJob | null => {
      const e = estById.get(w.estimate_id);
      if (!e) return null;
      const day = dayOfJob(w.start_date, w.end_date, todayYmd);
      if (w.stage === "walkthrough") {
        return { estimateId: e.id, address: addr(e), chip: { cls: "amber" as const, label: "Sign-off" }, meta: "Awaiting your walkthrough", progressPct: 96 };
      }
      if (w.stage === "pre_start") {
        return {
          estimateId: e.id, address: addr(e), chip: { cls: "mut" as const, label: w.start_date ? `Starts ${w.start_date}` : "Booked" },
          meta: "Getting everything ready", progressPct: null,
        };
      }
      let pct: number | null = null;
      if (day) {
        const [d, of] = day.match(/\d+/g)!.map(Number);
        pct = Math.min(95, Math.round((d / of) * 100));
      }
      return { estimateId: e.id, address: addr(e), chip: { cls: "cyan" as const, label: day ?? "Underway" }, meta: "Work in progress", progressPct: pct };
    })
    .filter((x): x is UnderwayJob => x !== null);

  const month = todayYmd.slice(0, 7);
  const invoicedThisMonthCents = invoices
    .filter((i) => VISIBLE_INVOICE.has(i.status) && (i.issued_on ?? "").startsWith(month))
    .reduce((a, i) => a + i.total_inc_cents, 0);

  return {
    tiles: {
      underway: workOrders.filter((w) => ACTIVE.has(w.stage)).length,
      waitingOnYou: attention.length,
      drafts: estimates.filter((e) => e.status === "draft").length,
      invoicedThisMonthCents,
    },
    attention,
    underway,
  };
}
