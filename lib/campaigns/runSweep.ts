/**
 * Running the sweep for real (P5). SERVER ONLY.
 *
 * The planner in sweep.ts decides; this reads and writes. For each live
 * campaign it finds the candidates (the audience, in pages, via SQL — or the
 * trigger events since the watermark), plans, JUDGES each planned message
 * against the customer's facts (so a customer who replied last night is
 * finished this morning instead of sitting in the queue), enrols, queues,
 * and — for a campaign with auto-send on, or a message a person already
 * approved — delivers what is due inside the sending window.
 *
 * Safe to run as often as you like. Every write is keyed — the enrolment on
 * (campaign, account, anchor), the message on send_key — so a second run in
 * the same minute writes nothing and reports nothing new.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import { audienceIds, matchesAudience } from "@/lib/crm/audience";
import { getSegment, loadSegments, type StoredSegment } from "@/lib/crm/segmentsStore";
import { delayHolds } from "@/lib/crm/states";
import { judge, type CampaignRules, type CustomerState, type ExitRule } from "./guard";
import { deliverMessage, finishEnrolment } from "./deliver";
import { normaliseSteps, planSweep, type Candidate, type CampaignDefinition, type ExistingEnrolment, type PlannedMessage, type TriggerEvent } from "./sweep";

export type SweepOutcome = {
  campaign: string;
  matched: number;
  enrolled: number;
  queued: number;
  skipped: number;
  /** Enrolments ended by an exit rule this run. */
  exited: number;
  /** Delivered this run (auto-send, or previously approved). */
  sent: number;
  held: number;
  errors: string[];
};

const CHUNK = 200;
const chunks = <T,>(xs: T[], n = CHUNK): T[][] => { const out: T[][] = []; for (let i = 0; i < xs.length; i += n) out.push(xs.slice(i, i + n)); return out; };

export function toDefinition(c: Record<string, unknown>): CampaignDefinition {
  return {
    key: String(c.key), name: String(c.name),
    class: c.class === "followup" ? "followup" : "marketing",
    entry: c.entry === "event" ? "event" : "audience",
    segmentKey: (c.segment_key as string | null) ?? null,
    triggerEvent: (c.trigger_event as TriggerEvent | null) ?? null,
    exitRules: ((c.exit_rules as string[] | null) ?? []) as ExitRule[],
    steps: normaliseSteps(c.steps),
    status: (c.status as CampaignDefinition["status"]) ?? "draft",
    autoSend: c.auto_send === true,
  };
}

/** Everyone the campaign should consider this run. */
export async function findCandidates(
  db: SupabaseClient, campaign: Record<string, unknown>, def: CampaignDefinition, segment: StoredSegment | null, now: Date,
): Promise<{ candidates: Candidate[]; watermark: string | null; error?: string }> {
  if (def.entry === "audience") {
    if (!segment) return { candidates: [], watermark: null, error: `No such list: ${def.segmentKey}` };
    if (segment.invalid) return { candidates: [], watermark: null, error: `The list "${segment.name}" needs a re-save.` };
    const out: Candidate[] = [];
    for await (const page of audienceIds(db, segment.audience)) {
      for (const accountId of page) out.push({ accountId, anchorAt: now.toISOString(), anchorKey: "" });
    }
    return { candidates: out, watermark: null };
  }

  if (!def.triggerEvent) return { candidates: [], watermark: null, error: "No trigger event chosen." };
  const since = (campaign.events_since as string | null) ?? (campaign.created_at as string) ?? now.toISOString();
  const { data: events, error } = await db.from("crm_events")
    .select("id, account_id, estimate_id, occurred_at")
    .eq("type", def.triggerEvent).gt("occurred_at", since).not("account_id", "is", null)
    .order("occurred_at", { ascending: true }).limit(2000);
  if (error) return { candidates: [], watermark: null, error: error.message };
  const rows = events ?? [];
  let candidates: Candidate[] = rows.map((e) => ({
    accountId: e.account_id as string,
    anchorAt: e.occurred_at as string,
    anchorKey: ((e.estimate_id as string | null) ?? (e.id as string)).slice(0, 36),
    anchorEstimateId: (e.estimate_id as string | null) ?? null,
  }));
  // An optional list narrows an event campaign ("…but only past customers").
  if (segment && !segment.invalid && candidates.length) {
    if (candidates.length > 25) {
      const on = new Set<string>();
      for await (const page of audienceIds(db, segment.audience)) for (const id of page) on.add(id);
      candidates = candidates.filter((c) => on.has(c.accountId));
    } else {
      const keep: Candidate[] = [];
      for (const c of candidates) if (await matchesAudience(db, segment.audience, c.accountId)) keep.push(c);
      candidates = keep;
    }
  }
  const watermark = rows.length ? (rows[rows.length - 1].occurred_at as string) : null;
  return { candidates, watermark };
}

