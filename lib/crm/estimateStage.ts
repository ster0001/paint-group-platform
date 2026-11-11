/**
 * Which stage ONE estimate (or one wizard session that has no estimate yet)
 * is in — Estimates tab & funnel, session 2 (brief §3.3, ruling E-G).
 *
 * The master plan's §2 tables, as one pure function. Stage is derived from
 * the facts every time it is read and never stored; temperature and snooze
 * are separate staff-set axes and are not inputs here.
 *
 * This is the ESTIMATE grain. `lib/crm/stage.ts` (`stageFor`) is the ACCOUNT
 * grain — the CRM board's lane for a customer across all their estimates and
 * jobs — and stays as it is. The two share words where the meaning is the
 * same ("Online now", "Needs help", "Estimate sent", "Visit booked"), and the
 * labels below say which account lane each stage sits under (`accountLane`),
 * so a card and its customer's lane can never disagree on what a word means.
 *
 * Precedence: the further the job has travelled, the earlier it is tested —
 * won, then closed, then the estimate in play, then the visit or call, then
 * the wizard. An old range seen and a live estimate reads as the estimate.
 *
 * Event names are the catalogue's (`lib/crm/events.ts`, ruling E-A), mapped
 * from the brief's dotted names:
 *   wizard.session_started  → a wizard_drafts row        wizard.gate_submitted → wizard_gate_submitted
 *   wizard.range_shown      → gate_viewed                wizard.tighten_*      → quote_stage_viewed / quote_stage_done
 *   wizard.help_requested   → wizard_help_requested, wizard_question_asked, customer_message_sent
 *   visit.requested         → visit_request_made {kind visit|time}   call.requested → visit_request_made {kind call}, callback_requested
 *   call.completed          → call_connected (after a call request)  estimate.expired → estimate_lapsed / valid_until passed
 *   estimate.question       → a customer chat message after the send, not yet answered by staff
 */

export const ESTIMATE_STAGES = [
  // Part A — before we have their details
  { key: "online_now", label: "Online now", part: "A", accountLane: "online_now" },
  { key: "dropped_anon", label: "Dropped out", part: "A", accountLane: "wizard_dropped" },
  // Part B — we have their details
  { key: "details_captured", label: "Details captured", part: "B", accountLane: "online_now" },
  { key: "range_no_action", label: "Range seen, no action", part: "B", accountLane: "wizard_priced" },
  { key: "needs_help", label: "Needs help", part: "B", accountLane: "wizard_help" },
  { key: "tightening", label: "Tightening", part: "B", accountLane: "wizard_priced" },
  { key: "tightened_no_action", label: "Tightened, no action", part: "B", accountLane: "wizard_priced" },
  { key: "visit_requested", label: "Visit requested", part: "B", accountLane: "wizard_ready" },
  { key: "visit_booked", label: "Visit booked", part: "B", accountLane: "visit_booked" },
  { key: "call_requested", label: "Call requested", part: "B", accountLane: "wizard_ready" },
  // Part C — estimate in play
  { key: "visit_done", label: "Visit / call done", part: "C", accountLane: "visit_done_no_reply" },
  { key: "estimate_sent", label: "Estimate sent", part: "C", accountLane: "estimate_sent" },
  { key: "estimate_viewed", label: "Estimate viewed", part: "C", accountLane: "estimate_sent" },
  { key: "question_asked", label: "Question asked", part: "C", accountLane: "negotiating" },
  { key: "revised", label: "Revised", part: "C", accountLane: "negotiating" },
  { key: "declined", label: "Declined", part: "C", accountLane: "lost" },
  { key: "expired", label: "Expired", part: "C", accountLane: "lapsed" },
  // Part D — won
  { key: "accepted", label: "Accepted", part: "D", accountLane: "job_on" },
  { key: "booked", label: "Booked", part: "D", accountLane: "job_on" },
  { key: "in_progress", label: "In progress", part: "D", accountLane: "job_on" },
  { key: "signed_off", label: "Signed off", part: "D", accountLane: "job_on" },
  { key: "paid", label: "Paid", part: "D", accountLane: "past_customer" },
  // Part E — lost / cold
  { key: "cold", label: "Cold", part: "E", accountLane: "lost" },
] as const;

