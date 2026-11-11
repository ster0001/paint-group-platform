/**
 * Session 3 — Where estimates go. Wizard started → email captured → saved →
 * sent → viewed → accepted, from wizard_drafts and the estimates they became,
 * as a cohort of sessions STARTED in the range. The steps are what is
 * captured today: started_at, an email on the draft (no timestamp of its own
 * yet — B2's per-step stamps come with the wizard-progress brief), an
 * estimate id, and the estimate's sent / viewed / accepted moments. Self-serve
 * acceptance (`outcome_tier`, B2 "with wizard R5") is not captured yet and is
 * said so, not guessed.
 */
import { inRange, melbourneDay, type MetricDef, type MetricInput, type Range, type WizardEventRow } from "../core";

export type FunnelRow = {
  started_on: string; email_captured: boolean; saved: boolean; sent: boolean; viewed: boolean; accepted: boolean;
  furthest: string; lead_source: string; days_sent_to_accepted: number;
  /** Paint Home brief §6: the shopfront the session came through. */
  brand: "paintgroup" | "painthome";
};

/** Paint Home brief §6: a session's brand (null = Paint Group); `brand` on `funnelRows` / `buildFunnel` keeps one shopfront. */
export const brandOfDraft = (d: { brand?: string | null }): "paintgroup" | "painthome" => (d.brand === "painthome" ? "painthome" : "paintgroup");

const STEPS = ["started", "email", "saved", "sent", "viewed", "accepted"] as const;
export type FunnelStepKey = (typeof STEPS)[number];
export const STEP_LABEL: Record<FunnelStepKey, string> = { started: "Wizard started", email: "Email captured", saved: "Estimate saved", sent: "Sent", viewed: "Viewed", accepted: "Accepted" };

export function funnelRows(input: MetricInput, range: Range, brand: "paintgroup" | "painthome" | null = null): FunnelRow[] {
  const f = input.funnel; if (!f) return [];
  const est = new Map(f.estimates.map((e) => [e.id, e]));
  return f.drafts
    .filter((d) => inRange(d.started_at, range) && (brand == null || brandOfDraft(d) === brand))
    .map((d) => {
      const e = d.estimate_id ? est.get(d.estimate_id) : undefined;
      const email = Boolean(d.email);
      const saved = Boolean(d.estimate_id);
      const sent = Boolean(e?.sent_at);
      const viewed = Boolean(e?.viewed_at);
      const accepted = e?.status === "accepted";
      const furthest = accepted ? "accepted" : viewed ? "viewed" : sent ? "sent" : saved ? "saved" : email ? "email" : "started";
      return {
        started_on: melbourneDay(d.started_at), email_captured: email, saved, sent, viewed, accepted, furthest,
        lead_source: e?.lead_source ?? d.lead_source ?? "unknown",
        brand: brandOfDraft(d),
        days_sent_to_accepted: accepted && e?.sent_at && e.accepted_at ? Math.round((Date.parse(e.accepted_at) - Date.parse(e.sent_at)) / 86_400_000 * 10) / 10 : 0,
      };
    });
}

export type FunnelStep = { key: FunnelStepKey; label: string; count: number; pct_of_start: number; dropped: number; drop_note: string };
export type FunnelData = { steps: FunnelStep[]; started: number; median_days_sent_to_accepted: number | null; self_serve_note: string };