/** Unfinished enrolments as candidates: the anchor they were enrolled on. */
export function ongoing(existing: ExistingEnrolment[]): Candidate[] {
  return existing.filter((e) => !e.finished).map((e) => ({ accountId: e.accountId, anchorAt: e.anchorAt, anchorKey: e.anchorKey }));
}

async function loadEnrolments(db: SupabaseClient, campaignId: string): Promise<Array<ExistingEnrolment & { id: string }>> {
  const out: Array<ExistingEnrolment & { id: string }> = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await db.from("campaign_enrolments")
      .select("id, account_id, anchor_key, anchor_at, enrolled_at, last_step, finished_at")
      .eq("campaign_id", campaignId).order("id").range(from, from + 999);
    if (error) throw new Error(error.message);
    for (const e of data ?? []) {
      out.push({
        id: e.id as string, accountId: e.account_id as string, anchorKey: (e.anchor_key as string) ?? "",
        anchorAt: (e.anchor_at as string) ?? (e.enrolled_at as string), lastStep: (e.last_step as number) ?? 0, finished: e.finished_at != null,
      });
    }
    if (!data || data.length < 1000) break;
  }
  return out;
}

type FactsLite = {
  account_id: string; email: string | null; phone: string | null; stage: string; relationship_state: string; state_until: string | null;
  permit_email: string; permit_sms: string; snoozed_until: string | null; last_accepted_at: string | null; last_declined_at: string | null;
  last_opened_at: string | null; last_inbound_at: string | null; last_inbound_call_at: string | null; last_staff_contact_at: string | null;
};

/** Judge a planned message against the facts — the sweep's half of the guard. */
export function customerFor(f: FactsLite, acc: { marketing_unsubscribed_at: string | null; marketing_undeliverable_at: string | null } | undefined, channel: "email" | "sms", now: Date): CustomerState {
  return {
    permit: ((channel === "sms" ? f.permit_sms : f.permit_email) as CustomerState["permit"]) ?? "unknown",
    unsubscribed: acc?.marketing_unsubscribed_at != null,
    undeliverable: acc?.marketing_undeliverable_at != null,
    reachable: channel === "sms" ? !!f.phone : !!f.email,
    relationshipState: f.relationship_state ?? "active",
    stateHolding: delayHolds(f.relationship_state, f.state_until, now),
    stillInAudience: true,   // they were found on the list this very run
    hasOpenWork: f.stage === "job_on",
    lastAcceptedAt: f.last_accepted_at, lastDeclinedAt: f.last_declined_at, lastOpenedAt: f.last_opened_at,
    lastInboundAt: f.last_inbound_at, lastInboundCallAt: f.last_inbound_call_at, lastStaffContactAt: f.last_staff_contact_at,
    snoozedUntil: f.snoozed_until, lastMarketingAt: null,
  };
}

