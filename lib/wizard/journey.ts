/**
 * A wizard run as a lead with a status (docs/briefs/wizard-progress-crm-buckets.md).
 *
 * Pure: the bucket rule (§4), the page labels (the wizard's pages are
 * numbered 1–6 and branch on job type — app/wizard/WizardApp.tsx), the pill
 * wording (§5) and the "6 of 8 · 9 min · last active 2h ago" line. Every
 * writer of wizard_drafts.bucket goes through bucketFor, so the stored
 * value can never disagree with the rule.
 */

import { melbourneParts } from "@/lib/time/businessHours";

export const WIZARD_BUCKETS = ["online_now", "ready_call", "ready_visit", "needs_help", "dropped", "priced_no_request"] as const;
export type WizardBucket = (typeof WIZARD_BUCKETS)[number];

export const WIZARD_OUTCOMES = ["none", "call_requested", "visit_requested", "question_asked", "help_requested"] as const;
export type WizardOutcome = (typeof WIZARD_OUTCOMES)[number];

/** ⚑ D2 — idle this long and a session counts as dropped (or priced, no request). */
export const IDLE_MINUTES = 45;

export type BucketInput = {
  /** All required questions answered and a price shown = the draft converted. */
  completed: boolean;
  outcome: WizardOutcome;
  lastActiveAt: string | null;
  now: Date;
  idleMinutes?: number;
};

/**
 * §4, one row per case. Forward only on customer action (D→B→A); to C/C+ by
 * time; a later action pulls a C/C+ session back into A or B.
 *
 * A call or visit request only exists after the price (the confirm-loop
 * editor), so A's "completed" is implied by the outcome; a row that somehow
 * carried the outcome without completion still reads Ready — a person asked
 * to be called, and that beats a flag.
 */
export function bucketFor(i: BucketInput): WizardBucket {
  if (i.outcome === "call_requested") return "ready_call";
  if (i.outcome === "visit_requested") return "ready_visit";
  if (i.outcome === "question_asked" || i.outcome === "help_requested") return "needs_help";
  const idle = (i.idleMinutes ?? IDLE_MINUTES) * 60_000;
  const last = i.lastActiveAt ? new Date(i.lastActiveAt).getTime() : 0;
  if (i.now.getTime() - last > idle) return i.completed ? "priced_no_request" : "dropped";
  return "online_now";
}

// ---- pages ------------------------------------------------------------------

/**
 * Estimator journey v2 phase 2: a customer's interior walk is the QUICK LOOK —
 * four screens, and no contact page at all (⚑1 moved the email to the reveal).
 * These names are what the CRM board says a lead dropped on, so they have to
 * be the screens the customer actually saw.
 *
 * ⚑ The describe and upload routes still walk the older pages (property →
 * condition → details → contact), and one label list cannot name both. The
 * quick look is the default and the overwhelming majority, so it wins; a
 * described job that dropped on page 3 reads "The job" rather than "Details".
 * Worth a route field on the draft if the board ever needs to tell them apart.
 */
const INTERIOR_PAGES = ["The address", "The place", "The job", "Condition"] as const;
const EXTERIOR_PAGES = ["Property", "House", "Scope", "Condition", "Extras", "Your details"] as const;

/** The page's name for a person. "both" runs the interior pages (WizardApp branches on exterior only). */
export function pageLabel(jobType: string | null | undefined, page: number): string {
  const list = jobType === "exterior" ? EXTERIOR_PAGES : INTERIOR_PAGES;
  return list[Math.min(Math.max(page, 1), list.length) - 1] ?? `Page ${page}`;
}

// ---- wording ----------------------------------------------------------------

export type Tone = "emerald" | "amber" | "amber-outline" | "clay" | "muted";

