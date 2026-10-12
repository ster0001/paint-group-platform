/**
 * One derived money row per job — the Payments page (brief
 * docs/briefs/claude-code-brief-payments-merge.md §4.1, Step 1).
 *
 * Pure: the caller supplies the rows and the clock; nothing here reads a
 * database or `Date.now()`. Every figure the Payments page, its stage strip,
 * its four blocks and its headline show comes from this module, over the same
 * ledger rules as the rest of lib/invoicing:
 *
 *   · contract  = ledger.ts `adjustedContractCents` (accepted + approved variations)
 *   · paid      = Σ succeeded payments on the job's invoices (derive.ts)
 *   · overdue   = ledger.ts `isOverdue` — midday the day after the due date —
 *                 the same rule the chase sweep and the CRM work queue use
 *                 (Tom, 12 Oct 2026). There is no second urgency source.
 *   · the stage = lib/workorder/stages.ts `laneFor`, the /pc/flow lanes.
 *
 * Nothing is stored: a "slot", a "health" and a "section" are derived on
 * every read, so they can never drift from the invoices they describe.
 */

import { adjustedContractCents, type LedgerVariation } from "./ledger";
import {
  dashboardTiles, daysBetween, invoiceBalanceCents, invoiceIsOverdue, invoicePaidCents, melbourneToday,
  type DeriveContractorInvoice, type DeriveInvoice, type DerivePayment,
} from "./derive";
import { contractorInvoiceTone } from "./contractorInvoiceTone";
import { LANES, laneFor, type Lane, type WoStage } from "@/lib/workorder/stages";

// ---------------------------------------------------------------------------
// Inputs
// ---------------------------------------------------------------------------

/** One job with an accepted estimate. `woStage` null = no work order yet. */
export type JobMoneyJob = {
  estimateId: string;
  address: string;
  customer: string | null;
  woRef: string | null;
  contractor: string | null;
  woStage: WoStage | null;
  /** yyyy-mm-dd, when booked. */
  startDate: string | null;
  acceptedTotalCents: number;
  variations: readonly LedgerVariation[];
};

/** An invoice as the row needs it: the derive shape plus its number and when it was drafted. */
export type JobMoneyInvoice = DeriveInvoice & {
  number: string | null; createdAt: string;
  /** Times the customer opened it (invoice_events `viewed`); 0 when unknown. */
  views?: number;
};

/** Supplier documents and other trades' costs, for the Materials block only. */
export type MaterialsInput = {
  /** cost_intake rows still waiting for a person (status pending), with the extracted total. */
  intakePending: readonly { totalCents: number }[];
  /** job_costs rows (labour excluded by the caller — employee labour is not a payable). */
  jobCosts: readonly { status: string; amountExCents: number; gstCents: number }[];
};

export type JobMoneyInput = {
  jobs: readonly JobMoneyJob[];
  invoices: readonly JobMoneyInvoice[];
  payments: readonly DerivePayment[];
  contractorInvoices: readonly DeriveContractorInvoice[];
  materials: MaterialsInput;
  now: Date;
};

// ---------------------------------------------------------------------------
// Slots, states, sections
// ---------------------------------------------------------------------------

export type SlotKey = "deposit" | "progress" | "final";

/**
 * §4.1 slot states, plus `none` for a slot the job doesn't use (no progress
 * claim, say) — the screens draw nothing for it.
 */
export type SlotState = "over" | "need" | "noinv" | "sent" | "draft" | "uninv" | "later" | "paid" | "none";

/** Worst first. `noinv` ranks with `need`: both are "deposit not in" on a booked job. */
export const STATE_RANK: Record<SlotState, number> = {
  over: 0, need: 1, noinv: 1, sent: 2, draft: 3, uninv: 4, later: 5, paid: 6, none: 7,
};

export type Slot = {
  key: SlotKey;
  state: SlotState;
  /** The slot's figure: invoice totals, or the uninvoiced remainder for later/uninv; null for noinv/none. */
  amountCents: number | null;
  /** Still owing on the slot's invoices. */
  balanceCents: number;
  /** Earliest due date among the slot's unpaid invoices. */
  dueOn: string | null;
  invoiceIds: string[];
  /** The slot's worst unpaid invoice — what its pill and table cell describe. Null when nothing is owing on an invoice. */
  lead: SlotLead | null;
};