export function buildFunnel(input: MetricInput, range: Range, brand: "paintgroup" | "painthome" | null = null): FunnelData {
  const rows = funnelRows(input, range, brand);
  const count = (k: FunnelStepKey) => rows.filter((r) => k === "started" || (k === "email" ? r.email_captured : k === "saved" ? r.saved : k === "sent" ? r.sent : k === "viewed" ? r.viewed : r.accepted)).length;
  const counts = Object.fromEntries(STEPS.map((k) => [k, count(k)])) as Record<FunnelStepKey, number>;
  const started = counts.started;
  const drops: Record<FunnelStepKey, string> = {
    started: "",
    email: "before leaving an email — nothing to chase",
    saved: "with an email — warm leads in the CRM",
    sent: "saved but never sent",
    viewed: "never opened — chase ladder running",
    accepted: "viewed, not accepted (yet)",
  };
  const steps: FunnelStep[] = STEPS.map((k, i) => {
    const prev = i === 0 ? counts[k] : counts[STEPS[i - 1]];
    const dropped = i === 0 ? 0 : Math.max(0, prev - counts[k]);
    return { key: k, label: STEP_LABEL[k], count: counts[k], pct_of_start: started ? Math.round((counts[k] / started) * 100) : 0, dropped, drop_note: dropped && drops[k] ? `${dropped} ${k === "viewed" ? "never opened" : "dropped"} ${drops[k].replace(/^never opened /, "")}` : "" };
  });
  const days = rows.filter((r) => r.accepted && r.days_sent_to_accepted > 0).map((r) => r.days_sent_to_accepted).sort((a, b) => a - b);
  const median = days.length ? (days.length % 2 ? days[Math.floor(days.length / 2)] : Math.round(((days[days.length / 2 - 1] + days[days.length / 2]) / 2) * 10) / 10) : null;
  return { steps, started, median_days_sent_to_accepted: median, self_serve_note: "Self-serve acceptances (no visit) switch on when the wizard stores the outcome tier on the estimate." };
}

/** The exportable list behind the funnel: one row per wizard session started in the range, with its furthest step. */
export const wizardSessions: MetricDef<FunnelRow> = {
  key: "funnel.wizard_sessions",
  kind: "period",
  section: "funnel",
  title: "Wizard sessions",
  definition: "Wizard sessions started on a day in the range (wizard_drafts.started_at), each with how far it got: email captured, estimate saved, sent, viewed, accepted. The funnel card is these rows counted per step.",
  unit: "count",
  gst: null,
  roles: ["owner", "admin", "sales"],
  aggregate: "count",
  columns: [
    { key: "started_on", label: "Started" }, { key: "furthest", label: "Got to" }, { key: "email_captured", label: "Email" }, { key: "saved", label: "Saved" },
    { key: "sent", label: "Sent" }, { key: "viewed", label: "Viewed" }, { key: "accepted", label: "Accepted" }, { key: "lead_source", label: "Lead source" }, { key: "days_sent_to_accepted", label: "Days sent → accepted" },
  ],
  href: "/estimates",
  select: funnelRows,
  note: (rows) => rows.length ? `${rows.filter((r) => r.accepted).length} accepted · ${rows.filter((r) => r.furthest === "email" || r.furthest === "saved").length} warm, not sent` : "no wizard sessions in this range",
};


// ---- S6 — the gate, by version (addendum A §4.7) ------------------------------

export type GateVersion = "details_first" | "range_first";
export const GATE_VERSION_LABEL: Record<GateVersion, string> = { details_first: "Details first", range_first: "Range first" };

export type GateSessionRow = {
  started_on: string; version: GateVersion; reached_gate: boolean; completed_gate: boolean; saw_range: boolean;
  next: "tighten" | "speak" | "visit" | "message" | "nothing"; lead_source: string;
};

/** One row per session that recorded a gate version, started in the range. */
export function gateSessionRows(input: MetricInput, range: Range): GateSessionRow[] {
  const f = input.funnel; if (!f) return [];
  return f.drafts
    .filter((d) => inRange(d.started_at, range) && (d.gate_version === "details_first" || d.gate_version === "range_first"))
    .map((d) => ({
      started_on: melbourneDay(d.started_at),
      version: d.gate_version as GateVersion,
      reached_gate: Boolean(d.gate_shown_at),
      completed_gate: Boolean(d.gate_completed_at),
      saw_range: Boolean(d.range_shown_at),
      next: (d.range_option as GateSessionRow["next"] | null) ?? "nothing",
      lead_source: d.lead_source ?? "unknown",
    }));
}