export async function runSweep(db: SupabaseClient, now: Date = new Date(), opts: { deliverCap?: number } = {}): Promise<SweepOutcome[]> {
  const { data: campaigns, error } = await db
    .from("campaigns").select("id, key, name, class, entry, segment_key, trigger_event, exit_rules, status, steps, auto_send, events_since, created_at")
    .eq("status", "live").limit(50);
  if (error || !campaigns?.length) return [];

  const segments = await loadSegments(db);
  const out: SweepOutcome[] = [];

  for (const c of campaigns) {
    const outcome: SweepOutcome = { campaign: c.name as string, matched: 0, enrolled: 0, queued: 0, skipped: 0, exited: 0, sent: 0, held: 0, errors: [] };
    try {
      const def = toDefinition(c as Record<string, unknown>);
      const segment = def.segmentKey ? (segments.find((s) => s.key === def.segmentKey) ?? await getSegment(db, def.segmentKey)) : null;
      const found = await findCandidates(db, c as Record<string, unknown>, def, segment, now);
      if (found.error) { outcome.errors.push(found.error); out.push(outcome); continue; }
      outcome.matched = found.candidates.length;

      const existing = await loadEnrolments(db, c.id as string);
      // An event campaign's candidates are the NEW events — plus everyone
      // already enrolled and not finished, whose next step may now be due.
      // The event scan moves on (events_since); the enrolment remembers.
      const candidates = def.entry === "event" ? [...found.candidates, ...ongoing(existing)] : found.candidates;
      const plan = planSweep(def, candidates, existing, now);
      outcome.skipped = plan.skipped.length;

      // Enrol first, so every queued message has a row to hang off. The unique
      // index makes a repeat a no-op rather than an error.
      for (const batch of chunks(plan.enrol, 500)) {
        const { error: enrolError } = await db.from("campaign_enrolments")
          .upsert(batch.map((e) => ({
            campaign_id: c.id, account_id: e.accountId, anchor_at: e.anchorAt, anchor_key: e.anchorKey, anchor_estimate_id: e.anchorEstimateId ?? null,
          })), { onConflict: "campaign_id,account_id,anchor_key", ignoreDuplicates: true });
        if (enrolError) outcome.errors.push(enrolError.message);
        else outcome.enrolled += batch.length;
      }

      // The rows the planned messages need: enrolment ids, facts, the two legacy flags.
      const plannedIds = [...new Set(plan.queue.map((q) => q.accountId))];
      const enrolmentOf = new Map<string, string>();
      const factsOf = new Map<string, FactsLite>();
      const accountOf = new Map<string, { marketing_unsubscribed_at: string | null; marketing_undeliverable_at: string | null }>();
      for (const ids of chunks(plannedIds)) {
        const [{ data: enrols }, { data: facts }, { data: accounts }] = await Promise.all([
          db.from("campaign_enrolments").select("id, account_id, anchor_key").eq("campaign_id", c.id).in("account_id", ids),
          db.from("crm_account_facts").select("account_id, email, phone, stage, relationship_state, state_until, permit_email, permit_sms, snoozed_until, last_accepted_at, last_declined_at, last_opened_at, last_inbound_at, last_inbound_call_at, last_staff_contact_at").in("account_id", ids),
          db.from("accounts").select("id, marketing_unsubscribed_at, marketing_undeliverable_at").in("id", ids),
        ]);
        for (const e of enrols ?? []) enrolmentOf.set(`${e.account_id}|${(e.anchor_key as string) ?? ""}`, e.id as string);
        for (const f of facts ?? []) factsOf.set(f.account_id as string, f as FactsLite);
        for (const a of accounts ?? []) accountOf.set(a.id as string, a as never);
      }

      const rules: CampaignRules = { class: def.class, entry: def.entry, exitRules: def.exitRules };
      const rows: Array<Record<string, unknown>> = [];
      const advance = new Map<string, { last_step: number; last_queued_at: string }>();
      const exits: Array<{ enrolmentId: string; reason: string }> = [];
      for (const q of plan.queue) {
        const enrolmentId = enrolmentOf.get(`${q.accountId}|${q.anchorKey}`);
        const facts = factsOf.get(q.accountId);
        if (!enrolmentId || !facts) continue;

        const verdict = judge(
          { sendKey: q.sendKey, accountId: q.accountId, campaignKey: q.campaignKey, channel: q.channel, enrolledAt: q.anchorAt, anchorAt: q.anchorAt, step: q.step, condition: q.condition },
          customerFor(facts, accountOf.get(q.accountId), q.channel, now), rules,
        );
        if (!verdict.send && verdict.exit) { exits.push({ enrolmentId, reason: verdict.reason }); continue; }
        const state = !verdict.send ? "stopped" : "queued";
        rows.push({
          enrolment_id: enrolmentId, campaign_id: c.id, account_id: q.accountId, template_id: q.templateId,
          step: q.step, channel: q.channel, condition: q.condition, state,
          reason: !verdict.send ? verdict.reason : "Waiting for someone to read it.",
          send_key: q.sendKey, due_at: q.dueAt, ...(state === "stopped" ? { judged_at: now.toISOString() } : {}),
        });
        advance.set(enrolmentId, { last_step: q.step, last_queued_at: q.dueAt });
      }

      // One write per batch, not one per message. A send key that already
      // exists is the sweep having run twice — ignored, which is the design
      // working, not a failure.
      for (const batch of chunks(rows, 500)) {
        const { data: written, error: queueError } = await db.from("campaign_messages")
          .upsert(batch, { onConflict: "send_key", ignoreDuplicates: true }).select("state");
        if (queueError) { outcome.errors.push(queueError.message); continue; }
        for (const w of written ?? []) { if (w.state === "queued") outcome.queued += 1; else outcome.skipped += 1; }
      }
      for (const batch of chunks([...advance], 25)) {
        await Promise.all(batch.map(([enrolmentId, a]) => db.from("campaign_enrolments").update(a).eq("id", enrolmentId)));
      }
      for (const batch of chunks(exits, 10)) {
        await Promise.all(batch.map((x) => finishEnrolment(db, x.enrolmentId, x.reason, now)));
        outcome.exited += batch.length;
      }

      // Deliver what is due and allowed to go without a person now: everything
      // in an auto-send campaign, and anything a person already approved.
      const delivered = await deliverDue(db, c.id as string, def.autoSend, now, opts.deliverCap ?? 200);
      outcome.sent += delivered.sent; outcome.held += delivered.held; outcome.errors.push(...delivered.errors);

      // Conversions, the watermark, the clock.
      const { error: convError } = await db.rpc("crm_campaign_mark_conversions", { p_campaign: c.id });
      if (convError) outcome.errors.push(convError.message);
      await db.from("campaigns").update({
        last_swept_at: now.toISOString(),
        ...(found.watermark ? { events_since: found.watermark } : {}),
      }).eq("id", c.id);
    } catch (e) {
      outcome.errors.push(e instanceof Error ? e.message : String(e));
    }
    out.push(outcome);
  }

  return out;
}

/** Due rows that may go without a fresh approval: auto-send, or approved earlier and held for timing. */
export async function deliverDue(db: SupabaseClient, campaignId: string, autoSend: boolean, now: Date, cap: number): Promise<{ sent: number; held: number; errors: string[] }> {
  let q = db.from("campaign_messages").select("id, approved_at").eq("campaign_id", campaignId)
    .in("state", ["queued", "held"]).lte("due_at", now.toISOString()).order("due_at", { ascending: true }).limit(cap);
  if (!autoSend) q = q.not("approved_at", "is", null);
  const { data, error } = await q;
  if (error) return { sent: 0, held: 0, errors: [error.message] };
  const result = { sent: 0, held: 0, errors: [] as string[] };
  for (const row of data ?? []) {
    const r = await deliverMessage(db, row.id as string, { humanApproved: row.approved_at != null, now });
    if (r.ok) result.sent += 1;
    else if (r.state === "held") result.held += 1;
    else if (r.state === "error") result.errors.push(r.message);
  }
  return result;
}

export type { PlannedMessage };
