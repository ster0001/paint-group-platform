/**
 * Running the sweep for real (session 3.1). SERVER ONLY.
 *
 * The planner in sweep.ts decides; this writes. Nothing here sends: it enrols
 * people and queues messages in state `queued`, which means "waiting for a
 * person". The queue screen is where a human turns that into a send.
 *
 * Safe to run as often as you like. Every write is keyed — the enrolment on
 * (campaign, account), the message on send_key — so a second run in the same
 * minute writes nothing and reports nothing new.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import { evaluateSegment } from "@/lib/crm/segments";
import { loadSegments } from "@/lib/crm/segmentsStore";
import { loadSubjects } from "@/lib/crm/loadSubjects";
import { planSweep, type CampaignDefinition } from "./sweep";

export type SweepOutcome = {
  campaign: string;
  matched: number;
  enrolled: number;
  queued: number;
  skipped: number;
  errors: string[];
};

export async function runSweep(db: SupabaseClient, now: Date = new Date()): Promise<SweepOutcome[]> {
  const { data: campaigns, error } = await db
    .from("campaigns").select("id, key, name, segment_key, status, steps").eq("status", "live").limit(50);
  if (error || !campaigns?.length) return [];

  // One load for every campaign — the customer picture does not change
  // between them, and reloading it per campaign is how a sweep gets slow.
  const subjects = await loadSubjects(db, now);
  const segments = await loadSegments(db);
  const out: SweepOutcome[] = [];

  for (const c of campaigns) {
    const outcome: SweepOutcome = { campaign: c.name as string, matched: 0, enrolled: 0, queued: 0, skipped: 0, errors: [] };
    const segment = segments.find((s) => s.key === c.segment_key);
    if (!segment) { outcome.errors.push(`No such list: ${c.segment_key}`); out.push(outcome); continue; }

    const matching = evaluateSegment(subjects, segment, now);
    outcome.matched = matching.length;

    const { data: existing } = await db.from("campaign_enrolments")
      .select("id, account_id, last_step, last_queued_at, finished_at").eq("campaign_id", c.id).limit(5000);

    const definition: CampaignDefinition = {
      key: c.key as string, name: c.name as string, segmentKey: c.segment_key as string,
      status: "live", steps: (Array.isArray(c.steps) ? c.steps : []) as CampaignDefinition["steps"],
    };
    const plan = planSweep(definition, matching.map((m) => m.accountId),
      (existing ?? []).map((e) => ({
        accountId: e.account_id as string, campaignKey: definition.key,
        lastStep: (e.last_step as number) ?? 0,
        lastQueuedAt: (e.last_queued_at as string) ?? now.toISOString(),
        finished: e.finished_at != null,
      })), now);
    outcome.skipped = plan.skipped.length;

    // Enrol first, so every queued message has a row to hang off. The unique
    // constraint makes a repeat a no-op rather than an error.
    if (plan.enrol.length) {
      const { error: enrolError } = await db.from("campaign_enrolments")
        .upsert(plan.enrol.map((e) => ({ campaign_id: c.id, account_id: e.accountId })),
          { onConflict: "campaign_id,account_id", ignoreDuplicates: true });
      if (enrolError) outcome.errors.push(enrolError.message);
      else outcome.enrolled = plan.enrol.length;
    }

    const { data: enrolments } = await db.from("campaign_enrolments")
      .select("id, account_id").eq("campaign_id", c.id).limit(5000);
    const enrolmentOf = new Map((enrolments ?? []).map((e) => [e.account_id as string, e.id as string]));

    for (const q of plan.queue) {
      const enrolmentId = enrolmentOf.get(q.accountId);
      if (!enrolmentId) continue;
      const { error: queueError } = await db.from("campaign_messages").insert({
        enrolment_id: enrolmentId,
        account_id: q.accountId,
        template_id: q.templateId,
        step: q.step,
        channel: q.channel,
        state: "queued",
        reason: "Waiting for someone to read it.",
        send_key: q.sendKey,
        due_at: q.dueAt,
      });
      // 23505 = the send key already exists, which is the sweep having run
      // twice. That is the design working, not a failure.
      if (queueError && queueError.code !== "23505") outcome.errors.push(queueError.message);
      else if (!queueError) {
        outcome.queued += 1;
        await db.from("campaign_enrolments")
          .update({ last_step: q.step, last_queued_at: q.dueAt }).eq("id", enrolmentId);
      }
    }

    out.push(outcome);
  }

  return out;
}