export type GateVersionReport = {
  version: GateVersion; label: string; sessions: number; reached_gate: number; completed_gate: number;
  /** Reached the gate and did not complete it, as a share of those who reached it. */
  lost_at_gate_pct: number; saw_range: number;
  next: Record<"tighten" | "speak" | "visit" | "message" | "nothing", number>;
};

/** Reached the gate, completed it, the share lost at the gate, saw the range, and what they did next — per version. */
export function buildGateReport(input: MetricInput, range: Range): GateVersionReport[] {
  const rows = gateSessionRows(input, range);
  return (["details_first", "range_first"] as GateVersion[]).map((version) => {
    const mine = rows.filter((r) => r.version === version);
    const reached = mine.filter((r) => r.reached_gate).length;
    const completed = mine.filter((r) => r.completed_gate).length;
    const next = { tighten: 0, speak: 0, visit: 0, message: 0, nothing: 0 };
    for (const r of mine) next[r.next]++;
    return {
      version, label: GATE_VERSION_LABEL[version], sessions: mine.length, reached_gate: reached, completed_gate: completed,
      lost_at_gate_pct: reached ? Math.round(((reached - completed) / reached) * 100) : 0,
      saw_range: mine.filter((r) => r.saw_range).length, next,
    };
  });
}

/** The exportable list behind the gate report. */
export const gateSessions: MetricDef<GateSessionRow> = {
  key: "funnel.gate_sessions",
  kind: "period",
  section: "funnel",
  title: "The gate, by version",
  definition: "Wizard sessions started in the range that recorded which gate order they saw (details first or range first), each with whether it reached the gate, completed it, saw the range, and what it chose next. Lost at the gate = reached but not completed, as a share of those who reached it.",
  unit: "count",
  gst: null,
  roles: ["owner", "admin", "sales"],
  aggregate: "count",
  columns: [
    { key: "started_on", label: "Started" }, { key: "version", label: "Version" }, { key: "reached_gate", label: "Reached the gate" }, { key: "completed_gate", label: "Completed it" },
    { key: "saw_range", label: "Saw the range" }, { key: "next", label: "Did next" }, { key: "lead_source", label: "Lead source" },
  ],
  href: "/estimates",
  select: gateSessionRows,
  note: (rows) => rows.length ? `${rows.filter((r) => r.version === "details_first").length} details first · ${rows.filter((r) => r.version === "range_first").length} range first` : "no sessions with a gate version yet",
};

/** Paint Home brief §6: does the range hold any Paint Home session? Decides whether the dashboard draws the funnel per shopfront. */
export function hasPaintHomeSessions(input: MetricInput, range: Range): boolean {
  return (input.funnel?.drafts ?? []).some((d) => inRange(d.started_at, range) && brandOfDraft(d) === "painthome");
}


// ---- wizard mobile v5 §8 — the two rates the home dashboard reads ---------------

/** The event types the funnel slice reads for the rates (lib/reporting/load.ts). */
export const WIZARD_RATE_EVENT_TYPES = ["gate_viewed", "gate_cta_clicked", "contact_opened", "visit_booked"] as const;

export type WizardRates = {
  /** Sessions that saw their range. */
  gate_viewed: number;
  /** …of which tapped the exact-price door. */
  gate_exact: number;
  gate_exact_pct: number | null;
  /** Sessions that opened Contact from a step. */
  contact_opened: number;
  /** …of which booked a visit from the Contact sheet. */
  contact_booked: number;
  contact_booked_pct: number | null;
};

/**
 * Gate → exact price and Contact → booked, counted in SESSIONS (the wizard
 * draft the route pinned on each event), never taps — a customer who taps
 * the door twice is one session. An event with no session is not a session
 * and is left out. `brand` keeps one shopfront, by the session's draft;
 * a session whose draft is outside the window keeps its events for the
 * unsplit figure and is left out of a split one (its brand is unknown here).
 */
