import { describe, expect, it } from "vitest";
import { ESTIMATE_STAGES, estimateStageFor, lastActivity, type EstimateStageEvent, type EstimateStageFacts } from "./estimateStage";
import { LANES } from "./stage";

/**
 * Golden tests — one per row of the master plan's §2 stage tables
 * (docs/briefs/customer-funnel-map-and-automation-plan.md), plus the brief's
 * four (§3.3): a return after idle, a staff reply clearing Needs help, a
 * revision resetting the viewed clock, and snooze never changing the stage.
 */
const NOW = new Date("2026-11-11T02:00:00Z"); // 1pm Melbourne
const ago = (minutes: number) => new Date(NOW.getTime() - minutes * 60_000).toISOString();
const daysAgo = (d: number) => ago(d * 24 * 60);
const ev = (type: string, at: string, payload?: Record<string, unknown>): EstimateStageEvent => ({ type, occurred_at: at, payload });

const wizard = (over: Partial<NonNullable<EstimateStageFacts["draft"]>> = {}): EstimateStageFacts["draft"] =>
  ({ started_at: ago(20), last_seen_at: ago(1), gate_completed_at: null, range_shown_at: null, ...over });
const estimate = (over: Partial<NonNullable<EstimateStageFacts["estimate"]>> = {}): EstimateStageFacts["estimate"] =>
  ({ status: "draft", created_at: over.sent_at ?? daysAgo(6), sent_at: null, valid_until: null, accepted_at: null, declined_at: null, ...over });
const facts = (over: Partial<EstimateStageFacts>): EstimateStageFacts =>
  ({ draft: null, estimate: null, job: null, events: [], chat: [], ...over });
const stage = (f: EstimateStageFacts) => estimateStageFor(f, NOW)?.stage;

describe("estimate stage — Part A, before we have their details", () => {
  it("A2 · started, active in the last 45 minutes → Online now", () => {
    expect(stage(facts({ draft: wizard() }))).toBe("online_now");
  });
  it("A2 · idle 45 minutes with no details → Dropped out, since the moment they went idle", () => {
    const r = estimateStageFor(facts({ draft: wizard({ started_at: ago(70), last_seen_at: ago(50) }) }), NOW)!;
    expect(r.stage).toBe("dropped_anon");
    expect(r.since).toBe(ago(5));
    expect(r.idle).toBe(true);
  });
  it("A3 · scoping, idle on a step → Dropped out, and the step is named", () => {
    const r = estimateStageFor(facts({
      draft: wizard({ started_at: ago(90), last_seen_at: ago(60) }),
      events: [ev("wizard_step_viewed", ago(80), { step: "beds" }), ev("wizard_step_completed", ago(75), { step: "beds" }), ev("wizard_step_viewed", ago(61), { step: "storeys" })],
    }), NOW)!;
    expect(r.stage).toBe("dropped_anon");
    expect(r.because).toBe("Left at storeys");
  });
  it("A3 · scoping and still active → Online now", () => {
    expect(stage(facts({ draft: wizard(), events: [ev("wizard_step_completed", ago(2), { step: "beds" })] }))).toBe("online_now");
  });
});

describe("estimate stage — Part B, we have their details", () => {
  it("B1 · details in, no range yet → Details captured", () => {
    expect(stage(facts({ draft: wizard(), events: [ev("wizard_gate_submitted", ago(3))] }))).toBe("details_captured");
  });
  it("B1 · the draft's own stamp counts as well as the event", () => {
    expect(stage(facts({ draft: wizard({ gate_completed_at: ago(3) }) }))).toBe("details_captured");
  });
  it("B2 · range seen, still looking → Range seen, no action, not idle", () => {
    const r = estimateStageFor(facts({ draft: wizard(), events: [ev("wizard_gate_submitted", ago(5)), ev("gate_viewed", ago(4))] }), NOW)!;
    expect(r.stage).toBe("range_no_action");
    expect(r.idle).toBe(false);
  });
  it("B2 · range seen and 30 minutes idle → still Range seen, no action, now idle (the prime retarget)", () => {
    const r = estimateStageFor(facts({ draft: wizard({ started_at: ago(60), last_seen_at: ago(40) }), events: [ev("gate_viewed", ago(41))] }), NOW)!;
    expect(r.stage).toBe("range_no_action");
    expect(r.idle).toBe(true);
    expect(r.because).toBe("Saw their range and left");
  });
  it("B3 · asked for help → Needs help", () => {
    expect(stage(facts({ draft: wizard(), events: [ev("gate_viewed", ago(10)), ev("wizard_help_requested", ago(5))] }))).toBe("needs_help");
  });
  it("B3 · a message sent from the wizard is a help request too", () => {
    expect(stage(facts({ draft: wizard(), events: [ev("customer_message_sent", ago(5), { where: "website_chat" })] }))).toBe("needs_help");
  });
  it("B4 · tighten started → Tightening", () => {
    expect(stage(facts({ draft: wizard(), events: [ev("gate_viewed", ago(10)), ev("quote_stage_viewed", ago(5))] }))).toBe("tightening");
  });
  it("B5 · tighten completed, no request → Tightened, no action", () => {
    expect(stage(facts({ draft: wizard(), events: [ev("quote_stage_viewed", ago(10)), ev("quote_stage_done", ago(5))] }))).toBe("tightened_no_action");
  });
  it("B6 · asked for a visit → Visit requested", () => {
    expect(stage(facts({ draft: wizard(), events: [ev("gate_viewed", ago(10)), ev("visit_request_made", ago(5), { kind: "visit" })] }))).toBe("visit_requested");
  });
  it("B7 · visit booked → Visit booked", () => {
    expect(stage(facts({ draft: wizard(), events: [ev("visit_request_made", ago(50), { kind: "visit" }), ev("visit_booked", ago(40))] }))).toBe("visit_booked");
  });
  it("B7 · a cancelled booking is no longer booked", () => {
    expect(stage(facts({ draft: wizard(), events: [ev("visit_booked", ago(50)), ev("visit_cancelled", ago(40))] }))).not.toBe("visit_booked");
  });
  it("B8 · asked us to call → Call requested", () => {
    expect(stage(facts({ draft: wizard(), events: [ev("gate_viewed", ago(10)), ev("visit_request_made", ago(5), { kind: "call" })] }))).toBe("call_requested");
  });
});

