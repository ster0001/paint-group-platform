import { describe, expect, it } from "vitest";
import {
  DEFAULT_POLICY, dryRun, guardSend, sendKey,
  type CustomerState, type MessageState, type SendCandidate, type SendPolicy,
} from "./guard";

// A Tuesday, 10am Melbourne — inside every default window.
const NOW = new Date("2026-09-01T00:00:00Z");
const HOUR = 10;
const DAY = 2;
const daysAgo = (n: number) => new Date(NOW.getTime() - n * 86_400_000).toISOString();

const candidate = (over: Partial<SendCandidate> = {}): SendCandidate => ({
  sendKey: "spring:acc-1:step1", accountId: "acc-1", campaignKey: "spring",
  channel: "email", enrolledAt: daysAgo(2), ...over,
});
const customer = (over: Partial<CustomerState> = {}): CustomerState => ({
  unsubscribed: false, stillInSegment: true, hasOpenWork: false, acceptedSince: null,
  snoozedUntil: null, lastMarketingAt: null, undeliverable: false, ...over,
});
const message = (over: Partial<MessageState> = {}): MessageState => ({
  templateApproved: true, humanApproved: true, alreadySent: false, ...over,
});
const policy = (over: Partial<SendPolicy> = {}): SendPolicy => ({ ...DEFAULT_POLICY, ...over });

const verdict = (c = customer(), m = message(), p = policy()) =>
  guardSend(candidate(), c, m, p, NOW, HOUR, DAY);

describe("the guard chain", () => {
  it("lets a clean, approved message through", () => {
    expect(verdict()).toEqual({ send: true });
  });

  it("stops a customer who accepted between enrolment and send", () => {
    // The brief's own acceptance gate, and the reason the chain runs at send
    // time rather than at enrolment.
    const v = verdict(customer({ acceptedSince: daysAgo(1) }));
    expect(v).toEqual({ send: false, reason: "They accepted a quote after this was queued.", hold: false });
  });

  it("ignores an acceptance from BEFORE they were enrolled", () => {
    // Otherwise every past customer is permanently unmailable.
    expect(verdict(customer({ acceptedSince: daysAgo(30) }))).toEqual({ send: true });
  });

  it("stops anyone with work on", () => {
    expect(verdict(customer({ hasOpenWork: true })).send).toBe(false);
  });

  it("puts consent first, even when several reasons apply", () => {
    // The reason reaches a human, and the one with legal weight is the one
    // they should read.
    const v = verdict(customer({ unsubscribed: true, hasOpenWork: true, stillInSegment: false }));
    expect(v).toMatchObject({ send: false, reason: "They unsubscribed.", hold: false });
  });

  it("never treats consent or a bounce as something to retry", () => {
    for (const c of [customer({ unsubscribed: true }), customer({ undeliverable: true })]) {
      const v = guardSend(candidate(), c, message(), policy(), NOW, HOUR, DAY);
      expect(v).toMatchObject({ send: false, hold: false });
    }
  });

  it("re-asks the segment at send time", () => {
    expect(verdict(customer({ stillInSegment: false })).send).toBe(false);
  });

  it("respects a staff snooze, and comes back after it", () => {
    expect(verdict(customer({ snoozedUntil: daysAgo(-3) }))).toMatchObject({ send: false, hold: true });
    expect(verdict(customer({ snoozedUntil: daysAgo(3) }))).toEqual({ send: true });
  });

  it("holds inside the frequency window and says how long is left", () => {
    const v = verdict(customer({ lastMarketingAt: daysAgo(3) }), message(), policy({ frequencyWindowDays: 14 }));
    expect(v).toMatchObject({ send: false, hold: true });
    if (!v.send) expect(v.reason).toMatch(/3 days ago — 11 to go/);
    expect(verdict(customer({ lastMarketingAt: daysAgo(15) }), message(), policy({ frequencyWindowDays: 14 })))
      .toEqual({ send: true });
  });

  it("is one message a month by default — Tom's C10 ruling", () => {
    expect(DEFAULT_POLICY.frequencyWindowDays).toBe(30);
    expect(verdict(customer({ lastMarketingAt: daysAgo(20) }))).toMatchObject({ send: false, hold: true });
    expect(verdict(customer({ lastMarketingAt: daysAgo(31) }))).toEqual({ send: true });
  });

  it("sends on weekdays between 9 and 6 — Tom's C11 ruling", () => {
    expect(DEFAULT_POLICY.permittedDays).toEqual([1, 2, 3, 4, 5]);
    expect(DEFAULT_POLICY.quietHoursStart).toBe(9);
    expect(DEFAULT_POLICY.quietHoursEnd).toBe(18);
    expect(guardSend(candidate(), customer(), message(), policy(), NOW, 18, DAY)).toMatchObject({ hold: true });
    expect(guardSend(candidate(), customer(), message(), policy(), NOW, 12, 6)).toMatchObject({ hold: true });
  });

  it("holds outside sending hours and off sending days", () => {
    expect(guardSend(candidate(), customer(), message(), policy(), NOW, 7, DAY)).toMatchObject({ hold: true });
    expect(guardSend(candidate(), customer(), message(), policy(), NOW, 21, DAY)).toMatchObject({ hold: true });
    expect(guardSend(candidate(), customer(), message(), policy(), NOW, HOUR, 0)).toMatchObject({ send: false, hold: true });
    expect(guardSend(candidate(), customer(), message(), policy(), NOW, 9, DAY)).toEqual({ send: true });
    expect(guardSend(candidate(), customer(), message(), policy(), NOW, 17, DAY)).toEqual({ send: true });
  });

  it("will not send a template nobody has read", () => {
    expect(verdict(customer(), message({ templateApproved: false }))).toMatchObject({ send: false, hold: true });
  });

  it("needs a human unless auto-send is deliberately on — and it ships off", () => {
    expect(DEFAULT_POLICY.autoSend).toBe(false);
    expect(verdict(customer(), message({ humanApproved: false }))).toMatchObject({ send: false, reason: "Waiting for approval." });
    expect(verdict(customer(), message({ humanApproved: false }), policy({ autoSend: true }))).toEqual({ send: true });
  });

  it("stops a repeat run before it can send twice", () => {
    expect(verdict(customer(), message({ alreadySent: true }))).toMatchObject({ send: false, hold: false });
  });
});

