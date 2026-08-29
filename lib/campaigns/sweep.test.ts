import { describe, expect, it } from "vitest";
import { planSweep, type CampaignDefinition, type ExistingEnrolment } from "./sweep";

const NOW = new Date("2026-09-01T00:00:00Z");
const daysAgo = (n: number) => new Date(NOW.getTime() - n * 86_400_000).toISOString();

const campaign = (over: Partial<CampaignDefinition> = {}): CampaignDefinition => ({
  key: "spring", name: "Spring exteriors", segmentKey: "interior_no_exterior",
  status: "live",
  steps: [
    { step: 1, templateId: "tpl-1", waitDays: 0, channel: "email" },
    { step: 2, templateId: "tpl-2", waitDays: 7, channel: "email" },
  ],
  ...over,
});

const enrolment = (over: Partial<ExistingEnrolment> = {}): ExistingEnrolment => ({
  accountId: "a1", campaignKey: "spring", lastStep: 1, lastQueuedAt: daysAgo(8), finished: false, ...over,
});

describe("planSweep", () => {
  it("enrols the list and queues step one", () => {
    const plan = planSweep(campaign(), ["a1", "a2"], [], NOW);
    expect(plan.enrol.map((e) => e.accountId)).toEqual(["a1", "a2"]);
    expect(plan.queue.map((q) => q.sendKey)).toEqual(["spring:a1:step1", "spring:a2:step1"]);
  });

  it("running twice changes nothing the second time", () => {
    // The whole requirement: the same send key comes back, and the caller's
    // unique index turns the second write into a no-op.
    const first = planSweep(campaign(), ["a1"], [], NOW);
    const after: ExistingEnrolment[] = [enrolment({ lastStep: 1, lastQueuedAt: NOW.toISOString() })];
    const second = planSweep(campaign(), ["a1"], after, NOW);
    expect(first.queue).toHaveLength(1);
    expect(second.queue).toHaveLength(0);
    expect(second.skipped[0].reason).toMatch(/isn't due yet/);
  });

  it("waits the step's own days, measured from the last message not the sweep", () => {
    // A sweep that runs hourly must not send step 2 an hour after step 1.
    const tooSoon = planSweep(campaign(), ["a1"], [enrolment({ lastQueuedAt: daysAgo(3) })], NOW);
    expect(tooSoon.queue).toHaveLength(0);

    const due = planSweep(campaign(), ["a1"], [enrolment({ lastQueuedAt: daysAgo(8) })], NOW);
    expect(due.queue.map((q) => q.sendKey)).toEqual(["spring:a1:step2"]);
  });

  it("stops at the last step instead of looping", () => {
    const plan = planSweep(campaign(), ["a1"], [enrolment({ lastStep: 2, lastQueuedAt: daysAgo(30) })], NOW);
    expect(plan.queue).toHaveLength(0);
    expect(plan.skipped[0].reason).toBe("Finished every step.");
  });

  it("leaves someone who has already been through it alone", () => {
    const plan = planSweep(campaign(), ["a1"], [enrolment({ finished: true })], NOW);
    expect(plan.enrol).toHaveLength(0);
    expect(plan.queue).toHaveLength(0);
  });

  it("queues nothing for a draft or paused campaign, and says why", () => {
    for (const status of ["draft", "paused"] as const) {
      const plan = planSweep(campaign({ status }), ["a1", "a2"], [], NOW);
      expect(plan.queue).toHaveLength(0);
      expect(plan.enrol).toHaveLength(0);
      expect(plan.skipped).toHaveLength(2);
      expect(plan.skipped[0].reason).toContain(status);
    }
  });

  it("will not queue a step whose email has not been written", () => {
    const plan = planSweep(
      campaign({ steps: [{ step: 1, templateId: null, waitDays: 0, channel: "email" }] }),
      ["a1"], [], NOW,
    );
    expect(plan.queue).toHaveLength(0);
    expect(plan.skipped[0].reason).toMatch(/no email written/);
    // Still enrolled: they belong on the list, there is just nothing to send.
    expect(plan.enrol).toHaveLength(1);
  });

  it("notices when someone has dropped off the list", () => {
    const plan = planSweep(campaign(), [], [enrolment()], NOW);
    expect(plan.skipped).toEqual([{ accountId: "a1", reason: "No longer on the list." }]);
  });

  it("does not enrol the same person twice when the list repeats them", () => {
    const plan = planSweep(campaign(), ["a1", "a1", "a1"], [], NOW);
    expect(plan.enrol).toHaveLength(1);
    expect(plan.queue).toHaveLength(1);
  });
});