/** §5 pill: label + tone. Dropped carries the page it stopped on. */
export function bucketPill(bucket: WizardBucket, jobType: string | null | undefined, furthestPage: number): { label: string; tone: Tone } {
  switch (bucket) {
    case "ready_call": return { label: "Ready · call", tone: "emerald" };
    case "ready_visit": return { label: "Ready · visit", tone: "emerald" };
    case "needs_help": return { label: "Needs help", tone: "amber" };
    case "dropped": return { label: `Dropped · ${pageLabel(jobType, furthestPage)}`, tone: "clay" };
    case "priced_no_request": return { label: "Priced · no request", tone: "amber-outline" };
    default: return { label: "Online now", tone: "muted" };
  }
}

/** The board lane / "lead stage" wording (§4 table). */
export function bucketStage(bucket: WizardBucket, jobType: string | null | undefined, furthestPage: number): string {
  switch (bucket) {
    case "ready_call": case "ready_visit": return "Ready to confirm";
    case "needs_help": return "Needs help";
    case "dropped": return `Dropped — ${pageLabel(jobType, furthestPage)}`;
    case "priced_no_request": return "Priced, no request";
    default: return "Online now";
  }
}

export function fmtActive(seconds: number): string {
  if (seconds < 60) return "<1 min";
  const m = Math.round(seconds / 60);
  if (m < 60) return `${m} min`;
  return `${Math.floor(m / 60)}h ${String(m % 60).padStart(2, "0")}m`;
}

export function agoShort(iso: string | null, now: Date): string {
  if (!iso) return "never";
  const ms = now.getTime() - new Date(iso).getTime();
  const min = Math.floor(ms / 60_000);
  if (min < 1) return "just now";
  if (min < 60) return `${min}m ago`;
  const h = Math.floor(min / 60);
  if (h < 48) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}

export type JourneyBits = { furthestPage: number; pagesTotal: number; activeSeconds: number; lastActiveAt: string | null };

/** §5 the mono line under the pill. */
export function journeyLine(j: JourneyBits, now: Date): string {
  return `${j.furthestPage} of ${j.pagesTotal} · ${fmtActive(j.activeSeconds)} · last active ${agoShort(j.lastActiveAt, now)}`;
}

/** The serialisable journey a staff screen shows (pill, line, drawer). */
export type WizardJourney = {
  id: string;
  estimateId: string | null;
  accountId: string | null;
  name: string | null;
  email: string | null;
  phone: string | null;
  address: string | null;
  suburb: string | null;
  jobType: string | null;
  mode: string | null;
  entrySource: string | null;
  bucket: WizardBucket;
  outcome: WizardOutcome;
  outcomeAt: string | null;
  outcomeNote: string | null;
  currentPage: number;
  furthestPage: number;
  pagesTotal: number;
  activeSeconds: number;
  stepTimes: Record<string, number>;
  startedAt: string | null;
  lastActiveAt: string | null;
  convertedAt: string | null;
  droppedAt: string | null;
  estValueCents: number | null;
};

/** wizard_drafts row → WizardJourney (tolerant of the pre-20270107 shape). */
export function journeyFromRow(r: Record<string, unknown>): WizardJourney {
  const st = (r.step_times && typeof r.step_times === "object" && !Array.isArray(r.step_times)) ? (r.step_times as Record<string, unknown>) : {};
  const stepTimes: Record<string, number> = {};
  for (const [k, v] of Object.entries(st)) if (typeof v === "number" && Number.isFinite(v)) stepTimes[k] = v;
  const bucket = (WIZARD_BUCKETS as readonly string[]).includes(String(r.bucket)) ? (r.bucket as WizardBucket) : "online_now";
  const outcome = (WIZARD_OUTCOMES as readonly string[]).includes(String(r.outcome)) ? (r.outcome as WizardOutcome) : "none";
  const n = (v: unknown, d: number) => (typeof v === "number" && Number.isFinite(v) ? v : d);
  const s = (v: unknown) => (typeof v === "string" && v ? v : null);
  return {
    id: String(r.id), estimateId: s(r.estimate_id), accountId: s(r.account_id),
    name: s(r.name), email: s(r.email), phone: s(r.phone), address: s(r.address), suburb: s(r.suburb),
    jobType: s(r.job_type), mode: s(r.mode), entrySource: s(r.entry_source),
    bucket, outcome, outcomeAt: s(r.outcome_at), outcomeNote: s(r.outcome_note),
    currentPage: n(r.current_page, 1), furthestPage: n(r.furthest_page, 1), pagesTotal: n(r.pages_total, 6),
    activeSeconds: n(r.active_seconds, 0), stepTimes,
    startedAt: s(r.started_at), lastActiveAt: s(r.last_seen_at), convertedAt: s(r.converted_at), droppedAt: s(r.dropped_at),
    estValueCents: typeof r.est_value_cents === "number" ? r.est_value_cents : null,
  };
}