describe("sendKey", () => {
  it("is the same key for the same message, forever", () => {
    // A key with a date in it lets the same message go again tomorrow, which
    // is the duplicate the idempotency gate exists to stop.
    expect(sendKey("Spring", "ACC-1", 1)).toBe("spring:acc-1:step1");
    expect(sendKey("spring", "acc-1", 1)).toBe(sendKey("Spring", "ACC-1", 1));
    expect(sendKey("spring", "acc-1", 2)).not.toBe(sendKey("spring", "acc-1", 1));
  });
});

describe("dryRun", () => {
  it("splits what would go, what waits and what is off", () => {
    const rows = [
      { candidate: candidate({ sendKey: "a" }), customer: customer(), message: message() },
      { candidate: candidate({ sendKey: "b" }), customer: customer({ lastMarketingAt: daysAgo(2) }), message: message() },
      { candidate: candidate({ sendKey: "c" }), customer: customer({ unsubscribed: true }), message: message() },
      { candidate: candidate({ sendKey: "d" }), customer: customer({ acceptedSince: daysAgo(1) }), message: message() },
    ];
    const r = dryRun(rows, policy(), NOW, HOUR, DAY);
    expect(r.going.map((c) => c.sendKey)).toEqual(["a"]);
    expect(r.held.map((h) => h.candidate.sendKey)).toEqual(["b"]);
    expect(r.stopped.map((s) => s.candidate.sendKey).sort()).toEqual(["c", "d"]);
  });

  it("sends nothing at all when auto-send is off and nothing is approved", () => {
    const rows = [1, 2, 3].map((n) => ({
      candidate: candidate({ sendKey: `k${n}` }),
      customer: customer(),
      message: message({ humanApproved: false }),
    }));
    expect(dryRun(rows, policy(), NOW, HOUR, DAY).going).toHaveLength(0);
  });
});
