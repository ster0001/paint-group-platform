/**
 * Trade portal v2 · Session 3 — the property-spine portfolio view-model
 * (brief §5.1). Pure over customer-safe rows; supersedes the 3a-7
 * estimate-title portfolio for trade Homes. One source rule: every number a
 * component shows is derived HERE, never in the component.
 *
 * The four pulse tiles, the Needs-you queue (the 3a-7 AttentionItem shape,
 * one primary action per card), and one card per PROPERTY with: derived
 * status chip, reference line (labels straight from property_references —
 * org_kind only shaped their defaults at entry), the swatch strip from the
 * property's colour_records in walls → ceilings → trims → doors order, a
 * progress bar from the active job's surface-tick ratio, and a search
 * haystack of address / reference values / job numbers.
 */
import { moneyFmt, type MoneyInvoice, type MoneyPayment } from "./money";
import { invoiceIsOverdue, invoiceBalanceCents, type DeriveInvoice, type DerivePayment } from "@/lib/invoicing/derive";
import { dayOfJob } from "./home";
import type { PortfolioVariation, AttentionItem } from "./portfolio";

export type TPProperty = { id: string; address: string | null; suburb: string | null };
export type TPReference = { property_id: string; label: string; value: string; sort: number };
export type TPColourSwatch = {
  property_id: string;
  surface_type: string;
  swatch_hex: string | null;
  status: string; // planned | applied | superseded
};
export type TPEstimate = {
  id: string;
  title: string | null;
  status: string;
  total_cents: number | null;
  share_token: string | null;
  property_id: string | null;
  sent_at: string | null;
  created_at: string;
};
export type TPWorkOrder = {
  id: string;
  estimate_id: string;
  wo_ref: string | null;
  stage: string;
  start_date: string | null;
  end_date: string | null;
};
export type TPSurfaceCount = { work_order_id: string; done: number; total: number };

export type PulseTiles = { onSite: number; needApproval: number; readyToSignOff: number; overdue: number };
export type PulseKey = "onsite" | "approval" | "signoff" | "overdue";

export type TradePropertyCard = {
  id: string;
  address: string;
  chip: { cls: "cyan" | "amber" | "emerald" | "clay" | "mut"; label: string };
  /** "Owner · T. & M. Nguyen · Job PG-3181" — labels from property_references. */
  refLine: string | null;
  /** Swatch hexes in surface order; "" renders the neutral placeholder. */
  swatches: string[];
  summary: string;
  progressPct: number | null;
  /** Which pulse tiles this card answers to (tile taps filter the list). */
  pulseKeys: PulseKey[];
  /** Lowercased search haystack: address, reference values, job numbers. */
  haystack: string;
};

export type TradePortfolio = {
  pulse: PulseTiles;
  onSiteThisWeek: number;
  attention: AttentionItem[];
  cards: TradePropertyCard[];
};

const ON_SITE = new Set(["in_progress", "qa", "completion_prep"]);
/** walls first, then ceilings, trims, doors — the mockup's scan order. */
const SWATCH_ORDER = ["wall", "ceiling", "trim", "door", "window", "fascia", "eaves", "gutter", "deck", "fence", "floor"];

function toDerive(inv: MoneyInvoice): DeriveInvoice {
  return {
    id: inv.id, estimateId: inv.estimate_id, kind: inv.kind,
    status: inv.status as DeriveInvoice["status"],
    totalIncCents: inv.total_inc_cents, dueOn: inv.due_on, issuedOn: inv.issued_on,
  };
}

export function swatchStrip(colours: TPColourSwatch[]): string[] {
  const current = colours.filter((c) => c.status === "applied" || c.status === "planned");
  const rank = (t: string) => {
    const i = SWATCH_ORDER.indexOf(t);
    return i === -1 ? SWATCH_ORDER.length : i;
  };
  const out: string[] = [];
  for (const c of [...current].sort((a, b) => rank(a.surface_type) - rank(b.surface_type))) {
    const hex = c.swatch_hex ?? "";
    if (out[out.length - 1] === hex) continue; // consecutive repeats collapse
    out.push(hex);
    if (out.length === 6) break;
  }
  return out;
}