/** Who this is for a title: name, else email, else the address — "an address is a lead". */
export function journeyWho(j: Pick<WizardJourney, "name" | "email" | "address" | "suburb">): string {
  return j.name?.trim() || j.email || j.address || j.suburb || "Unknown";
}

/** The per-page list for the Journey drawer: every page up to the furthest, with its seconds. */
export function journeySteps(j: Pick<WizardJourney, "jobType" | "furthestPage" | "pagesTotal" | "stepTimes" | "currentPage">): Array<{ page: number; label: string; seconds: number; reached: boolean; current: boolean }> {
  const out = [];
  for (let p = 1; p <= j.pagesTotal; p++) {
    out.push({ page: p, label: pageLabel(j.jobType, p), seconds: j.stepTimes[String(p)] ?? 0, reached: p <= j.furthestPage, current: p === j.currentPage });
  }
  return out;
}

export const WIZARD_SESSION_COLUMNS =
  "id, user_id, account_id, estimate_id, name, email, phone, address, suburb, postcode, job_type, mode, entry_source, bucket, outcome, outcome_at, outcome_note, current_page, furthest_page, pages_total, active_seconds, step_times, started_at, last_seen_at, converted_at, dropped_at, est_value_cents, progress_pct";

// ---- C7b: the estimate's own status — the extended pill vocabulary --------

/**
 * C7b (brief step 2.2): the Wizard-status column speaks for the ESTIMATE, not
 * only the wizard session behind it. Every state here is DERIVED, on the
 * server, from records that already exist — the estimate row, its latest
 * `confirmation_requests` row, `estimate_views`, `work_orders`, the wizard
 * journey and the confirm loop's own `customer.confirmed` flags. No status
 * string is stored anywhere; the table test walks every state.
 *
 * Precedence is the order a person would want to know things in: signed
 * beats waiting-on-us beats waiting-on-them beats "they left". A row that
 * matches nothing new keeps the wizard bucket pill it had (or a dash).
 */

export type EstimateRequestView = {
  kind: "remote" | "visit" | "fix_online";
  status: "requested" | "question_asked" | "fixed" | "visit_booked" | "declined";
  requestedAt: string;
  suggestedAction: "fix" | "ask" | "visit" | null;
  fixedPriceCents: number | null;
};

export type EstimateLoopView = {
  /** Loop areas the customer confirmed, of the loop areas on the estimate. */
  confirmed: number;
  total: number;
  unit: "rooms" | "sides";
};

export type EstimatePillInput = {
  status: string;
  acceptedAt: string | null;
  viewedAt: string | null;
  /** `estimate_views`: one row per customer open session. */
  views: { count: number; lastAt: string | null };
  validUntil: string | null;
  hasWorkOrder: boolean;
  /** The LATEST confirmation request, whatever its status. */
  request: EstimateRequestView | null;
  wizard: WizardJourney | null;
  /** Null when the blocks were not read for this row (never "0 of 0"). */
  loop: EstimateLoopView | null;
  photos: number;
  /** ± band, when the row knows one. */
  bandPct: number | null;
  /**
   * C14: a commercial brief. NOTHING produces this yet — the state exists so
   * the vocabulary is complete and C14 has one place to switch it on.
   */
  brief: boolean;
  now: Date;
};

export type EstimatePillState =
  | "accepted" | "brief" | "question" | "sent_remote" | "sent_visit"
  | "viewed_no_reply" | "abandoned" | "wizard" | "none";