/** One unpaid invoice as a pill, a cell or the amount block shows it. Figures only; the words are the screen's. */
export type SlotLead = {
  invoiceId: string;
  number: string | null;
  kind: JobMoneyInvoice["kind"];
  state: SlotState;
  /** Sent to the customer (issued or later), as opposed to a draft. */
  sent: boolean;
  balanceCents: number;
  dueOn: string | null;
  /** Melbourne days past the due date, when overdue. */
  overdueDays: number | null;
  /** Melbourne days until the due date (0 = today, negative = past but not yet overdue). */
  dueInDays: number | null;
  /** The invoice as a whole-number share of the contract — "Deposit 50%". */
  pctOfContract: number | null;
  views: number;
};

/** The To-chase sections, in page order; `paid_in_full` leaves the active views (R9). */
export type Section = "overdue" | "deposit_not_in" | "closed_owing" | "waiting" | "not_booked" | "nothing" | "paid_in_full";
export const SECTIONS: readonly Section[] = ["overdue", "deposit_not_in", "closed_owing", "waiting", "not_booked", "nothing", "paid_in_full"];

export type NextAction = {
  slot: SlotKey;
  /** The invoice behind it, as its pill shows it; null for noinv/uninv. */
  lead: SlotLead | null;
  state: SlotState;
  /** The invoice to act on; null for noinv/uninv (there is none yet). */
  invoiceId: string | null;
  invoiceNumber: string | null;
  /** What can be collected on it now: the invoice balance, or the uninvoiced remainder. */
  amountCents: number | null;
  dueOn: string | null;
};

export type JobMoneyRow = {
  estimateId: string;
  address: string;
  customer: string | null;
  woRef: string | null;
  contractor: string | null;
  lane: Lane;
  startDate: string | null;
  /** Melbourne days from today to the start (negative = start date passed). */
  startsInDays: number | null;
  /** In progress, quality check or walkthrough. */
  underWay: boolean;
  contractCents: number;
  variationsCents: number;
  paidCents: number;
  balanceCents: number;
  /** Contract not on any visible invoice yet. */
  uninvoicedCents: number;
  slots: Record<SlotKey, Slot>;
  next: NextAction | null;
  /** Unpaid invoice balances, plus the uninvoiced remainder once the job is closed. */
  collectableCents: number;
  overdueCents: number;
  overdueCount: number;
  health: SlotState;
  section: Section;
  /** A deposit not in on a job starting within a week or already under way — the orange row pulses (⚑P1). */
  pulse: boolean;
  /** Leftover drafts hidden by rule (§6.1 $0 drafts, §6.2 deposit drafts beside a final). Never deleted. */
  hiddenDraftIds: string[];
};

/** Booking confirmed through Walkthrough: a deposit not in on these is `need` (§4.1). */
const NEED_LANES: ReadonlySet<Lane> = new Set(["booking_confirmed", "pre_start", "in_progress", "qa", "walkthrough"]);
const UNDER_WAY: ReadonlySet<Lane> = new Set(["in_progress", "qa", "walkthrough"]);

const worst = (states: readonly SlotState[]): SlotState =>
  states.reduce<SlotState>((w, s) => (STATE_RANK[s] < STATE_RANK[w] ? s : w), "none");

/** Drafted order: issued date, else the day it was drafted, then the timestamp. */
const draftedKey = (i: JobMoneyInvoice) => `${i.issuedOn ?? i.createdAt.slice(0, 10)}|${i.createdAt}`;

/**
 * Leftover drafts are hidden by rule, never removed (§3A.3): a $0.00 draft
 * (§6.1), and a deposit draft on a job that already has a final invoice
 * (§6.2) — the final already nets the whole contract.
 */
export function isLeftoverDraft(inv: JobMoneyInvoice, jobInvoices: readonly JobMoneyInvoice[]): boolean {
  if (inv.status !== "draft") return false;
  if (inv.totalIncCents === 0) return true;
  return inv.kind === "deposit" &&
    jobInvoices.some((o) => o.kind === "final" && o.totalIncCents > 0 && o.status !== "void" && o.status !== "written_off");
}