export function buildTradePortfolio(input: {
  properties: TPProperty[];
  references: TPReference[];
  colours: TPColourSwatch[];
  estimates: TPEstimate[];
  workOrders: TPWorkOrder[];
  surfaceCounts: TPSurfaceCount[];
  invoices: MoneyInvoice[];
  payments: MoneyPayment[];
  variations: PortfolioVariation[];
  /** Undecided external approvals, by estimate (session 5). */
  pendingApprovals?: Array<{ estimate_id: string; approver_name: string }>;
  todayYmd: string;
}): TradePortfolio {
  const { todayYmd } = input;
  const estById = new Map(input.estimates.map((e) => [e.id, e]));
  const dPayments: DerivePayment[] = input.payments.map((p) => ({
    invoiceId: p.invoice_id, amountCents: p.amount_cents, status: p.status, paidOn: p.paid_on,
  }));
  const ticksByWo = new Map(input.surfaceCounts.map((s) => [s.work_order_id, s]));

  const propertyOfEstimate = (estimateId: string): string | null =>
    estById.get(estimateId)?.property_id ?? null;
  const addressOf = new Map(input.properties.map((p) => [
    p.id,
    [p.address, p.suburb].filter(Boolean).join(", ") || "Your property",
  ]));
  const addrForEstimate = (estimateId: string): string => {
    const pid = propertyOfEstimate(estimateId);
    return (pid && addressOf.get(pid)) || estById.get(estimateId)?.title?.trim() || "Your property";
  };

  // ---- Needs you (the 3a-7 shape; property addresses lead) ----------------
  const attention: AttentionItem[] = [];
  const pendingByEstimate = new Map((input.pendingApprovals ?? []).map((p) => [p.estimate_id, p.approver_name]));
  for (const e of input.estimates) {
    if (e.status !== "sent" || !e.share_token) continue;
    const sentTo = pendingByEstimate.get(e.id);
    attention.push({
      key: `estimate:${e.id}`,
      address: addrForEstimate(e.id),
      meta: sentTo
        ? `Sent to ${sentTo} to approve — awaiting their decision`
        : `Estimate ready for your approval${e.total_cents ? ` · ${moneyFmt(e.total_cents)} inc GST` : ""}`,
      amountCents: null,
      cta: { label: sentTo ? "See status" : "Review estimate", href: `/account/approvals/${e.id}` },
    });
  }
  for (const v of input.variations) {
    if (v.status !== "priced" || !v.customer_token || v.customer_responded_at) continue;
    attention.push({
      key: `variation:${v.id}`,
      address: addrForEstimate(v.estimate_id),
      meta: "Variation raised — priced, with photos attached",
      amountCents: v.price_cents,
      cta: { label: "Review variation", href: `/v/${v.customer_token}` },
    });
  }
  for (const w of input.workOrders) {
    if (w.stage !== "walkthrough") continue;
    const pid = propertyOfEstimate(w.estimate_id);
    attention.push({
      key: `walkthrough:${w.id}`,
      address: addrForEstimate(w.estimate_id),
      meta: "Painting finished — time for the walkthrough & sign-off",
      amountCents: null,
      cta: { label: "See the job", href: pid ? `/account/properties/${pid}` : "/account/project" },
    });
  }
  for (const inv of input.invoices) {
    const d = toDerive(inv);
    if (!invoiceIsOverdue(d, dPayments, todayYmd)) continue;
    attention.push({
      key: `invoice:${inv.id}`,
      address: addrForEstimate(inv.estimate_id),
      meta: `Invoice ${inv.number ?? ""} is overdue`.replace("  ", " "),
      amountCents: invoiceBalanceCents(d, dPayments),
      cta: { label: "View invoice", href: inv.token ? `/i/${inv.token}` : "/account/money" },
    });
  }

  // ---- property cards ------------------------------------------------------
  const cards: TradePropertyCard[] = input.properties.map((p) => {
    const address = addressOf.get(p.id)!;
    const propEstimates = input.estimates.filter((e) => e.property_id === p.id);
    const estIds = new Set(propEstimates.map((e) => e.id));
    const wos = input.workOrders.filter((w) => estIds.has(w.estimate_id));
    const refs = input.references
      .filter((r) => r.property_id === p.id)
      .sort((a, b) => a.sort - b.sort);

    const active = wos.find((w) => ON_SITE.has(w.stage));
    const atWalkthrough = wos.find((w) => w.stage === "walkthrough");
    const preStart = wos.find((w) => w.stage === "pre_start" || w.stage === "offered");
    const sentEstimate = propEstimates.find((e) => e.status === "sent" && e.share_token);
    const awaitingVariation = input.variations.some((v) =>
      estIds.has(v.estimate_id) && v.status === "priced" && v.customer_token && !v.customer_responded_at);
    const overdueInvoices = input.invoices.filter((i) =>
      estIds.has(i.estimate_id) && invoiceIsOverdue(toDerive(i), dPayments, todayYmd));
    const closed = wos.filter((w) => w.stage === "closed");

    const currentWo = active ?? atWalkthrough ?? preStart ?? null;
    const jobRef = (currentWo ?? closed[0])?.wo_ref ?? null;

    const ticks = active ? ticksByWo.get(active.id) : undefined;
    let progressPct: number | null = null;
    if (atWalkthrough) progressPct = 96;
    else if (ticks && ticks.total > 0) progressPct = Math.round((ticks.done / ticks.total) * 100);
    else if (closed.length && !currentWo && !sentEstimate) progressPct = 100;
    else if (sentEstimate) progressPct = 8;

    const pulseKeys: PulseKey[] = [];
    if (active) pulseKeys.push("onsite");
    if (sentEstimate || awaitingVariation) pulseKeys.push("approval");
    if (atWalkthrough) pulseKeys.push("signoff");
    if (overdueInvoices.length) pulseKeys.push("overdue");

    // Chip precedence mirrors the mockup: awaiting-you → on site → sign-off
    // → overdue → booked → complete → no active work.
    let chip: TradePropertyCard["chip"];
    let summary: string;
    const day = active ? dayOfJob(active.start_date, active.end_date, todayYmd) : null;
    if (sentEstimate || awaitingVariation) {
      chip = { cls: "amber", label: "Awaiting you" };
      summary = sentEstimate
        ? `${sentEstimate.title?.trim() || "Estimate"} · sent ${(sentEstimate.sent_at ?? sentEstimate.created_at).slice(0, 10)}`
        : "A variation is waiting for your decision";
    } else if (active) {
      chip = { cls: "cyan", label: day ? `On site · ${day.toLowerCase()}` : "On site" };
      summary = ticks && ticks.total > 0
        ? `Work under way · ${ticks.done} of ${ticks.total} surfaces done`
        : "Work under way";
    } else if (atWalkthrough) {
      chip = { cls: "emerald", label: "Ready to sign off" };
      summary = "All surfaces done — walkthrough & sign-off next";
    } else if (overdueInvoices.length) {
      chip = { cls: "clay", label: "Invoice overdue" };
      summary = `${overdueInvoices.length === 1 ? "An invoice is" : `${overdueInvoices.length} invoices are`} past due`;
    } else if (preStart) {
      chip = { cls: "mut", label: preStart.start_date ? `Starts ${preStart.start_date}` : "Booked" };
      summary = "Getting everything ready";
    } else if (closed.length) {
      chip = { cls: "emerald", label: "Complete" };
      summary = `${closed.length} job${closed.length === 1 ? "" : "s"} on record · colour card on file`;
    } else {
      chip = { cls: "mut", label: "No active work" };
      summary = "Tap to request a touch-up or new estimate";
    }

    const refLine = refs.length
      ? refs.slice(0, 2).map((r) => `${r.label} · ${r.value}`).join("  ·  ") + (jobRef ? `  ·  Job ${jobRef}` : "")
      : jobRef ? `Job ${jobRef}` : null;

    const haystack = [
      address,
      ...refs.map((r) => `${r.label} ${r.value}`),
      ...wos.map((w) => w.wo_ref ?? ""),
      ...propEstimates.map((e) => e.title ?? ""),
    ].join(" ").toLowerCase();

    return {
      id: p.id,
      address,
      chip,
      refLine,
      swatches: swatchStrip(input.colours.filter((c) => c.property_id === p.id)),
      summary,
      progressPct,
      pulseKeys,
      haystack,
    };
  });

  // Sort: needs-you first, then on-site, then most recent estimate activity.
  const latestByProperty = new Map<string, string>();
  for (const e of input.estimates) {
    if (!e.property_id) continue;
    const cur = latestByProperty.get(e.property_id);
    if (!cur || e.created_at > cur) latestByProperty.set(e.property_id, e.created_at);
  }
  const rank = (c: TradePropertyCard) =>
    c.pulseKeys.includes("approval") || c.pulseKeys.includes("overdue") ? 0
      : c.pulseKeys.includes("onsite") || c.pulseKeys.includes("signoff") ? 1 : 2;
  cards.sort((a, b) => rank(a) - rank(b)
    || (latestByProperty.get(b.id) ?? "").localeCompare(latestByProperty.get(a.id) ?? ""));

  const onSiteProperties = new Set(cards.filter((c) => c.pulseKeys.includes("onsite")).map((c) => c.id));

  return {
    pulse: {
      onSite: onSiteProperties.size,
      needApproval: cards.filter((c) => c.pulseKeys.includes("approval")).length,
      readyToSignOff: cards.filter((c) => c.pulseKeys.includes("signoff")).length,
      overdue: cards.filter((c) => c.pulseKeys.includes("overdue")).length,
    },
    onSiteThisWeek: onSiteProperties.size,
    attention,
    cards,
  };
}

/** Reference label defaults per org kind (brief §4.2) — used where staff or
 * seeds create references; the cards only ever print stored labels. */
export function defaultReferenceLabels(orgKind: string | null): string[] {
  switch (orgKind) {
    case "facilities": return ["Site", "PO"];
    case "insurance": return ["Claim", "Assessor"];
    case "builder": return ["Site", "Your ref"];
    case "body_corporate": return ["Plan", "Your ref"];
    case "real_estate": return ["Owner", "Your ref"];
    default: return ["Your ref"];
  }
}
