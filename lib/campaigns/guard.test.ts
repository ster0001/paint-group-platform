import { describe, expect, it } from "vitest";
import {
  DEFAULT_POLICY, dryRun, effectiveExits, guardSend, judge, sendKey,
  type CampaignRules, type CustomerState, type MessageState, type SendCandidate,
} from "./guard";

// A Tuesday, 10am Melbourne.
const NOW = new Date("2026-09-08T00:00:00Z");
const HOUR = 10, DAY = 2;
const daysAgo = (n: number) => new Date(NOW.getTime() - n * 86_400_000).toISOString();

const candidate = (over: Partial<SendCandidate> = {}): SendCandidate => ({
  sendKey: "k", accountId: "a1", campaignKey: "spring", channel: "email",
  enrolledAt: daysAgo(3), anchorAt: daysAgo(3), step: 1, condition: "none", ...over,
});
const customer = (over: Partial<CustomerState> = {}): CustomerState => ({
  permit: "unknown", unsubscribed: false, undeliverable: false, reachable: true,
  relationshipState: "active", stateHolding: false, stillInAudience: true, hasOpenWork: false,
  lastAcceptedAt: null, lastDeclinedAt: null, lastOpenedAt: null, lastInboundAt: null, lastInboundCallAt: null,
  lastStaffContactAt: null, snoozedUntil: null, lastMarketingAt: null, ...over,
});
const message = (over: Partial<MessageState> = {}): MessageState => ({ templateApproved: true, humanApproved: true, alreadySent: false, ...over });
const marketing: CampaignRules = { class: "marketing", entry: "audience", exitRules: [] };
const followup: CampaignRules = { class: "followup", entry: "event", exitRules: [] };

const go = (c = candidate(), cu = customer(), m = message(), r = marketing, policy = DEFAULT_POLICY) =>
  guardSend(c, cu, m, r, policy, NOW, HOUR, DAY);