export type EstimatePill = { state: EstimatePillState; label: string; tone: Tone; sub: string | null };

const dayMonth = (iso: string) => new Date(iso).toLocaleDateString("en-AU", { day: "2-digit", month: "2-digit", timeZone: "Australia/Melbourne" });

/**
 * Whole days from today until a date column (yyyy-mm-dd), on Melbourne's
 * calendar — the same `melbourneParts` that C7's `holdUntil` wrote the date
 * with, so "hold ends in 14d" counts the days the customer was promised. No
 * offset is hardcoded (the repo's boundary guard forbids it: DST).
 */
export function daysUntil(date: string, now: Date): number {
  const t = melbourneParts(now);
  const today = Date.UTC(t.y, t.m - 1, t.d);
  const [y, m, d] = date.slice(0, 10).split("-").map(Number);
  const target = Date.UTC(y, m - 1, d);
  return Math.round((target - today) / 86_400_000) || 0; // never -0
}

function plural(n: number, one: string, many = `${one}s`): string {
  return `${n} ${n === 1 ? one : many}`;
}

/** The mono line under a sent state: "9 of 9 · ±4% · 7 photos · 41m ago". */
function sentLine(i: EstimatePillInput, since: string): string {
  const parts: string[] = [];
  if (i.loop && i.loop.total > 0) parts.push(`${i.loop.confirmed} of ${i.loop.total}${i.loop.unit === "sides" ? " sides" : ""}`);
  if (i.bandPct != null) parts.push(`±${i.bandPct}%`);
  if (i.photos > 0) parts.push(plural(i.photos, "photo"));
  parts.push(agoShort(since, i.now));
  return parts.join(" · ");
}

export function estimatePill(i: EstimatePillInput): EstimatePill {
  if (i.status === "accepted") {
    const when = i.acceptedAt ? ` ${dayMonth(i.acceptedAt)}` : "";
    return {
      state: "accepted",
      label: `Accepted${when}${i.hasWorkOrder ? " · job created" : ""}`,
      tone: "emerald",
      sub: i.hasWorkOrder ? null : "no job yet",
    };
  }
  if (i.brief) {
    return { state: "brief", label: "Brief · book a visit", tone: "amber", sub: i.photos > 0 ? plural(i.photos, "photo") : null };
  }
  const r = i.request;
  if (r?.status === "question_asked") {
    // The row has no question_asked_at column; the request date is the floor
    // (a question is only ever asked after the request). See the parking lot.
    const days = Math.max(0, Math.floor((i.now.getTime() - new Date(r.requestedAt).getTime()) / 86_400_000));
    return { state: "question", label: `Question unanswered · ${days}d`, tone: "amber", sub: sentLine(i, r.requestedAt) };
  }
  if (r?.status === "requested") {
    return r.kind === "visit"
      ? { state: "sent_visit", label: "Sent · needs a visit", tone: "amber-outline", sub: sentLine(i, r.requestedAt) }
      : { state: "sent_remote", label: "Sent · confirm remotely", tone: "emerald", sub: sentLine(i, r.requestedAt) };
  }
  if (i.status === "sent" && i.viewedAt) {
    const n = Math.max(1, i.views.count);
    const hold = i.validUntil ? daysUntil(i.validUntil, i.now) : null;
    const fixed = r?.status === "fixed";
    const holdWords = hold == null ? null
      : hold > 0 ? `${fixed ? "hold ends" : "expires"} in ${hold}d`
      : fixed ? "hold has ended" : "expired";
    return {
      state: "viewed_no_reply",
      label: `Viewed ${n}× · no reply`,
      tone: "amber",
      sub: [`last opened ${agoShort(i.views.lastAt ?? i.viewedAt, i.now)}`, holdWords].filter(Boolean).join(" · "),
    };
  }
  const w = i.wizard;
  if (w && i.status === "draft" && i.loop && i.loop.total > 0 && i.loop.confirmed < i.loop.total
      && (w.bucket === "priced_no_request" || w.bucket === "dropped")) {
    // They saw a price, started confirming it and left. The room they stopped
    // on is the one after the last they confirmed.
    const at = Math.min(i.loop.confirmed + 1, i.loop.total);
    const contact = w.email || w.phone || null;
    return {
      state: "abandoned",
      label: `Abandoned · ${i.loop.unit === "sides" ? "side" : "room"} ${at} of ${i.loop.total}`,
      tone: "clay",
      sub: `${contact ?? "no contact details"} · last active ${agoShort(w.lastActiveAt, i.now)}`,
    };
  }
  if (w) {
    const pill = bucketPill(w.bucket, w.jobType, w.furthestPage);
    return { state: "wizard", label: pill.label, tone: pill.tone, sub: journeyLine(w, i.now) };
  }
  return { state: "none", label: "—", tone: "muted", sub: null };
}