export function buildWizardRates(input: MetricInput, range: Range, brand: "paintgroup" | "painthome" | null = null): WizardRates {
  const f = input.funnel;
  const brandOf = new Map((f?.drafts ?? []).map((d) => [d.id, brandOfDraft(d)]));
  const sessions = (pick: (e: WizardEventRow) => boolean): number => {
    const ids = new Set<string>();
    for (const e of f?.wizardEvents ?? []) {
      if (!e.session_id || !inRange(e.occurred_at, range) || !pick(e)) continue;
      if (brand != null && brandOf.get(e.session_id) !== brand) continue;
      ids.add(e.session_id);
    }
    return ids.size;
  };
  const pct = (part: number, whole: number): number | null => (whole > 0 ? Math.round((part / whole) * 100) : null);
  const gateViewed = sessions((e) => e.type === "gate_viewed");
  const gateExact = sessions((e) => e.type === "gate_cta_clicked" && e.cta === "exact");
  const contactOpened = sessions((e) => e.type === "contact_opened");
  const contactBooked = sessions((e) => e.type === "visit_booked" && e.from === "contact");
  return {
    gate_viewed: gateViewed, gate_exact: gateExact, gate_exact_pct: pct(gateExact, gateViewed),
    contact_opened: contactOpened, contact_booked: contactBooked, contact_booked_pct: pct(contactBooked, contactOpened),
  };
}


// ---- Estimates tab & funnel, session 2 — step conversion and price bands (master plan §3.3, R7) ----

/**
 * One wizard event as the Funnel view reads it. `session_id` is the wizard
 * draft — `crm_events.wizard_draft_id` from session 1, or `payload.sessionId`
 * on older rows; the loader decides, these functions only count.
 */
export type FunnelEventRow = {
  type: string; session_id: string | null; step: string | null;
  range_low: number | null; range_high: number | null; occurred_at: string;
  /** Session 5: `payload.breakpoint` (mobile / desktop) — the device filter and split. */
  breakpoint?: string | null;
};

/** What the Funnel view reads from the log (session 5 wires the loader). */
export const FUNNEL_EVENT_TYPES = [
  "wizard_step_viewed", "wizard_step_completed", "gate_viewed",
  "gate_cta_clicked", "quote_stage_viewed", "visit_request_made", "visit_booked", "visit_booked_from_wizard",
  "callback_requested", "customer_message_sent", "wizard_help_requested",
] as const;

/** Anything a customer does with their range: the "took an action" side of R7. */
const RANGE_ACTIONS: ReadonlySet<string> = new Set([
  "gate_cta_clicked", "quote_stage_viewed", "visit_request_made", "visit_booked", "visit_booked_from_wizard",
  "callback_requested", "customer_message_sent", "wizard_help_requested",
]);

export type StepConversion = {
  step: string;
  /** Sessions that saw the step. */
  viewed: number;
  /** …of which left it forward. */
  completed: number;
  completed_pct: number | null;
  /** Saw it and never completed it — where they stopped. */
  stopped: number;
  /** Session 5: the median seconds from first seeing the step to completing it, over the sessions that did. */
  median_seconds: number | null;
};

/**
 * Step by step, in SESSIONS: how many saw each step and how many went on.
 * Steps come in `order` when the caller has one (a job type's own list);
 * otherwise by how many sessions saw them, most first, which is the walk's
 * order for every step a session cannot skip.
 */