/**
 * The slot rule (§4.1): deposit-kind invoices sit in the deposit slot; when a
 * job has none, its FIRST payment request sits there even when labelled
 * Progress (live on three imported jobs, 12 Oct). Finals sit in the final
 * slot; everything else is progress.
 */
export function slotOf(inv: JobMoneyInvoice, visible: readonly JobMoneyInvoice[]): SlotKey {
  if (inv.kind === "final") return "final";
  if (inv.kind === "deposit") return "deposit";
  if (inv.kind === "progress" && !visible.some((v) => v.kind === "deposit")) {
    const firstProgress = [...visible].filter((v) => v.kind === "progress").sort((a, b) => (draftedKey(a) < draftedKey(b) ? -1 : 1))[0];
    if (firstProgress?.id === inv.id) return "deposit";
  }
  return "progress";
}

// ---------------------------------------------------------------------------
// The row
// ---------------------------------------------------------------------------

export function jobMoneyRow(
  job: JobMoneyJob,
  jobInvoices: readonly JobMoneyInvoice[],
  payments: readonly DerivePayment[],
  now: Date,
): JobMoneyRow {
  const today = melbourneToday(now);
  const lane: Lane = job.woStage ? laneFor(job.woStage, job.startDate, today) : "offered";
  const live = jobInvoices.filter((i) => i.status !== "void" && i.status !== "written_off");
  const hidden = live.filter((i) => isLeftoverDraft(i, live));
  const visible = live.filter((i) => !hidden.includes(i));

  const contractCents = adjustedContractCents(job.acceptedTotalCents, job.variations);
  const paidCents = jobInvoices.reduce((s, i) => s + invoicePaidCents(i, payments), 0);
  const balanceCents = contractCents - paidCents;
  const uninvoicedCents = Math.max(0, contractCents - visible.reduce((s, i) => s + i.totalIncCents, 0));

  const stateOf = (inv: JobMoneyInvoice, slot: SlotKey): SlotState => {
    if (invoiceBalanceCents(inv, payments) <= 0) return "paid";
    if (invoiceIsOverdue(inv, payments, now)) return "over";
    if (slot === "deposit" && NEED_LANES.has(lane)) return "need";
    return inv.status === "draft" ? "draft" : "sent";
  };

  const leadOf = (inv: JobMoneyInvoice, slot: SlotKey): SlotLead => {
    const state = stateOf(inv, slot);
    return {
      invoiceId: inv.id, number: inv.number, kind: inv.kind, state,
      sent: inv.status !== "draft",
      balanceCents: invoiceBalanceCents(inv, payments),
      dueOn: inv.dueOn,
      overdueDays: state === "over" && inv.dueOn ? daysBetween(inv.dueOn, today) : null,
      dueInDays: inv.dueOn ? daysBetween(today, inv.dueOn) : null,
      pctOfContract: contractCents > 0 ? Math.round((inv.totalIncCents / contractCents) * 100) : null,
      views: inv.views ?? 0,
    };
  };

  const bySlot: Record<SlotKey, JobMoneyInvoice[]> = { deposit: [], progress: [], final: [] };
  for (const inv of visible) bySlot[slotOf(inv, visible)].push(inv);

  const build = (key: SlotKey): Slot => {
    const invs = bySlot[key];
    if (invs.length > 0) {
      const unpaid = invs.filter((i) => invoiceBalanceCents(i, payments) > 0);
      const dues = unpaid.map((i) => i.dueOn).filter((d): d is string => !!d).sort();
      const first = [...unpaid].sort((a, b) => STATE_RANK[stateOf(a, key)] - STATE_RANK[stateOf(b, key)] || (a.dueOn ?? "9").localeCompare(b.dueOn ?? "9"))[0];
      return {
        lead: first ? leadOf(first, key) : null,
        key, state: worst(invs.map((i) => stateOf(i, key))),
        amountCents: invs.reduce((s, i) => s + i.totalIncCents, 0),
        balanceCents: unpaid.reduce((s, i) => s + invoiceBalanceCents(i, payments), 0),
        dueOn: dues[0] ?? null,
        invoiceIds: invs.map((i) => i.id),
      };
    }
    const empty = (state: SlotState, amountCents: number | null): Slot => ({ key, state, amountCents, balanceCents: 0, dueOn: null, invoiceIds: [], lead: null });
    if (key === "deposit") {
      if (visible.length > 0 || lane === "closed") return empty("none", null);
      return NEED_LANES.has(lane) ? empty("noinv", null) : empty("later", null);
    }
    if (key === "final" && uninvoicedCents > 0) return empty(lane === "closed" ? "uninv" : "later", uninvoicedCents);
    return empty("none", null);
  };
  const slots: Record<SlotKey, Slot> = { deposit: build("deposit"), progress: build("progress"), final: build("final") };

  const overdueInvs = visible.filter((i) => invoiceIsOverdue(i, payments, now));
  const collectableCents =
    visible.reduce((s, i) => s + Math.max(0, invoiceBalanceCents(i, payments)), 0) + (lane === "closed" ? uninvoicedCents : 0);

  // The next thing to act on: the worst actionable slot, deposit first on a tie.
  const ACTIONABLE: ReadonlySet<SlotState> = new Set(["over", "need", "noinv", "sent", "draft", "uninv"]);
  const pick = (["deposit", "progress", "final"] as const)
    .filter((k) => ACTIONABLE.has(slots[k].state))
    .sort((a, b) => STATE_RANK[slots[a].state] - STATE_RANK[slots[b].state])[0];
  let next: NextAction | null = null;
  if (pick) {
    const slot = slots[pick];
    const inv = bySlot[pick]
      .filter((i) => invoiceBalanceCents(i, payments) > 0)
      .sort((a, b) => STATE_RANK[stateOf(a, pick)] - STATE_RANK[stateOf(b, pick)] || (a.dueOn ?? "9").localeCompare(b.dueOn ?? "9") || draftedKey(a).localeCompare(draftedKey(b)))[0];
    next = {
      slot: pick, state: slot.state, lead: inv ? leadOf(inv, pick) : null,
      invoiceId: inv?.id ?? null, invoiceNumber: inv?.number ?? null,
      amountCents: inv ? invoiceBalanceCents(inv, payments) : slot.state === "uninv" ? uninvoicedCents : null,
      dueOn: inv?.dueOn ?? null,
    };
  }

  const health: SlotState = next?.state ?? (balanceCents <= 0 ? "paid" : "later");
  const underWay = UNDER_WAY.has(lane);
  const section: Section =
    balanceCents <= 0 && visible.every((i) => invoiceBalanceCents(i, payments) <= 0) ? "paid_in_full"
    : overdueInvs.length > 0 ? "overdue"
    : slots.deposit.state === "need" || slots.deposit.state === "noinv" ? "deposit_not_in"
    : lane === "closed" && collectableCents > 0 ? "closed_owing"
    : visible.some((i) => i.status !== "draft" && invoiceBalanceCents(i, payments) > 0) ? "waiting"
    : lane === "offered" ? "not_booked"
    : visible.some((i) => invoiceBalanceCents(i, payments) > 0) ? "waiting"
    : "nothing";

  return {
    estimateId: job.estimateId, address: job.address, customer: job.customer, woRef: job.woRef, contractor: job.contractor,
    lane, startDate: job.startDate,
    startsInDays: job.startDate ? daysBetween(today, job.startDate) : null,
    underWay,
    contractCents, variationsCents: contractCents - job.acceptedTotalCents, paidCents, balanceCents, uninvoicedCents,
    slots, next, collectableCents,
    overdueCents: overdueInvs.reduce((s, i) => s + invoiceBalanceCents(i, payments), 0),
    overdueCount: overdueInvs.length,
    health, section,
    pulse: (health === "need" || health === "noinv") && (underWay || lane === "pre_start"),
    hiddenDraftIds: hidden.map((i) => i.id),
  };
}