describe("estimate stage — Part C, estimate in play", () => {
  it("C1 · visit done, nothing sent → Visit / call done", () => {
    expect(stage(facts({ draft: wizard(), estimate: estimate(), events: [ev("visit_booked", daysAgo(3)), ev("visit_completed", daysAgo(2))] }))).toBe("visit_done");
  });
  it("C1 · the call we were asked for, made → Visit / call done", () => {
    expect(stage(facts({ draft: wizard(), events: [ev("visit_request_made", ago(120), { kind: "call" }), ev("call_connected", ago(60))] }))).toBe("visit_done");
  });
  it("C2 · sent, never opened → Estimate sent", () => {
    expect(stage(facts({ estimate: estimate({ status: "sent", sent_at: daysAgo(2) }) }))).toBe("estimate_sent");
  });
  it("C3 · opened → Estimate viewed, counting the opens", () => {
    const r = estimateStageFor(facts({ estimate: estimate({ status: "sent", sent_at: daysAgo(2) }), events: [ev("estimate_viewed", daysAgo(1)), ev("estimate_viewed", ago(60))] }), NOW)!;
    expect(r.stage).toBe("estimate_viewed");
    expect(r.because).toBe("Opened 2×");
    expect(r.since).toBe(daysAgo(1));
  });
  it("C4 · a customer question after the send, unanswered → Question asked", () => {
    expect(stage(facts({ estimate: estimate({ status: "sent", sent_at: daysAgo(2) }), events: [ev("estimate_viewed", daysAgo(1))], chat: [{ from: "customer", at: ago(90) }] }))).toBe("question_asked");
  });
  it("C5 · revised, not opened since → Revised", () => {
    expect(stage(facts({ estimate: estimate({ status: "sent", sent_at: daysAgo(5) }), events: [ev("estimate_viewed", daysAgo(4)), ev("estimate_revised", daysAgo(1), { revision: 1, totalCents: 1 })] }))).toBe("revised");
  });
  it("C6 · declined → Declined", () => {
    expect(stage(facts({ estimate: estimate({ status: "declined", sent_at: daysAgo(9), declined_at: daysAgo(2) }) }))).toBe("declined");
  });
  it("C7 · past its valid-until date → Expired, with or without the sweep's event", () => {
    expect(stage(facts({ estimate: estimate({ status: "sent", sent_at: daysAgo(70), valid_until: "2026-11-01" }) }))).toBe("expired");
    expect(stage(facts({ estimate: estimate({ status: "expired", sent_at: daysAgo(70) }), events: [ev("estimate_lapsed", daysAgo(9))] }))).toBe("expired");
  });
  it("C7 · valid until today is not expired yet (Melbourne's day, not UTC's)", () => {
    expect(stage(facts({ estimate: estimate({ status: "sent", sent_at: daysAgo(60), valid_until: "2026-11-11" }) }))).toBe("estimate_sent");
  });
});

