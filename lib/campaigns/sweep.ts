/**
 * The sweep (session 3.1, rebuilt for P5): who joins a campaign, and what
 * gets queued.
 *
 * Runs on a schedule, and its one hard requirement is that running it twice
 * changes nothing the second time. Every decision it makes is keyed on facts
 * that do not move — the account, the campaign, the anchor, the step — never
 * on the clock, because a key with a timestamp in it is a duplicate waiting
 * for the next run.
 *
 * P5: waits count from the ANCHOR — the event that started the sequence (the
 * estimate going out, the job finishing) or, for an audience campaign, the
 * enrolment. "Three days after the estimate was sent" is `afterDays: 3` on
 * step one, and stays true however often the sweep runs.
 *
 * Pure. The caller reads the rows, calls this, and writes what comes back.
 */

import { sendKey, type CampaignClass, type ExitRule, type StepCondition } from "./guard";

export type CampaignStep = {
  step: number;
  templateId: string | null;
  /** Days after the anchor this step is due. Cumulative, not "after the previous step". */
  afterDays: number;
  /** Hours on top of the days, for "two hours after they opened it" once the cron runs that often. */
  afterHours?: number;
  channel: "email" | "sms";
  condition: StepCondition;
};

export type TriggerEvent = "estimate_sent" | "estimate_viewed" | "estimate_lapsed" | "estimate_declined" | "job_completed" | "visit_completed" | "invoice_paid";
export const TRIGGER_EVENTS: Array<{ key: TriggerEvent; label: string; help: string }> = [
  { key: "estimate_sent", label: "An estimate is sent", help: "The follow-up sequence Tom described starts here." },
  { key: "estimate_viewed", label: "They open their estimate", help: "First open only — later opens don't start it again." },
  { key: "estimate_lapsed", label: "An estimate lapses", help: "It passed its valid-until with no answer." },
  { key: "estimate_declined", label: "They decline an estimate", help: "A soft 'sorry to hear — here's why people come back'." },
  { key: "job_completed", label: "A job finishes", help: "After-care, then the review ask." },
  { key: "visit_completed", label: "A visit is done", help: "Thanks for having us; the estimate is on its way." },
  { key: "invoice_paid", label: "An invoice is paid", help: "Thank you, and the referral ask." },
];

export type CampaignDefinition = {
  key: string;
  name: string;
  class: CampaignClass;
  entry: "audience" | "event";
  /** The list — required for an audience campaign, an optional filter for an event campaign. */
  segmentKey: string | null;
  triggerEvent: TriggerEvent | null;
  exitRules: ExitRule[];
  /** One template per step, in order. A step with no template cannot queue. */
  steps: CampaignStep[];
  /** Paused campaigns still enrol nobody and queue nothing. */
  status: "draft" | "live" | "paused";
  autoSend: boolean;
};

/** Someone the sweep found this run: on the list, or the subject of a trigger event. */
export type Candidate = {
  accountId: string;
  anchorAt: string;
  /** '' for an audience campaign; the estimate (or event) for an event campaign. */
  anchorKey: string;
  anchorEstimateId?: string | null;
};

export type ExistingEnrolment = {
  accountId: string;
  anchorKey: string;
  anchorAt: string;
  /** The last step queued (or skipped) for this enrolment. */
  lastStep: number;
  /** Left the campaign — completed, exited, or removed by staff. */
  finished: boolean;
};

export type PlannedMessage = {
  sendKey: string;
  accountId: string;
  anchorKey: string;
  anchorAt: string;
  campaignKey: string;
  step: number;
  templateId: string;
  channel: "email" | "sms";
  condition: StepCondition;
  /** When it became eligible. The guard still decides whether it goes. */
  dueAt: string;
};

export type SweepPlan = {
  enrol: Candidate[];
  queue: PlannedMessage[];
  /** Why nothing happened for someone — the line the office reads when they
   *  ask "why didn't Sarah get it?". */
  skipped: Array<{ accountId: string; reason: string }>;
};

export const enrolmentKey = (accountId: string, anchorKey: string) => `${accountId}|${anchorKey}`;

export function stepDueAt(anchorAt: string, step: Pick<CampaignStep, "afterDays" | "afterHours">): Date {
  return new Date(new Date(anchorAt).getTime() + step.afterDays * 86_400_000 + (step.afterHours ?? 0) * 3_600_000);
}