export function buildStepConversion(rows: readonly FunnelEventRow[], range: Range, order?: readonly string[]): StepConversion[] {
  const viewed = new Map<string, Set<string>>();
  const completed = new Map<string, Set<string>>();
  const firstAt = new Map<string, { seen?: string; done?: string }>();
  for (const r of rows) {
    if (!r.session_id || !r.step || !inRange(r.occurred_at, range)) continue;
    const into = r.type === "wizard_step_viewed" ? viewed : r.type === "wizard_step_completed" ? completed : null;
    if (!into) continue;
    if (!into.has(r.step)) into.set(r.step, new Set());
    into.get(r.step)!.add(r.session_id);
    const k = `${r.step}|${r.session_id}`;
    const t = firstAt.get(k) ?? {};
    if (r.type === "wizard_step_viewed" && (!t.seen || r.occurred_at < t.seen)) t.seen = r.occurred_at;
    if (r.type === "wizard_step_completed" && (!t.done || r.occurred_at < t.done)) t.done = r.occurred_at;
    firstAt.set(k, t);
  }
  const medianSeconds = (step: string, sessions: Iterable<string>): number | null => {
    const secs = [...sessions].map((sid) => firstAt.get(`${step}|${sid}`)).filter((t): t is { seen: string; done: string } => Boolean(t?.seen && t?.done && t.done >= t.seen))
      .map((t) => (Date.parse(t.done) - Date.parse(t.seen)) / 1000).sort((a, b) => a - b);
    if (!secs.length) return null;
    const m = secs.length % 2 ? secs[Math.floor(secs.length / 2)] : (secs[secs.length / 2 - 1] + secs[secs.length / 2]) / 2;
    return Math.round(m);
  };
  const steps = order ? order.filter((s) => viewed.has(s)) : [...viewed.keys()].sort((a, b) => viewed.get(b)!.size - viewed.get(a)!.size || a.localeCompare(b));
  return steps.map((step) => {
    const saw = viewed.get(step)!;
    const wentIds = [...(completed.get(step) ?? [])].filter((s) => saw.has(s));
    const went = wentIds.length;
    return { step, viewed: saw.size, completed: went, completed_pct: saw.size ? Math.round((went / saw.size) * 100) : null, stopped: saw.size - went, median_seconds: medianSeconds(step, wentIds) };
  });
}

/** R7's price bands, in cents inc. GST (⚑3 default; Settings `funnel_price_bands` overrides). The last band is open-ended. */
export const PRICE_BANDS_CENTS = [200_000, 400_000, 600_000, 900_000, 1_200_000, 1_800_000] as const;

export type PriceBandRow = { band: string; low_cents: number; saw_range: number; took_action: number; dropped_pct: number | null };

const bandLabel = (lo: number, hi: number | null): string => {
  const k = (c: number) => `$${c / 100_000}k`;
  return hi == null ? `${k(lo)}+` : lo === 0 ? `Under ${k(hi)}` : `${k(lo)}–${k(hi).slice(1)}`;
};

/**
 * Drop-out by price band (R7): per band, the sessions that saw their range
 * and the ones that then did anything with it. A session is banded by the
 * middle of the FIRST range it saw, so a later tighten does not move it.
 * Under the first band is its own row, never folded into $2–4k.
 */
export function buildPriceBandDropout(rows: readonly FunnelEventRow[], range: Range, bands: readonly number[] = PRICE_BANDS_CENTS): PriceBandRow[] {
  const firstRange = new Map<string, { at: string; mid: number }>();
  const acted = new Map<string, string[]>();
  for (const r of rows) {
    if (!r.session_id) continue;
    if (r.type === "gate_viewed" && r.range_low != null && r.range_high != null && inRange(r.occurred_at, range)) {
      const seen = firstRange.get(r.session_id);
      if (!seen || r.occurred_at < seen.at) firstRange.set(r.session_id, { at: r.occurred_at, mid: Math.round((r.range_low + r.range_high) / 2) });
    } else if (RANGE_ACTIONS.has(r.type)) {
      acted.set(r.session_id, [...(acted.get(r.session_id) ?? []), r.occurred_at]);
    }
  }
  const edges = [0, ...bands];
  const out: PriceBandRow[] = edges.map((lo, i) => ({ band: bandLabel(lo, edges[i + 1] ?? null), low_cents: lo, saw_range: 0, took_action: 0, dropped_pct: null }));
  for (const [session, seen] of firstRange) {
    let i = edges.length - 1;
    while (i > 0 && seen.mid < edges[i]) i--;
    out[i].saw_range++;
    if ((acted.get(session) ?? []).some((at) => at >= seen.at)) out[i].took_action++;
  }
  for (const b of out) b.dropped_pct = b.saw_range ? Math.round(((b.saw_range - b.took_action) / b.saw_range) * 100) : null;
  return out;
}

