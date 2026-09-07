import { describe, expect, it } from "vitest";
import { normaliseSteps, planSweep, stepDueAt, type CampaignDefinition, type ExistingEnrolment } from "./sweep";

const NOW = new Date("2026-09-01T00:00:00Z");
const daysAgo = (n: number) => new Date(NOW.getTime() - n * 86_400_000).toISOString();

const campaign = (over: Partial<CampaignDefinition> = {}): CampaignDefinition => ({
  key: "chase", name: "Quote follow-up", class: "followup", entry: "event", segmentKey: null,
  triggerEvent: "estimate_sent", exitRules: [], status: "live", autoSend: false,
  steps: [
    { step: 1, templateId: "tpl-sms", afterDays: 3, channel: "sms", condition: "unopened" },
    { step: 2, templateId: "tpl-email", afterDays: 7, channel: "email", condition: "opened_silent" },
  ],
  ...over,
});

const enrolment = (over: Partial<ExistingEnrolment> = {}): ExistingEnrolment => ({
  accountId: "a1", anchorKey: "est-1", anchorAt: daysAgo(8), lastStep: 1, finished: false, ...over,
});

describe("planSweep — waits count from the anchor", () => {
  it("enrols on the event and queues nothing until the first step is due", () => {
    const plan = planSweep(campaign(), [{ accountId: "a1", anchorAt: daysAgo(1), anchorKey: "est-1" }], [], NOW);
    expect(plan.enrol).toHaveLength(1);
    expect(plan.queue).toHaveLength(0);
    expect(plan.skipped[0].reason).toMatch(/isn't due yet/);
  });

  it("three days after the estimate was sent, the SMS is due — carrying its condition", () => {
    const plan = planSweep(campaign(), [{ accountId: "a1", anchorAt: daysAgo(3.1), anchorKey: "est-1" }], [], NOW);
    expect(plan.queue).toHaveLength(1);
    expect(plan.queue[0]).toMatchObject({ step: 1, channel: "sms", condition: "unopened", sendKey: "chase:a1:est-1:step1" });
    expect(new Date(plan.queue[0].dueAt).getTime()).toBe(new Date(daysAgo(3.1)).getTime() + 3 * 86_400_000);
  });

  it("step 2 is due seven days after the ANCHOR, not seven days after step 1", () => {
    // Enrolled 8 days ago, step 1 already queued: step 2 (afterDays 7) is due now.
    const plan = planSweep(campaign(), [{ accountId: "a1", anchorAt: daysAgo(8), anchorKey: "est-1" }], [enrolment()], NOW);
    expect(plan.queue.map((q) => q.step)).toEqual([2]);
    // Enrolled 5 days ago: step 2 waits two more days, however often the sweep runs.
    const early = planSweep(campaign(), [{ accountId: "a1", anchorAt: daysAgo(5), anchorKey: "est-1" }], [enrolment({ anchorAt: daysAgo(5) })], NOW);
    expect(early.queue).toHaveLength(0);
  });

  it("running twice changes nothing the second time", () => {
    const cands = [{ accountId: "a1", anchorAt: daysAgo(4), anchorKey: "est-1" }];
    const first = planSweep(campaign(), cands, [], NOW);
    expect(first.queue).toHaveLength(1);
    const second = planSweep(campaign(), cands, [enrolment({ anchorAt: daysAgo(4), lastStep: 1 })], NOW);
    expect(second.queue).toHaveLength(0);
  });

  it("a new quote is a new anchor — the same customer goes through again", () => {
    const done = enrolment({ anchorKey: "est-1", lastStep: 2, finished: true });
    const plan = planSweep(campaign(), [{ accountId: "a1", anchorAt: daysAgo(4), anchorKey: "est-2" }], [done], NOW);
    expect(plan.enrol).toHaveLength(1);
    expect(plan.queue[0].sendKey).toBe("chase:a1:est-2:step1");
  });

  it("an audience campaign anchors on enrolment and says who fell off the list", () => {
    const aud = campaign({ key: "spring", entry: "audience", class: "marketing", segmentKey: "past_customers", triggerEvent: null,
      steps: [{ step: 1, templateId: "t", afterDays: 0, channel: "email", condition: "none" }] });
    const plan = planSweep(aud, [{ accountId: "a1", anchorAt: NOW.toISOString(), anchorKey: "" }],
      [enrolment({ accountId: "gone", anchorKey: "", lastStep: 0 })], NOW);
    expect(plan.queue[0].sendKey).toBe("spring:a1:step1");
    expect(plan.skipped).toContainEqual({ accountId: "gone", reason: "No longer on the list." });
  });

  it("a paused campaign does nothing at all", () => {
    const plan = planSweep(campaign({ status: "paused" }), [{ accountId: "a1", anchorAt: daysAgo(9), anchorKey: "e" }], [], NOW);
    expect(plan.enrol).toHaveLength(0);
    expect(plan.queue).toHaveLength(0);
  });

  it("a step with nothing written queues nothing, and says so", () => {
    const plan = planSweep(campaign({ steps: [{ step: 1, templateId: null, afterDays: 0, channel: "sms", condition: "none" }] }),
      [{ accountId: "a1", anchorAt: daysAgo(1), anchorKey: "e" }], [], NOW);
    expect(plan.queue).toHaveLength(0);
    expect(plan.skipped[0].reason).toMatch(/no text written/);
  });

  it("the same candidate twice in one run is one enrolment", () => {
    const c = { accountId: "a1", anchorAt: daysAgo(1), anchorKey: "e" };
    expect(planSweep(campaign(), [c, c], [], NOW).enrol).toHaveLength(1);
  });
});

describe("normaliseSteps", () => {
  it("reads P5 rows as they are, and converts pre-P5 waits-from-previous into afterDays", () => {
    expect(normaliseSteps([
      { step: 1, templateId: "a", waitDays: 0, channel: "email" },
      { step: 2, templateId: "b", waitDays: 7, channel: "email" },
      { step: 3, templateId: "c", waitDays: 7, channel: "sms" },
    ]).map((s) => [s.step, s.afterDays, s.condition])).toEqual([[1, 0, "none"], [2, 7, "none"], [3, 14, "none"]]);
    expect(normaliseSteps([{ step: 1, templateId: "a", afterDays: 3, afterHours: 2, channel: "sms", condition: "unopened" }])[0])
      .toEqual({ step: 1, templateId: "a", afterDays: 3, afterHours: 2, channel: "sms", condition: "unopened" });
    expect(normaliseSteps("junk")).toEqual([]);
  });

  it("stepDueAt adds days and hours to the anchor", () => {
    expect(stepDueAt("2026-09-01T00:00:00Z", { afterDays: 1, afterHours: 6 }).toISOString()).toBe("2026-09-02T06:00:00.000Z");
  });
});