/**
 * Plan one campaign's next move.
 *
 * `candidates` is whatever the audience query or the event scan returned THIS
 * run — the sweep never keeps its own copy of a list, because two copies of a
 * list is the failure the audience session exists to prevent.
 */
export function planSweep(
  campaign: CampaignDefinition,
  candidates: Candidate[],
  existing: ExistingEnrolment[],
  now: Date,
): SweepPlan {
  const plan: SweepPlan = { enrol: [], queue: [], skipped: [] };

  if (campaign.status !== "live") {
    return { ...plan, skipped: candidates.map((c) => ({ accountId: c.accountId, reason: `Campaign is ${campaign.status}.` })) };
  }

  const byKey = new Map(existing.map((e) => [enrolmentKey(e.accountId, e.anchorKey), e]));
  const steps = [...campaign.steps].sort((a, b) => a.step - b.step);
  const seen = new Set<string>();

  for (const c of candidates) {
    const key = enrolmentKey(c.accountId, c.anchorKey);
    if (seen.has(key)) continue;
    seen.add(key);
    const enrolment = byKey.get(key);

    if (enrolment?.finished) {
      plan.skipped.push({ accountId: c.accountId, reason: "Already been through this campaign." });
      continue;
    }

    // The step they are due next: the one after their last, or the first.
    const nextStep = steps.find((s) => s.step > (enrolment?.lastStep ?? 0));
    if (!nextStep) {
      plan.skipped.push({ accountId: c.accountId, reason: "Finished every step." });
      continue;
    }

    if (!enrolment) plan.enrol.push(c);

    if (!nextStep.templateId) {
      plan.skipped.push({ accountId: c.accountId, reason: `Step ${nextStep.step} has no ${nextStep.channel === "sms" ? "text" : "email"} written yet.` });
      continue;
    }

    // The wait runs from the ANCHOR, never from the sweep — otherwise a sweep
    // that runs hourly sends step 2 an hour after step 1.
    const anchorAt = enrolment?.anchorAt ?? c.anchorAt;
    const dueAt = stepDueAt(anchorAt, nextStep);
    if (dueAt > now) {
      plan.skipped.push({ accountId: c.accountId, reason: `Step ${nextStep.step} isn't due yet.` });
      continue;
    }

    plan.queue.push({
      sendKey: sendKey(campaign.key, c.accountId, nextStep.step, c.anchorKey),
      accountId: c.accountId,
      anchorKey: c.anchorKey,
      anchorAt,
      campaignKey: campaign.key,
      step: nextStep.step,
      templateId: nextStep.templateId,
      channel: nextStep.channel,
      condition: nextStep.condition ?? "none",
      dueAt: dueAt.toISOString(),
    });
  }

  // An audience campaign: anyone enrolled who is no longer on the list. The
  // guard would refuse the send anyway; saying so here keeps the reason
  // visible instead of leaving a message queued forever.
  if (campaign.entry === "audience") {
    for (const e of byKey.values()) {
      if (!seen.has(enrolmentKey(e.accountId, e.anchorKey)) && !e.finished) {
        plan.skipped.push({ accountId: e.accountId, reason: "No longer on the list." });
      }
    }
  }

  return plan;
}

/** Steps as stored (pre-P5 rows carried waitDays-from-previous; the migration
 *  converted them, but a row written by an old client is read safely too). */
export function normaliseSteps(raw: unknown): CampaignStep[] {
  if (!Array.isArray(raw)) return [];
  let acc = 0;
  return raw
    .map((s, i) => {
      const r = (s ?? {}) as Record<string, unknown>;
      const fromPrevious = typeof r.afterDays !== "number";
      if (fromPrevious) acc += Number(r.waitDays ?? 0) || 0;
      return {
        step: Number(r.step ?? i + 1) || i + 1,
        templateId: typeof r.templateId === "string" ? r.templateId : null,
        afterDays: fromPrevious ? acc : Number(r.afterDays) || 0,
        ...(typeof r.afterHours === "number" && r.afterHours > 0 ? { afterHours: r.afterHours } : {}),
        channel: r.channel === "sms" ? "sms" as const : "email" as const,
        condition: (["none", "unopened", "opened_silent", "not_replied", "not_accepted"].includes(String(r.condition)) ? r.condition : "none") as StepCondition,
      };
    })
    .sort((a, b) => a.step - b.step);
}