// ---- C7b: one contextual action per row --------------------------------------

export type RowActionLabel = "Fix price" | "Book" | "Chase" | "Nudge" | "Open job";
export type RowAction = { label: RowActionLabel; href: string };

/**
 * Brief step 2.3, ⚑39: ONE action, or nothing. It comes from the same rules
 * C5 recorded on the request (`suggested_action` = recommendedOutcome at
 * send) — nothing is re-derived here, so the row and the pack never suggest
 * two different things.
 *
 * Fix price and Book land on the pack tab, where the strip's buttons do the
 * work through the C6 route. Chase and Nudge are messages, so they open the
 * customer's thread. Chase without an account falls back to the pack tab —
 * the strip's "Ask a question" is the same route the thread would use — but a
 * Nudge with nobody to nudge is nothing, not a link to nowhere.
 */
export function estimateAction(i: {
  pill: EstimatePillState;
  request: EstimateRequestView | null;
  estimateId: string;
  accountId: string | null;
  workOrderId: string | null;
}): RowAction | null {
  const pack = `/quote?id=${i.estimateId}&tab=pack`;
  const thread = i.accountId ? `/crm/customers/${i.accountId}` : null;
  switch (i.pill) {
    case "accepted": return i.workOrderId ? { label: "Open job", href: `/pc/wo/${i.workOrderId}` } : null;
    case "brief": return { label: "Book", href: pack };
    case "question": return { label: "Chase", href: thread ?? pack };
    case "sent_visit": return { label: "Book", href: pack };
    case "sent_remote": {
      const s = i.request?.suggestedAction;
      if (s === "visit") return { label: "Book", href: pack };
      if (s === "ask") return { label: "Chase", href: thread ?? pack };
      return { label: "Fix price", href: pack };
    }
    case "viewed_no_reply": return thread ? { label: "Nudge", href: thread } : null;
    default: return null;
  }
}

// ---- C7b: the Value cell ------------------------------------------------------

export type RowValue =
  | { kind: "range"; loCents: number; hiCents: number }
  | { kind: "fixed"; cents: number }
  | { kind: "figure"; cents: number }
  | { kind: "none" };

/**
 * Brief step 2.6: a range while the estimate IS a range, one figure with
 * cents once it is fixed. The range comes from `rangeFromTotal` — the same
 * rounding the customer's own screen uses — never from arithmetic here.
 */
export function estimateValue(i: {
  totalCents: number | null;
  status: string;
  hasWizard: boolean;
  bandPct: number | null;
  request: EstimateRequestView | null;
  /** lib/wizard/policy's `rangeFromTotal`, injected so this module stays pure. */
  range: (totalCents: number, pct: number) => { loCents: number; hiCents: number };
}): RowValue {
  if (i.request?.status === "fixed" && i.request.fixedPriceCents != null) return { kind: "fixed", cents: i.request.fixedPriceCents };
  if (i.totalCents == null) return { kind: "none" };
  if (i.status === "accepted") return { kind: "fixed", cents: i.totalCents };
  if (i.hasWizard && i.bandPct != null) return { kind: "range", ...i.range(i.totalCents, i.bandPct) };
  return { kind: "figure", cents: i.totalCents };
}