export type EstimateStage = (typeof ESTIMATE_STAGES)[number]["key"];
/**
 * Estimates tab session 4 (brief §4.2): the Pipeline's lanes, B2 → C5 in
 * stage order. Before B2 there is nothing to chase (Online now has those);
 * after C5 the estimate is decided.
 */
export const PIPELINE_STAGES = ["range_no_action", "needs_help", "tightening", "tightened_no_action", "visit_requested", "visit_booked",
  "call_requested", "visit_done", "estimate_sent", "estimate_viewed", "question_asked", "revised"] as const satisfies readonly EstimateStage[];
export type PipelineStage = (typeof PIPELINE_STAGES)[number];
export const ESTIMATE_STAGE_LABEL = Object.fromEntries(ESTIMATE_STAGES.map((s) => [s.key, s.label])) as Record<EstimateStage, string>;

/** The stages a won job is in. `cold` never applies to them. */
const WON: ReadonlySet<EstimateStage> = new Set(["accepted", "booked", "in_progress", "signed_off", "paid"]);

export type EstimateStageSettings = {
  /** A2/A3: no details yet, this long without activity → Dropped out. Settings key `crm.idle_minutes_anon`. */
  idleMinutesAnon: number;
  /** B2: range seen, this long without activity → idle (the "prime retarget" moment). Settings key `crm.idle_minutes_lead`. */
  idleMinutesLead: number;
  /** E4: this long with no activity and not won → Cold. */
  coldDays: number;
};
export const DEFAULT_ESTIMATE_STAGE_SETTINGS: EstimateStageSettings = { idleMinutesAnon: 45, idleMinutesLead: 30, coldDays: 90 };

export type EstimateStageEvent = { type: string; occurred_at: string; payload?: Record<string, unknown> | null };

export type EstimateStageFacts = {
  /** The wizard session (`wizard_drafts`), when the estimate came through the wizard or there is no estimate yet. */
  draft: { started_at: string; last_seen_at: string | null; gate_completed_at: string | null; range_shown_at: string | null } | null;
  estimate: {
    status: string; created_at: string; sent_at: string | null; valid_until: string | null;
    accepted_at: string | null; declined_at: string | null;
  } | null;
  /** The job the estimate became: offer accepted, started, signed off, the final invoice paid. */
  job: { offerAcceptedAt: string | null; startedAt: string | null; signedOffAt: string | null; finalPaidAt: string | null } | null;
  /** `crm_events` for this estimate and its wizard session. */
  events: readonly EstimateStageEvent[];
  /** The estimate's chat (`estimate_messages`): who wrote, when. */
  chat: readonly { from: "customer" | "staff"; at: string }[];
};

export type EstimateStageResult = {
  stage: EstimateStage;
  /** When it entered this stage — the card's "days in stage". */
  since: string;
  /** Plain words for the card's second line. */
  because: string;
  /** No activity for longer than the stage's idle threshold (A2/A3 and B2 only). */
  idle: boolean;
};

/**
 * Events a member of staff writes ABOUT the customer — a note, a temperature,
 * a snooze, a tag. They are not the customer or the job moving, so they never
 * count as activity: snoozing a cold estimate does not warm it up.
 */
const STAFF_AXIS = new Set([
  "note_added", "followup_set", "temperature_set", "snoozed", "state_set", "permission_set", "tags_set",
  "owner_set", "details_updated", "contact_changed", "work_item_dismissed", "source_overridden", "account_merged",
]);
/** A staff member answered the customer: clears Needs help (B3). */
const STAFF_ANSWER = new Set(["message_out", "call_connected", "visit_request_answered"]);
const HELP = new Set(["wizard_help_requested", "wizard_question_asked", "customer_message_sent"]);

const ms = (iso: string | null | undefined): number => (iso ? Date.parse(iso) : Number.NaN);
const later = (a: string | null | undefined, b: string | null | undefined): boolean => !Number.isNaN(ms(a)) && (Number.isNaN(ms(b)) || ms(a) > ms(b));
const max = (...xs: Array<string | null | undefined>): string | null =>
  xs.filter((x): x is string => typeof x === "string" && !Number.isNaN(ms(x))).sort((p, q) => ms(q) - ms(p))[0] ?? null;

const MELBOURNE_DAY = new Intl.DateTimeFormat("en-CA", { timeZone: "Australia/Melbourne", year: "numeric", month: "2-digit", day: "2-digit" });

/**
 * The stage, and why. Null only when there is nothing at all to read — no
 * estimate and no wizard session.
 */