describe("the guard chain", () => {
  it("lets a clean, approved message through", () => {
    expect(go()).toEqual({ send: true });
  });

  it("consent per channel comes first, and ends the enrolment — never a hold", () => {
    expect(go(candidate({ channel: "sms" }), customer({ permit: "declined", lastAcceptedAt: daysAgo(1) })))
      .toMatchObject({ send: false, reason: "They said no to texts.", hold: false, exit: true });
    // Declined on texts says nothing about email.
    expect(go(candidate({ channel: "email" }), customer({ permit: "declined" }))).toMatchObject({ exit: true });
    expect(go(candidate({ channel: "email" }), customer({ permit: "allowed" }))).toEqual({ send: true });
  });

  it("the old unsubscribe flag still stops marketing, but not a follow-up about their own quote", () => {
    expect(go(candidate(), customer({ unsubscribed: true }), message(), marketing)).toMatchObject({ reason: "They unsubscribed.", exit: true });
    expect(go(candidate(), customer({ unsubscribed: true }), message(), followup)).toEqual({ send: true });
  });

  it("do-not-contact and archived silence everything; a follow-up has nothing to say to delayed or lost", () => {
    expect(go(candidate(), customer({ relationshipState: "do_not_contact" }), message(), followup)).toMatchObject({ exit: true });
    expect(go(candidate(), customer({ relationshipState: "archived" }), message(), marketing)).toMatchObject({ exit: true });
    expect(go(candidate(), customer({ relationshipState: "lost" }), message(), followup)).toMatchObject({ reason: "Marked lost.", exit: true });
    expect(go(candidate(), customer({ relationshipState: "delayed", stateHolding: true }), message(), followup)).toMatchObject({ exit: true });
    // Marketing waits out a delay and may still speak to someone marked lost.
    expect(go(candidate(), customer({ relationshipState: "delayed", stateHolding: true }), message(), marketing)).toMatchObject({ hold: true });
    expect(go(candidate(), customer({ relationshipState: "lost" }), message(), marketing)).toEqual({ send: true });
  });

  it("a bouncing address ends an email sequence; no number on file skips a text step only", () => {
    expect(go(candidate(), customer({ undeliverable: true }))).toMatchObject({ exit: true });
    expect(go(candidate({ channel: "sms" }), customer({ undeliverable: true }))).toEqual({ send: true });
    expect(go(candidate({ channel: "sms" }), customer({ reachable: false }))).toMatchObject({ skip: true, reason: "No mobile number on file." });
  });

  it("exit rules are measured from the anchor — an old acceptance is history, a new one ends it", () => {
    const withExits: CampaignRules = { ...marketing, exitRules: ["replied", "called", "staff_took_over"] };
    expect(go(candidate(), customer({ lastAcceptedAt: daysAgo(30) }), message(), withExits)).toEqual({ send: true });
    expect(go(candidate(), customer({ lastAcceptedAt: daysAgo(1) }), message(), withExits)).toMatchObject({ reason: "They accepted a quote.", exit: true });
    expect(go(candidate(), customer({ lastInboundAt: daysAgo(1) }), message(), withExits)).toMatchObject({ reason: "They replied.", exit: true });
    expect(go(candidate(), customer({ lastInboundCallAt: daysAgo(1) }), message(), withExits)).toMatchObject({ reason: "They rang us.", exit: true });
    expect(go(candidate(), customer({ lastStaffContactAt: daysAgo(1) }), message(), withExits)).toMatchObject({ reason: "Someone here has taken it over.", exit: true });
    // Not switched on: a reply does not end a plain marketing campaign.
    expect(go(candidate(), customer({ lastInboundAt: daysAgo(1) }), message(), marketing)).toEqual({ send: true });
  });

  it("a follow-up always stops when they answer — replied, accepted or declined — whatever the campaign says", () => {
    expect([...effectiveExits(followup)].sort()).toEqual(["accepted", "declined", "do_not_contact", "replied"]);
    expect(go(candidate(), customer({ lastInboundAt: daysAgo(1) }), message(), followup)).toMatchObject({ reason: "They replied.", exit: true });
    expect(go(candidate(), customer({ lastDeclinedAt: daysAgo(1) }), message(), followup)).toMatchObject({ reason: "They declined the quote.", exit: true });
  });

  it("marketing never runs alongside a job", () => {
    expect(go(candidate(), customer({ hasOpenWork: true }))).toMatchObject({ reason: "They have work on with us.", exit: true });
    expect(go(candidate(), customer({ hasOpenWork: true }), message(), followup)).toEqual({ send: true });
  });

  it("re-asks the list at send time for an audience campaign; an event campaign has no list to re-ask", () => {
    expect(go(candidate(), customer({ stillInAudience: false }), message(), marketing)).toMatchObject({ reason: "They no longer match the list.", exit: true });
    expect(go(candidate(), customer({ stillInAudience: false }), message(), followup)).toEqual({ send: true });
  });

  it("step conditions skip the step, not the sequence", () => {
    expect(go(candidate({ condition: "unopened" }), customer({ lastOpenedAt: daysAgo(1) }), message(), followup))
      .toMatchObject({ skip: true, reason: "They opened it — this step isn't needed." });
    expect(go(candidate({ condition: "unopened" }), customer({ lastOpenedAt: daysAgo(10) }), message(), followup)).toEqual({ send: true });
    expect(go(candidate({ condition: "opened_silent" }), customer(), message(), followup)).toMatchObject({ skip: true });
    expect(go(candidate({ condition: "opened_silent" }), customer({ lastOpenedAt: daysAgo(1) }), message(), followup)).toEqual({ send: true });
    expect(go(candidate({ condition: "not_replied" }), customer({ lastInboundAt: daysAgo(1) }), message(), marketing)).toMatchObject({ skip: true });
    expect(go(candidate({ condition: "not_accepted" }), customer({ lastAcceptedAt: daysAgo(1) }), message(), { ...marketing, exitRules: [] })).toMatchObject({ exit: true });
  });

  it("respects a staff snooze, and comes back after it", () => {
    expect(go(candidate(), customer({ snoozedUntil: new Date(NOW.getTime() + 86_400_000).toISOString() }))).toMatchObject({ hold: true, reason: "Someone snoozed them." });
    expect(go(candidate(), customer({ snoozedUntil: daysAgo(1) }))).toEqual({ send: true });
  });

  it("is one marketing message a month (C10) — and a follow-up is not a marketing touch", () => {
    expect(go(candidate(), customer({ lastMarketingAt: daysAgo(10) }))).toMatchObject({ hold: true, reason: "Messaged them 10 days ago — 20 to go." });
    expect(go(candidate(), customer({ lastMarketingAt: daysAgo(31) }))).toEqual({ send: true });
    expect(go(candidate(), customer({ lastMarketingAt: daysAgo(10) }), message(), followup)).toEqual({ send: true });
  });

  it("sends on weekdays between 9 and 6 (C11), holds otherwise", () => {
    expect(guardSend(candidate(), customer(), message(), marketing, DEFAULT_POLICY, NOW, 8, 2)).toMatchObject({ hold: true, reason: "Outside sending hours." });
    expect(guardSend(candidate(), customer(), message(), marketing, DEFAULT_POLICY, NOW, 18, 2)).toMatchObject({ hold: true });
    expect(guardSend(candidate(), customer(), message(), marketing, DEFAULT_POLICY, NOW, 10, 0)).toMatchObject({ hold: true, reason: "Not a sending day." });
    expect(guardSend(candidate(), customer(), message(), marketing, DEFAULT_POLICY, NOW, 17, 5)).toEqual({ send: true });
  });

  it("will not send a template nobody has read, and needs a human unless auto-send is deliberately on", () => {
    expect(go(candidate(), customer(), message({ templateApproved: false }))).toMatchObject({ hold: true, reason: "Nobody has read the template yet." });
    expect(go(candidate(), customer(), message({ humanApproved: false }))).toMatchObject({ hold: true, reason: "Waiting for approval." });
    expect(go(candidate(), customer(), message({ humanApproved: false }), marketing, { ...DEFAULT_POLICY, autoSend: true })).toEqual({ send: true });
    expect(DEFAULT_POLICY.autoSend).toBe(false);
  });

  it("stops a repeat run before it can send twice", () => {
    expect(go(candidate(), customer(), message({ alreadySent: true }))).toMatchObject({ send: false, hold: false, reason: "Already sent — this is a repeat run." });
  });

  it("puts consent before everything else when several reasons apply", () => {
    const v = go(candidate(), customer({ permit: "declined", hasOpenWork: true, lastAcceptedAt: daysAgo(1), snoozedUntil: daysAgo(-1) }));
    expect(v).toMatchObject({ reason: "They said no to emails." });
  });
});