/**
 * The one ordering (§4.1), used by every view: over, need/noinv, sent, draft,
 * then the rest. Overdue: longest overdue first. Need: jobs already under way
 * first, then the soonest start. Then the soonest due, then the larger sum.
 */
export function compareRows(a: JobMoneyRow, b: JobMoneyRow): number {
  const r = STATE_RANK[a.health] - STATE_RANK[b.health];
  if (r !== 0) return r;
  if (a.health === "need" || a.health === "noinv") {
    if (a.underWay !== b.underWay) return a.underWay ? -1 : 1;
    const sa = a.startDate ?? "9999-12-31", sb = b.startDate ?? "9999-12-31";
    if (sa !== sb) return sa < sb ? -1 : 1;
  }
  const da = a.next?.dueOn ?? "9999-12-31", db = b.next?.dueOn ?? "9999-12-31";
  if (da !== db) return da < db ? -1 : 1;
  const amt = (b.next?.amountCents ?? 0) - (a.next?.amountCents ?? 0);
  if (amt !== 0) return amt;
  return a.address.localeCompare(b.address);
}

// ---------------------------------------------------------------------------
// The page: rows, blocks, strip, headline
// ---------------------------------------------------------------------------

export type CustomersBlock = {
  /** Σ balances on issued-and-later invoices — the old Outstanding tile, same function. */
  outstandingCents: number;
  outstandingCount: number;
  overdueCents: number;
  overdueCount: number;
  /** Σ visible drafts (leftovers excluded). */
  notSentCents: number;
  notSentCount: number;
};