export function estimateStageFor(
  facts: EstimateStageFacts, now: Date = new Date(), settings: EstimateStageSettings = DEFAULT_ESTIMATE_STAGE_SETTINGS,
): EstimateStageResult | null {
  if (!facts.estimate && !facts.draft) return null;
  const r = stageInner(facts, now, settings);
  if (WON.has(r.stage)) return r;
  const lastActive = lastActivity(facts);
  if (lastActive && now.getTime() - ms(lastActive) >= settings.coldDays * 86_400_000) {
    return { stage: "cold", since: new Date(ms(lastActive) + settings.coldDays * 86_400_000).toISOString(), because: `Nothing for ${settings.coldDays}+ days · was ${ESTIMATE_STAGE_LABEL[r.stage]}`, idle: true };
  }
  return r;
}

/** The newest moment the customer or the job moved: every event except the staff axis, the chat, the draft's heartbeat. */
export function lastActivity(facts: EstimateStageFacts): string | null {
  return max(
    ...facts.events.filter((e) => !STAFF_AXIS.has(e.type)).map((e) => e.occurred_at),
    ...facts.chat.map((c) => c.at),
    facts.draft?.last_seen_at, facts.draft?.started_at,
    facts.estimate?.created_at, facts.estimate?.sent_at, facts.estimate?.accepted_at, facts.estimate?.declined_at,
  );
}