// ---- Estimates tab session 5 — the Funnel view (brief §4.5) ----------------------

/**
 * The Funnel view's filters. Each narrows the SESSIONS (wizard drafts started
 * in the range); every chart then counts only those sessions' events. The
 * home card is the same module with no filter — so the two cannot disagree.
 */
export type FunnelFilter = {
  brand: "paintgroup" | "painthome" | null;
  /** `payload.breakpoint` of the session's first event: mobile or desktop. */
  device: "mobile" | "desktop" | null;
  jobType: string | null;
  leadSource: string | null;
};
export const NO_FUNNEL_FILTER: FunnelFilter = { brand: null, device: null, jobType: null, leadSource: null };

/** Settings `funnel_price_bands` → band edges in cents: ascending, positive, whole dollars. Anything else is the default. */
export function priceBandsFromSettings(value: unknown): number[] {
  const raw = value && typeof value === "object" && !Array.isArray(value) ? (value as { bands_cents?: unknown }).bands_cents : value;
  if (!Array.isArray(raw) || raw.length === 0 || raw.length > 12) return [...PRICE_BANDS_CENTS];
  const xs = raw.map(Number);
  const ok = xs.every((x, i) => Number.isInteger(x) && x > 0 && x % 100 === 0 && (i === 0 || x > xs[i - 1]));
  return ok ? xs : [...PRICE_BANDS_CENTS];
}

/** The Settings box: "2000, 4000, 6000" (dollars) → cents, or a reason it cannot be saved. */
export function parsePriceBandsText(text: string): { ok: true; cents: number[] } | { ok: false; message: string } {
  const parts = text.split(/[,\s]+/).map((p) => p.replace(/[$k]/gi, (m) => (m.toLowerCase() === "k" ? "000" : ""))).filter(Boolean);
  if (parts.length === 0) return { ok: false, message: "Type at least one dollar amount." };
  if (parts.length > 12) return { ok: false, message: "Twelve bands at most." };
  const dollars = parts.map(Number);
  if (dollars.some((d) => !Number.isInteger(d) || d <= 0)) return { ok: false, message: "Whole dollar amounts above zero, please." };
  if (dollars.some((d, i) => i > 0 && d <= dollars[i - 1])) return { ok: false, message: "Each amount must be bigger than the one before." };
  return { ok: true, cents: dollars.map((d) => d * 100) };
}

/** The sessions a filter keeps: started in the range, matching every filter that is set. */
export function funnelSessions(input: MetricInput, range: Range, f: FunnelFilter = NO_FUNNEL_FILTER): Set<string> {
  const slice = input.funnel; if (!slice) return new Set();
  const deviceOf = new Map<string, string>();
  if (f.device) {
    for (const e of [...(slice.funnelEvents ?? [])].sort((a, b) => a.occurred_at.localeCompare(b.occurred_at))) {
      if (e.session_id && e.breakpoint && !deviceOf.has(e.session_id)) deviceOf.set(e.session_id, e.breakpoint);
    }
  }
  const est = new Map(slice.estimates.map((e) => [e.id, e]));
  return new Set(slice.drafts.filter((d) => {
    if (!inRange(d.started_at, range)) return false;
    if (f.brand && brandOfDraft(d) !== f.brand) return false;
    if (f.jobType && (d.job_type ?? "") !== f.jobType) return false;
    if (f.leadSource && ((d.estimate_id ? est.get(d.estimate_id)?.lead_source : null) ?? d.lead_source ?? "unknown") !== f.leadSource) return false;
    if (f.device && deviceOf.get(d.id) !== f.device) return false;
    return true;
  }).map((d) => d.id));
}