export type ContractorsBlock = {
  toApproveCents: number; toApproveCount: number;
  approvedToPayCents: number; approvedToPayCount: number;
  /** Past the pay-by date (contractorInvoiceTone: approved, unpaid, past terms). */
  pastPayByCents: number; pastPayByCount: number;
  /** The block's figure: to approve + approved to pay. */
  owingCents: number;
};

export type MaterialsBlock = {
  toCheckCents: number; toCheckCount: number;
  toApproveCents: number; toApproveCount: number;
  toPayCents: number; toPayCount: number;
  /** The block's figure: everything not yet paid. */
  openCents: number;
};

export type ActivityBlock = { receivedFortnightCents: number };

/** A lane's colour, worst first: bad (overdue) · warn (deposit not in) · wait (sent) · "" (drafts) · ok · empty. */
export type LaneTone = "bad" | "warn" | "wait" | "" | "ok";
export type StageCell = { lane: Lane; jobs: number; collectableCents: number; overdueCents: number; tone: LaneTone };

export function laneTone(rows: readonly JobMoneyRow[]): LaneTone {
  const hs = new Set(rows.map((r) => r.health));
  if (hs.has("over")) return "bad";
  if (hs.has("need") || hs.has("noinv")) return "warn";
  if (hs.has("sent")) return "wait";
  if (hs.has("draft") || hs.has("uninv")) return "";
  return rows.length ? "ok" : "";
}

export type HeadlineFigures = {
  noDepositJobs: number;
  startWithinThreeDays: number;
  underWay: number;
  overdueInvoices: number;
  overdueCents: number;
  contractorPastPayBy: number;
};

export type JobMoneyPage = {
  /** Every job, worst first (§4.1 ordering) — paid-in-full rows included, flagged by section. */
  rows: JobMoneyRow[];
  blocks: { customers: CustomersBlock; contractors: ContractorsBlock; materials: MaterialsBlock; activity: ActivityBlock };
  strip: StageCell[];
  headline: HeadlineFigures;
  /** Leftover drafts hidden by rule, across every job (the closing line). */
  hiddenDraftCount: number;
};