function stageInner(facts: EstimateStageFacts, now: Date, settings: EstimateStageSettings): EstimateStageResult {
  const ev = facts.events;
  const lastOf = (...types: string[]): string | null => max(...ev.filter((e) => types.includes(e.type)).map((e) => e.occurred_at));
  const firstAfter = (after: string | null, ...types: string[]): string | null =>
    ev.filter((e) => types.includes(e.type) && later(e.occurred_at, after)).map((e) => e.occurred_at).sort((a, b) => ms(a) - ms(b))[0] ?? null;
  const est = facts.estimate;
  const job = facts.job;
  const done = (stage: EstimateStage, since: string, because: string, idle = false): EstimateStageResult => ({ stage, since, because, idle });

  // ---- Part D — won ---------------------------------------------------------
  if (job?.finalPaidAt) return done("paid", job.finalPaidAt, "Final invoice paid");
  const signedOff = max(job?.signedOffAt, lastOf("job_completed"));
  if (signedOff) return done("signed_off", signedOff, "Job signed off");
  const started = max(job?.startedAt, lastOf("job_started"));
  if (started) return done("in_progress", started, "Job on site");
  if (job?.offerAcceptedAt) return done("booked", job.offerAcceptedAt, "Painter booked");
  const acceptedAt = max(est?.accepted_at, lastOf("estimate_accepted"));
  if (est?.status === "accepted" || acceptedAt) return done("accepted", acceptedAt ?? est?.sent_at ?? now.toISOString(), "Accepted");

  // ---- Part C — closed --------------------------------------------------------
  const declinedAt = max(est?.declined_at, lastOf("estimate_declined"));
  if (est?.status === "declined" || declinedAt) return done("declined", declinedAt ?? now.toISOString(), "Declined");
  const lapsedAt = lastOf("estimate_lapsed");
  const pastValid = est?.valid_until != null && est.status !== "draft" && est.valid_until < MELBOURNE_DAY.format(now);
  if (est?.status === "expired" || lapsedAt || pastValid) {
    return done("expired", lapsedAt ?? (est?.valid_until ? `${est.valid_until}T00:00:00+00:00` : now.toISOString()), `Expired${est?.valid_until ? ` ${est.valid_until}` : ""}`);
  }

  // ---- Part C — the estimate in play --------------------------------------------
  const sentAt = max(est?.sent_at, lastOf("estimate_sent"));
  if (sentAt) {
    const lastStaff = max(...facts.chat.filter((c) => c.from === "staff").map((c) => c.at));
    const openQuestion = facts.chat.filter((c) => c.from === "customer" && later(c.at, sentAt) && later(c.at, lastStaff))
      .map((c) => c.at).sort((a, b) => ms(a) - ms(b))[0] ?? null;
    if (openQuestion) return done("question_asked", openQuestion, "Asked a question, not answered yet");
    const revisedAt = lastOf("estimate_revised");
    // A re-send restarts the viewed clock (golden rule): only views after the newest send count.
    const clock = max(sentAt, revisedAt);
    const viewAfter = firstAfter(clock, "estimate_viewed");
    const views = ev.filter((e) => e.type === "estimate_viewed" && later(e.occurred_at, clock)).length;
    if (viewAfter) return done("estimate_viewed", viewAfter, `Opened ${views}×${revisedAt ? " since the revision" : ""}`);
    if (revisedAt && later(revisedAt, sentAt)) return done("revised", revisedAt, "Revised estimate sent, not opened yet");
    return done("estimate_sent", sentAt, "Sent, not opened yet");
  }

  // ---- Part B / C1 — the visit or the call -----------------------------------------
  const callAsked = max(
    ...ev.filter((e) => (e.type === "visit_request_made" && e.payload?.kind === "call") || e.type === "callback_requested").map((e) => e.occurred_at),
  );
  const visitAsked = max(...ev.filter((e) => e.type === "visit_request_made" && e.payload?.kind !== "call").map((e) => e.occurred_at));
  const visitDone = lastOf("visit_completed");
  const callDone = callAsked ? firstAfter(callAsked, "call_connected") : null;
  if (visitDone || callDone) {
    const at = max(visitDone, callDone)!;
    return done("visit_done", at, visitDone === at ? "Visit done, estimate not sent yet" : "Call done, estimate not sent yet");
  }
  const booked = lastOf("visit_booked", "visit_booked_from_wizard");
  const unbooked = lastOf("visit_cancelled", "visit_no_show");
  if (booked && later(booked, unbooked)) return done("visit_booked", booked, "Visit booked");
  const answered = lastOf("visit_request_answered");
  const visitOpen = visitAsked && later(visitAsked, answered) ? visitAsked : null;
  const callOpen = callAsked;
  if (visitOpen || callOpen) {
    return later(callOpen, visitOpen)
      ? done("call_requested", callOpen!, "Asked us to call")
      : done("visit_requested", visitOpen!, "Asked for a visit");
  }

  // ---- Part B — needs help ------------------------------------------------------------
  const help = lastOf(...HELP);
  const staffAnswer = max(lastOf(...STAFF_ANSWER), ...facts.chat.filter((c) => c.from === "staff").map((c) => c.at));
  if (help && later(help, staffAnswer)) {
    const firstOpen = ev.filter((e) => HELP.has(e.type) && later(e.occurred_at, staffAnswer)).map((e) => e.occurred_at).sort((a, b) => ms(a) - ms(b))[0] ?? help;
    return done("needs_help", firstOpen, "Asked for help, not answered yet");
  }

  // ---- Part B — the range and the tighten -----------------------------------------------
  const lastActive = lastActivity(facts);
  const idleFor = lastActive ? now.getTime() - ms(lastActive) : Number.POSITIVE_INFINITY;
  const tightenDone = lastOf("quote_stage_done");
  if (tightenDone) return done("tightened_no_action", tightenDone, "Tightened their range, no request yet");
  const tightenStarted = lastOf("quote_stage_viewed");
  if (tightenStarted) return done("tightening", tightenStarted, "Tightening their range");
  const rangeAt = max(firstAfter(null, "gate_viewed"), facts.draft?.range_shown_at);
  if (rangeAt) {
    const idle = idleFor >= settings.idleMinutesLead * 60_000;
    return done("range_no_action", rangeAt, idle ? "Saw their range and left" : "Looking at their range", idle);
  }
  const gateAt = max(firstAfter(null, "wizard_gate_submitted"), facts.draft?.gate_completed_at);
  if (gateAt) return done("details_captured", gateAt, "Gave their details");
  // An estimate the office started, with no wizard session: we have their details, it is not sent yet.
  if (est && !facts.draft) return done("details_captured", est.created_at, "Estimate being written");

  // ---- Part A — anonymous -------------------------------------------------------------------
  const startedAt = facts.draft?.started_at ?? now.toISOString();
  if (lastActive && idleFor >= settings.idleMinutesAnon * 60_000) {
    const step = [...ev].filter((e) => e.type === "wizard_step_viewed").sort((a, b) => ms(b.occurred_at) - ms(a.occurred_at))[0]?.payload?.step;
    return done("dropped_anon", new Date(ms(lastActive) + settings.idleMinutesAnon * 60_000).toISOString(), typeof step === "string" ? `Left at ${step}` : "Left before giving details", true);
  }
  return done("online_now", startedAt, "In the wizard now");
}