export type CameBackRow = { group: "came_back" | "did_not"; sessions: number; gave_details: number; saw_range: number; asked: number; accepted: number };

/**
 * Chart 3, Came back (R13): sessions that returned (visits > 1) against those
 * that did not, and what each went on to do. By channel and by automation
 * is not recorded yet — the return link's `via` comes with the automations
 * brief — and the view says so rather than guessing.
 */
export function buildCameBack(input: MetricInput, range: Range, f: FunnelFilter = NO_FUNNEL_FILTER): CameBackRow[] {
  const slice = input.funnel; if (!slice) return [];
  const keep = funnelSessions(input, range, f);
  const est = new Map(slice.estimates.map((e) => [e.id, e]));
  const asked = new Set((slice.funnelEvents ?? []).filter((e) => e.session_id && ASKED.has(e.type)).map((e) => e.session_id!));
  const rows: Record<CameBackRow["group"], CameBackRow> = {
    came_back: { group: "came_back", sessions: 0, gave_details: 0, saw_range: 0, asked: 0, accepted: 0 },
    did_not: { group: "did_not", sessions: 0, gave_details: 0, saw_range: 0, asked: 0, accepted: 0 },
  };
  for (const d of slice.drafts) {
    if (!keep.has(d.id)) continue;
    const r = rows[(d.visits ?? 1) > 1 ? "came_back" : "did_not"];
    r.sessions++;
    if (d.email) r.gave_details++;
    if (d.range_shown_at) r.saw_range++;
    if (asked.has(d.id)) r.asked++;
    if (d.estimate_id && est.get(d.estimate_id)?.status === "accepted") r.accepted++;
  }
  return [rows.came_back, rows.did_not];
}
const ASKED: ReadonlySet<string> = new Set(["visit_request_made", "visit_booked", "visit_booked_from_wizard", "callback_requested"]);

export type FunnelView = {
  tiles: { started: number; gave_details: number; accepted: number };
  steps: Array<StepConversion & { worst: boolean; mobile: StepConversion | null; desktop: StepConversion | null }>;
  bands: Array<PriceBandRow & { worst: boolean }>;
  cameBack: CameBackRow[];
};

/** Everything the Funnel view draws, from one input — the tiles are `buildFunnel`'s own steps, so they match the home card. */
export function buildFunnelView(input: MetricInput, range: Range, f: FunnelFilter = NO_FUNNEL_FILTER): FunnelView {
  const keep = funnelSessions(input, range, f);
  const events = (input.funnel?.funnelEvents ?? []).filter((e) => e.session_id && keep.has(e.session_id));
  const devOf = new Map<string, string>();
  for (const e of [...events].sort((a, b) => a.occurred_at.localeCompare(b.occurred_at))) if (e.breakpoint && !devOf.has(e.session_id!)) devOf.set(e.session_id!, e.breakpoint);
  const steps = buildStepConversion(events, range);
  const byDevice = (d: string) => new Map(buildStepConversion(events.filter((e) => devOf.get(e.session_id!) === d), range).map((s) => [s.step, s]));
  const mobile = byDevice("mobile"); const desktop = byDevice("desktop");
  const worstSteps = new Set([...steps].filter((s) => s.completed_pct != null && s.stopped > 0).sort((a, b) => (a.completed_pct! - b.completed_pct!) || (b.stopped - a.stopped)).slice(0, 3).map((s) => s.step));
  const bands = buildPriceBandDropout(events, range, input.funnel?.priceBands ?? PRICE_BANDS_CENTS);
  const worstBand = [...bands].filter((b) => b.dropped_pct != null).sort((a, b) => (b.dropped_pct! - a.dropped_pct!) || (b.saw_range - a.saw_range))[0]?.band ?? null;
  // The tiles are buildFunnel's steps over the same sessions (brand is its own filter; the rest narrow its rows).
  const fr = funnelRows(input, range, f.brand);
  const drafts = (input.funnel?.drafts ?? []).filter((d) => inRange(d.started_at, range) && (f.brand == null || brandOfDraft(d) === f.brand));
  const kept = drafts.map((d, i) => ({ d, r: fr[i] })).filter(({ d }) => keep.has(d.id)).map(({ r }) => r);
  return {
    tiles: { started: kept.length, gave_details: kept.filter((r) => r.email_captured).length, accepted: kept.filter((r) => r.accepted).length },
    steps: steps.map((s) => ({ ...s, worst: worstSteps.has(s.step), mobile: mobile.get(s.step) ?? null, desktop: desktop.get(s.step) ?? null })),
    bands: bands.map((b) => ({ ...b, worst: b.band === worstBand })),
    cameBack: buildCameBack(input, range, f),
  };
}