export function jobMoneyPage(input: JobMoneyInput): JobMoneyPage {
  const { now, payments } = input;
  const today = melbourneToday(now);
  const byJob = new Map<string, JobMoneyInvoice[]>();
  for (const inv of input.invoices) {
    const list = byJob.get(inv.estimateId);
    if (list) list.push(inv); else byJob.set(inv.estimateId, [inv]);
  }
  const rows = input.jobs.map((j) => jobMoneyRow(j, byJob.get(j.estimateId) ?? [], payments, now)).sort(compareRows);
  const active = rows.filter((r) => r.section !== "paid_in_full");

  const tiles = dashboardTiles(input.invoices, payments, now);
  const hiddenIds = new Set(rows.flatMap((r) => r.hiddenDraftIds));
  const jobIds = new Set(input.jobs.map((j) => j.estimateId));
  const visibleDrafts = input.invoices.filter((i) => i.status === "draft" && !hiddenIds.has(i.id) && jobIds.has(i.estimateId));
  const customers: CustomersBlock = {
    outstandingCents: tiles.outstandingCents, outstandingCount: tiles.outstandingCount,
    overdueCents: tiles.overdueCents, overdueCount: tiles.overdueCount,
    notSentCents: visibleDrafts.reduce((s, i) => s + i.totalIncCents, 0), notSentCount: visibleDrafts.length,
  };

  let toApproveCents = 0, toApproveCount = 0, approvedToPayCents = 0, approvedToPayCount = 0, pastPayByCents = 0, pastPayByCount = 0;
  for (const ci of input.contractorInvoices) {
    if (ci.status === "submitted") { toApproveCents += ci.totalIncCents; toApproveCount += 1; }
    if (ci.status === "approved") { approvedToPayCents += ci.totalIncCents; approvedToPayCount += 1; }
    if (contractorInvoiceTone(ci, today).overdueDays > 0) { pastPayByCents += ci.totalIncCents; pastPayByCount += 1; }
  }
  const contractors: ContractorsBlock = {
    toApproveCents, toApproveCount, approvedToPayCents, approvedToPayCount, pastPayByCents, pastPayByCount,
    owingCents: toApproveCents + approvedToPayCents,
  };

  const sum = (xs: readonly number[]) => xs.reduce((s, x) => s + x, 0);
  const costs = input.materials.jobCosts.map((c) => ({ status: c.status, amountIncCents: c.amountExCents + c.gstCents }));
  const recorded = costs.filter((c) => c.status === "recorded");
  const approved = costs.filter((c) => c.status === "approved");
  const materials: MaterialsBlock = {
    toCheckCents: sum(input.materials.intakePending.map((d) => d.totalCents)), toCheckCount: input.materials.intakePending.length,
    toApproveCents: sum(recorded.map((c) => c.amountIncCents)), toApproveCount: recorded.length,
    toPayCents: sum(approved.map((c) => c.amountIncCents)), toPayCount: approved.length,
    openCents: 0,
  };
  materials.openCents = materials.toCheckCents + materials.toApproveCents + materials.toPayCents;

  const strip: StageCell[] = LANES.map((lane) => {
    const inLane = active.filter((r) => r.lane === lane);
    return {
      lane, jobs: inLane.length,
      collectableCents: sum(inLane.map((r) => r.collectableCents)),
      overdueCents: sum(inLane.map((r) => r.overdueCents)),
      tone: laneTone(inLane),
    };
  });

  const noDeposit = active.filter((r) => r.section === "deposit_not_in");
  const headline: HeadlineFigures = {
    noDepositJobs: noDeposit.length,
    startWithinThreeDays: noDeposit.filter((r) => !r.underWay && r.startsInDays !== null && r.startsInDays <= 3).length,
    underWay: noDeposit.filter((r) => r.underWay).length,
    overdueInvoices: sum(active.map((r) => r.overdueCount)),
    overdueCents: sum(active.map((r) => r.overdueCents)),
    contractorPastPayBy: pastPayByCount,
  };

  return {
    rows,
    blocks: { customers, contractors, materials, activity: { receivedFortnightCents: tiles.collectedFortnightCents } },
    strip, headline,
    hiddenDraftCount: hiddenIds.size,
  };
}

/**
 * The headline sentence (R2, §4.1), written from the figures on every load.
 * Every clause drops when its count is zero. `fmt` is the display edge's money
 * formatter — this module never decides how a dollar looks.
 *
 *   "19 jobs have no deposit in. 3 start within three days and 3 are already
 *    under way. Nothing is overdue."
 */
