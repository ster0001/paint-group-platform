/**
 * The sweep (session 3.1): who joins a campaign, and what gets queued.
 *
 * Runs on a schedule, and its one hard requirement is that running it twice
 * changes nothing the second time. Every decision it makes is keyed on facts
 * that do not move — the account, the campaign, the step — never on the clock,
 * because a key with a timestamp in it is a duplicate waiting for the next run.
 *
 * Pure. The caller reads the rows, calls this, and writes what comes back.
 */

import { sendKey } from "./guard";

export type CampaignDefinition = {
  key: string;
  name: string;
  segmentKey: string;
  /** One template per step, in order. A step with no template cannot queue. */
  steps: Array<{ step: number; templateId: string | null; waitDays: number; channel: "email" | "sms" }>;
  /** Paused campaigns still enrol nobody and queue nothing. */
  status: "draft" | "live" | "paused";
};

export type ExistingEnrolment = {
  accountId: string;
  campaignKey: string;
  /** The last step queued for this person. */
  lastStep: number;
  lastQueuedAt: string;
  /** Left the campaign — completed, refused, or removed by staff. */
  finished: boolean;
};

export type PlannedMessage = {
  sendKey: string;
  accountId: string;
  campaignKey: string;
  step: number;
  templateId: string;
  channel: "email" | "sms";
  /** When it becomes eligible. The guard still decides whether it goes. */
  dueAt: string;
};

export type SweepPlan = {
  enrol: Array<{ accountId: string; campaignKey: string }>;
  queue: PlannedMessage[];
  /** Why nothing happened for someone — the line the office reads when they
   *  ask "why didn't Sarah get it?". */
  skipped: Array<{ accountId: string; reason: string }>;
};

/**
 * Plan one campaign's next move.
 *
 * `matching` is whatever the segment evaluator returned THIS run — the sweep
 * never keeps its own copy of a list, because two copies of a list is the
 * failure the segment session exists to prevent.
 */
export function planSweep(
  campaign: CampaignDefinition,
  matching: string[],
  existing: ExistingEnrolment[],
  now: Date,
): SweepPlan {
  const plan: SweepPlan = { enrol: [], queue: [], skipped: [] };

  if (campaign.status !== "live") {
    return { ...plan, skipped: matching.map((accountId) => ({ accountId, reason: `Campaign is ${campaign.status}.` })) };
  }

  const byAccount = new Map(existing.filter((e) => e.campaignKey === campaign.key).map((e) => [e.accountId, e]));
  const steps = [...campaign.steps].sort((a, b) => a.step - b.step);
  const matchSet = new Set(matching);

  for (const accountId of matchSet) {
    const enrolment = byAccount.get(accountId);

    if (enrolment?.finished) {
      plan.skipped.push({ accountId, reason: "Already been through this campaign." });
      continue;
    }

    // The step they are due next: the one after their last, or the first.
    const nextStep = steps.find((s) => s.step > (enrolment?.lastStep ?? 0));
    if (!nextStep) {
      plan.skipped.push({ accountId, reason: "Finished every step." });
      continue;
    }

    if (!enrolment) plan.enrol.push({ accountId, campaignKey: campaign.key });

    if (!nextStep.templateId) {
      plan.skipped.push({ accountId, reason: `Step ${nextStep.step} has no email written yet.` });
      continue;
    }

    // The wait runs from the LAST message, not from the sweep — otherwise a
    // sweep that runs hourly sends step 2 an hour after step 1.
    const from = enrolment ? new Date(enrolment.lastQueuedAt) : now;
    const dueAt = new Date(from.getTime() + nextStep.waitDays * 86_400_000);
    if (enrolment && dueAt > now) {
      plan.skipped.push({ accountId, reason: `Step ${nextStep.step} isn't due yet.` });
      continue;
    }

    plan.queue.push({
      sendKey: sendKey(campaign.key, accountId, nextStep.step),
      accountId,
      campaignKey: campaign.key,
      step: nextStep.step,
      templateId: nextStep.templateId,
      channel: nextStep.channel,
      dueAt: (enrolment ? dueAt : now).toISOString(),
    });
  }

  // Anyone enrolled who no longer matches: the campaign is done with them. The
  // guard would refuse the send anyway; saying so here keeps the reason visible
  // instead of leaving a message queued forever.
  for (const e of byAccount.values()) {
    if (!matchSet.has(e.accountId) && !e.finished) {
      plan.skipped.push({ accountId: e.accountId, reason: "No longer on the list." });
    }
  }

  return plan;
}