const funnelFilterOf = (input: MetricInput) => input.funnelFilter ?? NO_FUNNEL_FILTER;
const FUNNEL_ROLES = ["owner", "admin", "sales"] as const;

export const funnelStepConversion: MetricDef<StepConversion> = {
  key: "funnel.step_conversion",
  kind: "period",
  section: "funnel",
  title: "Where they stop",
  definition: "Per wizard step, in sessions started in the range: how many saw it (wizard_step_viewed), how many completed it (wizard_step_completed), the share that went on, the median seconds it took, and how many stopped there.",
  unit: "count",
  gst: null,
  roles: FUNNEL_ROLES,
  aggregate: { sum: "viewed" },
  columns: [{ key: "step", label: "Step" }, { key: "viewed", label: "Saw it" }, { key: "completed", label: "Completed" }, { key: "completed_pct", label: "% on" }, { key: "median_seconds", label: "Median seconds" }, { key: "stopped", label: "Stopped here" }],
  href: "/estimates?view=funnel",
  select: (input, range) => buildFunnelView(input, range, funnelFilterOf(input)).steps.map(({ step, viewed, completed, completed_pct, stopped, median_seconds }) => ({ step, viewed, completed, completed_pct, stopped, median_seconds })),
};

export const funnelPriceBands: MetricDef<PriceBandRow> = {
  key: "funnel.price_bands",
  kind: "period",
  section: "funnel",
  title: "Drop-out by price band",
  definition: "Wizard sessions started in the range, banded by the middle of the first range they saw (gate_viewed, inc. GST; bands from Settings), and how many then did anything with it (a gate button, the quote stage, a visit or call request, a message, a help request).",
  unit: "count",
  gst: "inc",
  roles: FUNNEL_ROLES,
  aggregate: { sum: "saw_range" },
  columns: [{ key: "band", label: "Band" }, { key: "saw_range", label: "Saw a range" }, { key: "took_action", label: "Took an action" }, { key: "dropped_pct", label: "% dropped" }],
  href: "/estimates?view=funnel",
  select: (input, range) => buildFunnelView(input, range, funnelFilterOf(input)).bands.map(({ band, low_cents, saw_range, took_action, dropped_pct }) => ({ band, low_cents, saw_range, took_action, dropped_pct })),
};

export const funnelCameBack: MetricDef<CameBackRow> = {
  key: "funnel.came_back",
  kind: "period",
  section: "funnel",
  title: "Came back",
  definition: "Wizard sessions started in the range that came back after leaving (wizard_drafts.visits above 1) against those that did not, with how many gave details, saw a range, asked for a visit or call, and accepted.",
  unit: "count",
  gst: null,
  roles: FUNNEL_ROLES,
  aggregate: { sum: "sessions" },
  columns: [{ key: "group", label: "Group" }, { key: "sessions", label: "Sessions" }, { key: "gave_details", label: "Gave details" }, { key: "saw_range", label: "Saw a range" }, { key: "asked", label: "Asked for a visit or call" }, { key: "accepted", label: "Accepted" }],
  href: "/estimates?view=funnel",
  select: (input, range) => buildCameBack(input, range, funnelFilterOf(input)),
};