export function headlineSentences(h: HeadlineFigures, fmt: (cents: number) => string): string[] {
  const out: string[] = [];
  if (h.noDepositJobs > 0) {
    out.push(`${h.noDepositJobs} ${h.noDepositJobs === 1 ? "job has" : "jobs have"} no deposit in.`);
    const parts: string[] = [];
    if (h.startWithinThreeDays > 0) parts.push(`${h.startWithinThreeDays} ${h.startWithinThreeDays === 1 ? "starts" : "start"} within three days`);
    if (h.underWay > 0) parts.push(`${h.underWay} ${h.underWay === 1 ? "is" : "are"} already under way`);
    if (parts.length) out.push(`${parts.join(" and ")}.`);
  }
  out.push(h.overdueInvoices > 0
    ? `${h.overdueInvoices} customer ${h.overdueInvoices === 1 ? "invoice is" : "invoices are"} overdue, ${fmt(h.overdueCents)}.`
    : "Nothing is overdue.");
  if (h.contractorPastPayBy > 0) {
    out.push(`${h.contractorPastPayBy} contractor ${h.contractorPastPayBy === 1 ? "invoice is" : "invoices are"} past the pay-by date.`);
  }
  return out;
}

// ---------------------------------------------------------------------------
// Page helpers — the views filter and total rows here, never in a component
// ---------------------------------------------------------------------------

/** Search (address, customer, contractor, work-order ref — R §4.2) and the stage-strip filter. */
export function matchRows(rows: readonly JobMoneyRow[], f: { q?: string; lane?: Lane | null }): JobMoneyRow[] {
  const q = (f.q ?? "").trim().toLowerCase();
  return rows.filter((r) =>
    (!f.lane || r.lane === f.lane) &&
    (!q || [r.address, r.customer ?? "", r.contractor ?? "", r.woRef ?? ""].join(" ").toLowerCase().includes(q)));
}

/** All jobs view filters (§4.2): All · Overdue · Deposit not in · Final unpaid · Paid in full. */
export type TableFilter = "all" | "over" | "dep" | "fin" | "paid";
export const TABLE_FILTERS: readonly TableFilter[] = ["all", "over", "dep", "fin", "paid"];
export function tableFilter(f: TableFilter, showPaid: boolean): (r: JobMoneyRow) => boolean {
  switch (f) {
    case "over": return (r) => r.health === "over";
    case "dep": return (r) => ["need", "noinv", "over"].includes(r.slots.deposit.state) && r.section !== "paid_in_full";
    case "fin": return (r) => ["draft", "sent", "over", "uninv"].includes(r.slots.final.state);
    case "paid": return (r) => r.section === "paid_in_full";
    default: return (r) => showPaid || r.section !== "paid_in_full";
  }
}

/** A section's figure: what can be collected on each row's next action (the amount blocks, added up). */
export const totalNowCents = (rows: readonly JobMoneyRow[]): number => rows.reduce((s, r) => s + (r.next?.amountCents ?? 0), 0);
/** A lane's or group's figure: everything collectable on its rows. */
export const totalCollectableCents = (rows: readonly JobMoneyRow[]): number => rows.reduce((s, r) => s + r.collectableCents, 0);
export const totalOverdueCents = (rows: readonly JobMoneyRow[]): number => rows.reduce((s, r) => s + r.overdueCents, 0);

/** The headline as styled parts: `o` = the orange count, `r` = a red sentence. `headlineSentences` is the same words, plain. */
export type HeadlinePart = { text: string; tone: "" | "o" | "r" };
export function headlineParts(h: HeadlineFigures, fmt: (cents: number) => string): HeadlinePart[] {
  const sentences = headlineSentences(h, fmt);
  const parts: HeadlinePart[] = [];
  sentences.forEach((text, i) => {
    const sep = i === 0 ? "" : " ";
    if (i === 0 && h.noDepositJobs > 0) {
      const lead = `${h.noDepositJobs} ${h.noDepositJobs === 1 ? "job" : "jobs"}`;
      parts.push({ text: lead, tone: "o" }, { text: text.slice(lead.length), tone: "" });
      return;
    }
    const red = /overdue, |past the pay-by date/.test(text);
    parts.push({ text: sep + text, tone: red ? "r" : "" });
  });
  return parts;
}