describe("judge — the sweep's half", () => {
  it("answers WANTED without touching timing or approval", () => {
    expect(judge(candidate(), customer(), marketing)).toEqual({ send: true });
    expect(judge(candidate(), customer({ snoozedUntil: daysAgo(-1), lastMarketingAt: daysAgo(1) }), marketing)).toEqual({ send: true });
    expect(judge(candidate(), customer({ permit: "declined" }), marketing)).toMatchObject({ exit: true });
  });
});

describe("sendKey", () => {
  it("is the same key for the same message, forever — and a new anchor is a new key", () => {
    expect(sendKey("Spring", "A1", 2)).toBe("spring:a1:step2");
    expect(sendKey("spring", "a1", 2)).toBe(sendKey("spring", "a1", 2));
    expect(sendKey("spring", "a1", 1, "est-9")).toBe("spring:a1:est-9:step1");
    expect(sendKey("spring", "a1", 1, "est-9")).not.toBe(sendKey("spring", "a1", 1, "est-10"));
  });
});

describe("dryRun", () => {
  it("splits what would go, what waits and what is off", () => {
    const rows = [
      { candidate: candidate({ accountId: "goes" }), customer: customer(), message: message() },
      { candidate: candidate({ accountId: "waits" }), customer: customer({ lastMarketingAt: daysAgo(2) }), message: message() },
      { candidate: candidate({ accountId: "off" }), customer: customer({ permit: "declined" }), message: message() },
    ];
    const r = dryRun(rows, marketing, DEFAULT_POLICY, NOW, HOUR, DAY);
    expect(r.going.map((c) => c.accountId)).toEqual(["goes"]);
    expect(r.held.map((h) => h.candidate.accountId)).toEqual(["waits"]);
    expect(r.stopped.map((s) => s.candidate.accountId)).toEqual(["off"]);
  });
});