describe("estimate stage — Part D, won", () => {
  const won = estimate({ status: "accepted", sent_at: daysAgo(20), accepted_at: daysAgo(10) });
  it("D1 · accepted → Accepted", () => {
    expect(stage(facts({ estimate: won }))).toBe("accepted");
  });
  it("D2 · the painter accepted the offer → Booked", () => {
    expect(stage(facts({ estimate: won, job: { offerAcceptedAt: daysAgo(8), startedAt: null, signedOffAt: null, finalPaidAt: null } }))).toBe("booked");
  });
  it("D3 · started → In progress", () => {
    expect(stage(facts({ estimate: won, job: { offerAcceptedAt: daysAgo(8), startedAt: daysAgo(2), signedOffAt: null, finalPaidAt: null } }))).toBe("in_progress");
  });
  it("D4 · signed off → Signed off", () => {
    expect(stage(facts({ estimate: won, events: [ev("job_started", daysAgo(5)), ev("job_completed", daysAgo(1))] }))).toBe("signed_off");
  });
  it("D5 · final invoice paid → Paid", () => {
    expect(stage(facts({ estimate: won, job: { offerAcceptedAt: daysAgo(8), startedAt: daysAgo(6), signedOffAt: daysAgo(2), finalPaidAt: daysAgo(1) } }))).toBe("paid");
  });
  it("a won job never goes cold, however long it has been", () => {
    expect(stage(facts({ estimate: estimate({ status: "accepted", sent_at: daysAgo(400), accepted_at: daysAgo(390) }) }))).toBe("accepted");
  });
});

describe("estimate stage — Part E, lost / cold", () => {
  it("E4 · 90 days with nothing → Cold, and it says what it was", () => {
    const r = estimateStageFor(facts({ estimate: estimate({ status: "sent", sent_at: daysAgo(95) }) }), NOW)!;
    expect(r.stage).toBe("cold");
    expect(r.because).toContain("was Estimate sent");
  });
  it("E4 · a declined estimate turns cold after 90 quiet days too", () => {
    expect(stage(facts({ estimate: estimate({ status: "declined", sent_at: daysAgo(120), declined_at: daysAgo(100) }) }))).toBe("cold");
  });
});

describe("estimate stage — the brief's four rules (§3.3)", () => {
  it("returning after idle moves Dropped out back to the step's stage", () => {
    const dropped = facts({ draft: wizard({ started_at: daysAgo(1), last_seen_at: daysAgo(1) }), events: [ev("wizard_step_viewed", daysAgo(1), { step: "beds" })] });
    expect(stage(dropped)).toBe("dropped_anon");
    const back = { ...dropped, draft: wizard({ started_at: daysAgo(1), last_seen_at: ago(1) }), events: [...dropped.events, ev("wizard_session_resumed", ago(2), { visit: 2 })] };
    expect(stage(back)).toBe("online_now");
  });
  it("a staff reply clears Needs help", () => {
    const asked = facts({ draft: wizard(), events: [ev("gate_viewed", ago(30)), ev("wizard_help_requested", ago(20))] });
    expect(stage(asked)).toBe("needs_help");
    expect(stage({ ...asked, events: [...asked.events, ev("message_out", ago(10), { channel: "sms", messageId: "x" })] })).toBe("range_no_action");
    expect(stage({ ...asked, chat: [{ from: "staff", at: ago(10) }] })).toBe("range_no_action");
  });
  it("a revision resets the viewed clock: only opens after it count", () => {
    const f = facts({ estimate: estimate({ status: "sent", sent_at: daysAgo(5) }), events: [ev("estimate_viewed", daysAgo(4)), ev("estimate_viewed", daysAgo(3)), ev("estimate_revised", daysAgo(2), { revision: 1, totalCents: 1 })] });
    expect(stage(f)).toBe("revised");
    const r = estimateStageFor({ ...f, events: [...f.events, ev("estimate_viewed", daysAgo(1))] }, NOW)!;
    expect(r.stage).toBe("estimate_viewed");
    expect(r.since).toBe(daysAgo(1));
    expect(r.because).toBe("Opened 1× since the revision");
  });
  it("snooze (and any other staff-axis event) never changes the stage, and never counts as activity", () => {
    const quiet = facts({ estimate: estimate({ status: "sent", sent_at: daysAgo(95) }) });
    const snoozed = { ...quiet, events: [ev("snoozed", ago(5)), ev("temperature_set", ago(4)), ev("note_added", ago(3))] };
    expect(stage(snoozed)).toBe(stage(quiet));
    expect(lastActivity(snoozed)).toBe(lastActivity(quiet));
    const live = facts({ estimate: estimate({ status: "sent", sent_at: daysAgo(2) }) });
    expect(stage({ ...live, events: [ev("snoozed", ago(5))] })).toBe("estimate_sent");
  });
});

describe("estimate stage — the vocabulary", () => {
  it("every stage sits under a real account lane, so a card and its customer's lane share the word", () => {
    const lanes = new Set<string>(LANES.map((l) => l.key));
    for (const s of ESTIMATE_STAGES) expect(lanes.has(s.accountLane), `${s.key} → ${s.accountLane}`).toBe(true);
  });
  it("nothing to read is no stage", () => {
    expect(estimateStageFor(facts({}), NOW)).toBeNull();
  });
  it("an estimate the office started, with no wizard session, is a lead with details", () => {
    expect(stage(facts({ estimate: estimate() }))).toBe("details_captured");
  });
});
