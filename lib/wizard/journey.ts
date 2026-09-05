/**
 * A wizard run as a lead with a status (docs/briefs/wizard-progress-crm-buckets.md).
 *
 * Pure: the bucket rule (§4), the page labels (the wizard's pages are
 * numbered 1–6 and branch on job type — app/wizard/WizardApp.tsx), the pill
 * wording (§5) and the "6 of 8 · 9 min · last active 2h ago" line. Every
 * writer of wizard_drafts.bucket goes through bucketFor, so the stored
 * value can never disagree with the rule.
 */

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

const INTERIOR_PAGES = ["Property", "Surfaces", "Condition", "Details", "Paint", "Contact"] as const;
const EXTERIOR_PAGES = ["Property", "House", "Scope", "Condition", "Extras", "Contact"] as const;

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
