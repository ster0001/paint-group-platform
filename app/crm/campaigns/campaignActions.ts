"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { getSegment } from "@/lib/crm/segmentsStore";
import { countAudience, sampleAudience } from "@/lib/crm/audience";
import { planSweep, type Candidate, type CampaignDefinition } from "@/lib/campaigns/sweep";
import { DEFAULT_POLICY, dryRun, type MessageState, type SendCandidate } from "@/lib/campaigns/guard";
import { customerFor, findCandidates, ongoing, toDefinition } from "@/lib/campaigns/runSweep";
import { deliverMessage, melbourneClock } from "@/lib/campaigns/deliver";

export type CampaignResult<T = undefined> =
  | { ok: true; message: string; data?: T }
  | { ok: false; message: string };

const uuid = z.string().uuid();

const stepSchema = z.object({
  step: z.number().int().min(1).max(10),
  templateId: z.string().uuid().nullable(),
  afterDays: z.number().int().min(0).max(730),
  afterHours: z.number().int().min(0).max(23).optional(),
  channel: z.enum(["email", "sms"]),
  condition: z.enum(["none", "unopened", "opened_silent", "not_replied", "not_accepted"]).default("none"),
});
const classSchema = z.enum(["marketing", "followup"]);
const entrySchema = z.enum(["audience", "event"]);
const triggerSchema = z.enum(["estimate_sent", "estimate_viewed", "estimate_lapsed", "estimate_declined", "job_completed", "visit_completed", "invoice_paid"]);
const exitSchema = z.array(z.enum(["replied", "called", "accepted", "declined", "do_not_contact", "staff_took_over"])).max(6);

export type CampaignPatch = {
  name?: string;
  class?: "marketing" | "followup";
  entry?: "audience" | "event";
  segmentKey?: string | null;
  triggerEvent?: string | null;
  exitRules?: string[];
  steps?: unknown;
  status?: "draft" | "live" | "paused";
  autoSend?: boolean;
  conversionDays?: number;
};

export async function createCampaign(input: { name: string; class: "marketing" | "followup"; entry: "audience" | "event"; segmentKey: string | null; triggerEvent: string | null }): Promise<CampaignResult<{ id: string }>> {
  const clean = input.name.trim();
  if (clean.length < 3) return { ok: false, message: "Give it a name you'll recognise in six months." };
  const cls = classSchema.safeParse(input.class);
  const entry = entrySchema.safeParse(input.entry);
  if (!cls.success || !entry.success) return { ok: false, message: "Pick a kind and a start." };

  const supabase = await createClient();
  if (entry.data === "audience") {
    if (!input.segmentKey || !(await getSegment(supabase, input.segmentKey))) return { ok: false, message: "Pick a list for it to go to." };
  } else if (!triggerSchema.safeParse(input.triggerEvent).success) {
    return { ok: false, message: "Pick what starts it." };
  }

  const { data: { user } } = await supabase.auth.getUser();
  const key = clean.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 40)
    + "-" + Math.random().toString(36).slice(2, 6);

  // A follow-up stops on any answer, always; the builder shows the rest as choices.
  const exitRules = cls.data === "followup" ? ["replied", "called", "accepted", "declined", "staff_took_over"] : ["accepted"];
  const { data, error } = await supabase.from("campaigns")
    .insert({
      key, name: clean, class: cls.data, entry: entry.data,
      segment_key: entry.data === "audience" || input.segmentKey ? input.segmentKey : null,
      trigger_event: entry.data === "event" ? input.triggerEvent : null,
      exit_rules: exitRules, created_by: user?.id ?? null,
    })
    .select("id").single();
  if (error) return { ok: false, message: error.message };
  revalidatePath("/crm/campaigns");
  return { ok: true, message: "Campaign started — nothing sends until you say so.", data: { id: data.id as string } };
}

export async function saveCampaign(id: string, patch: CampaignPatch): Promise<CampaignResult> {
  if (!uuid.safeParse(id).success) return { ok: false, message: "That isn't a campaign." };

  const update: Record<string, unknown> = {};
  if (patch.name != null) update.name = patch.name.trim() || "Untitled campaign";
  if (patch.class != null) {
    const c = classSchema.safeParse(patch.class);
    if (!c.success) return { ok: false, message: "That isn't a kind of campaign." };
    update.class = c.data;
  }
  if (patch.entry != null) {
    const e = entrySchema.safeParse(patch.entry);
    if (!e.success) return { ok: false, message: "That isn't a way to start." };
    update.entry = e.data;
  }
  if (patch.segmentKey !== undefined) update.segment_key = patch.segmentKey || null;
  if (patch.triggerEvent !== undefined) {
    if (patch.triggerEvent && !triggerSchema.safeParse(patch.triggerEvent).success) return { ok: false, message: "That isn't an event." };
    update.trigger_event = patch.triggerEvent || null;
  }
  if (patch.exitRules != null) {
    const x = exitSchema.safeParse(patch.exitRules);
    if (!x.success) return { ok: false, message: "Those exit rules don't look right." };
    update.exit_rules = x.data;
  }
  if (patch.autoSend != null) update.auto_send = patch.autoSend === true;
  if (patch.conversionDays != null) update.conversion_days = Math.max(1, Math.min(365, Math.round(patch.conversionDays)));
  if (patch.status != null) update.status = patch.status;
  if (patch.steps != null) {
    const parsed = z.array(stepSchema).min(1).max(10).safeParse(patch.steps);
    if (!parsed.success) return { ok: false, message: "Those steps don't look right." };
    // A follow-up is short by definition (decision 8.1): four steps at most.
    const cls = (update.class as string | undefined) ?? patch.class;
    if (cls === "followup" && parsed.data.length > 4) return { ok: false, message: "A quote follow-up is four steps at most — after that it's marketing." };
    update.steps = parsed.data;
  }

  const supabase = await createClient();
  const { data: before } = await supabase.from("campaigns").select("class, entry, segment_key, trigger_event, steps").eq("id", id).maybeSingle();
  const after = { ...(before ?? {}), ...update } as Record<string, unknown>;
  if (update.status === "live") {
    if (after.entry === "audience" && !after.segment_key) return { ok: false, message: "Pick a list before going live." };
    if (after.entry === "event" && !after.trigger_event) return { ok: false, message: "Pick what starts it before going live." };
    const steps = Array.isArray(after.steps) ? (after.steps as Array<{ templateId: string | null }>) : [];
    if (steps.length === 0 || steps.some((s) => !s.templateId)) return { ok: false, message: "Every step needs an email or text before going live." };
  }
  if (after.class === "followup" && Array.isArray(after.steps) && (after.steps as unknown[]).length > 4) {
    return { ok: false, message: "A quote follow-up is four steps at most — trim the steps first." };
  }

  const { error } = await supabase.from("campaigns").update(update).eq("id", id);
  if (error) return { ok: false, message: error.message };
  revalidatePath(`/crm/campaigns/c/${id}`);
  revalidatePath("/crm/campaigns");
  return {
    ok: true,
    message: patch.status === "live"
      ? (after.auto_send === true || (update.auto_send as boolean | undefined) === true
        ? "Live — and auto-send is on, so due messages go out on their own inside the sending window."
        : "Live — it will enrol people, and every message still waits for you.")
      : patch.autoSend === true ? "Auto-send is ON for this campaign. Due messages go without a person, inside the sending window." : "Saved.",
  };
}

export type DryRunRow = { name: string; email: string; reason: string };
export type DryRunReport = {
  matching: number;
  wouldQueue: DryRunRow[];
  held: DryRunRow[];
  stopped: DryRunRow[];
  notes: string[];
};

/**
 * "Who would actually get this?"
 *
 * The whole point: it runs the REAL audience query (or the real event scan),
 * the REAL sweep planner and the REAL guard chain, then writes nothing. A
 * preview built from different code than the send is a preview that lies,
 * and this is the screen people will trust before turning a campaign on.
 */
export async function dryRunCampaign(id: string): Promise<CampaignResult<DryRunReport>> {
  if (!uuid.safeParse(id).success) return { ok: false, message: "That isn't a campaign." };
  const supabase = await createClient();

  const { data: campaign } = await supabase.from("campaigns")
    .select("id, key, name, class, entry, segment_key, trigger_event, exit_rules, status, steps, auto_send, events_since, created_at").eq("id", id).maybeSingle();
  if (!campaign) return { ok: false, message: "That campaign is gone." };

  const now = new Date();
  const def = toDefinition(campaign as Record<string, unknown>);
  const segment = def.segmentKey ? await getSegment(supabase, def.segmentKey) : null;
  if (def.entry === "audience" && !segment) return { ok: false, message: "Its list no longer exists." };

  const notes: string[] = [];
  let matching = 0;
  let candidates: Candidate[] = [];
  if (def.entry === "audience") {
    matching = await countAudience(supabase, segment!.audience);
    // A sample stands in for the whole list here — the sweep walks all of it.
    const sample = await sampleAudience(supabase, segment!.audience, 200);
    candidates = sample.map((s) => ({ accountId: s.account_id, anchorAt: now.toISOString(), anchorKey: "" }));
    if (matching > candidates.length) notes.push(`Showing the first ${candidates.length} of ${matching.toLocaleString("en-AU")}.`);
  } else {
    const found = await findCandidates(supabase, campaign as Record<string, unknown>, def, segment, now);
    if (found.error) return { ok: false, message: found.error };
    candidates = found.candidates;
    matching = candidates.length;
    if (matching === 0) notes.push(`No "${def.triggerEvent?.replace(/_/g, " ")}" events since it was ${campaign.events_since ? "last swept" : "created"} — it will pick up the next one.`);
  }

  const { data: enrolments } = await supabase.from("campaign_enrolments")
    .select("account_id, anchor_key, anchor_at, enrolled_at, last_step, finished_at").eq("campaign_id", id).limit(5000);
  const definition: CampaignDefinition = { ...def, status: "live" };
  const existing = (enrolments ?? []).map((e) => ({
    accountId: e.account_id as string, anchorKey: (e.anchor_key as string) ?? "",
    anchorAt: (e.anchor_at as string) ?? (e.enrolled_at as string), lastStep: (e.last_step as number) ?? 0, finished: e.finished_at != null,
  }));
  // Same rule as the sweep: an event campaign also plans its ongoing enrolments.
  const plan = planSweep(definition, def.entry === "event" ? [...candidates, ...ongoing(existing)] : candidates, existing, now);

  const ids = [...new Set(plan.queue.map((q) => q.accountId))];
  const factsOf = new Map<string, Record<string, unknown>>();
  const accountOf = new Map<string, { marketing_unsubscribed_at: string | null; marketing_undeliverable_at: string | null }>();
  for (let i = 0; i < ids.length; i += 200) {
    const slice = ids.slice(i, i + 200);
    const [{ data: facts }, { data: accounts }] = await Promise.all([
      supabase.from("crm_account_facts").select("account_id, name, email, phone, stage, relationship_state, state_until, permit_email, permit_sms, snoozed_until, last_accepted_at, last_declined_at, last_opened_at, last_inbound_at, last_inbound_call_at, last_staff_contact_at").in("account_id", slice),
      supabase.from("accounts").select("id, marketing_unsubscribed_at, marketing_undeliverable_at").in("id", slice),
    ]);
    for (const f of facts ?? []) factsOf.set(f.account_id as string, f);
    for (const a of accounts ?? []) accountOf.set(a.id as string, a as never);
  }
  const approvedTemplates = new Set<string>();
  const templateIds = def.steps.map((s) => s.templateId).filter(Boolean) as string[];
  if (templateIds.length) {
    const { data: tpls } = await supabase.from("campaign_templates").select("id, approved_at").in("id", templateIds).limit(20);
    for (const t of tpls ?? []) if (t.approved_at) approvedTemplates.add(t.id as string);
  }

  const rows = plan.queue.flatMap((q) => {
    const f = factsOf.get(q.accountId);
    if (!f) return [];
    const candidate: SendCandidate = {
      sendKey: q.sendKey, accountId: q.accountId, campaignKey: q.campaignKey, channel: q.channel,
      enrolledAt: q.anchorAt, anchorAt: q.anchorAt, step: q.step, condition: q.condition,
    };
    const message: MessageState = { templateApproved: approvedTemplates.has(q.templateId), humanApproved: false, alreadySent: false };
    return [{ candidate, customer: customerFor(f as never, accountOf.get(q.accountId), q.channel, now), message }];
  });

  const { hour, day } = melbourneClock(now);
  const result = dryRun(rows, { class: def.class, entry: def.entry, exitRules: def.exitRules }, { ...DEFAULT_POLICY, autoSend: def.autoSend }, now, hour, day);
  const label = (accountId: string, reason: string): DryRunRow => {
    const f = factsOf.get(accountId);
    return { name: (f?.name as string) || (f?.email as string) || "Unknown", email: (f?.email as string) ?? "", reason };
  };

  if (campaign.status !== "live") notes.push(`This campaign is ${campaign.status}, so nothing is enrolled yet. This is what would happen if it were live.`);
  if (!def.autoSend) notes.push("Auto-send is off, so every message would wait for you — that is why nothing is in the first column.");
  if (def.steps.some((s) => !s.templateId)) notes.push("A step has no email or text written yet.");
  const notDue = plan.skipped.filter((s) => /isn't due yet/.test(s.reason)).length;
  if (notDue) notes.push(`${notDue} would be enrolled now and messaged when their first step comes due.`);

  return {
    ok: true,
    message: `${matching.toLocaleString("en-AU")} ${def.entry === "audience" ? "on the list" : "to enrol"}, ${plan.queue.length} due a message.`,
    data: {
      matching,
      wouldQueue: result.going.map((c) => label(c.accountId, "Ready")),
      held: result.held.map((h) => label(h.candidate.accountId, h.reason)),
      stopped: result.stopped.map((s) => label(s.candidate.accountId, s.reason)),
      notes,
    },
  };
}

export type CampaignStats = {
  enrolled: number; active: number; exited: number; waiting: number; sent: number; stopped: number; failed: number;
  delivered: number; opened: number; clicked: number; bounced: number; replied: number; unsubscribed: number;
  converted: number; revenue_cents: number;
};

export async function campaignStats(id: string): Promise<CampaignResult<CampaignStats>> {
  if (!uuid.safeParse(id).success) return { ok: false, message: "That isn't a campaign." };
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("crm_campaign_stats", { p_campaign: id });
  if (error) return { ok: false, message: error.message };
  return { ok: true, message: "", data: data as CampaignStats };
}

// ---- the approval queue ------------------------------------------------------

/**
 * Run the sweep by hand.
 *
 * The cron does this on weekday mornings; the button exists so somebody can
 * see the result now rather than tomorrow. Identical code either way.
 */
export async function sweepNow(): Promise<CampaignResult<{ queued: number; matched: number; sent: number }>> {
  const supabase = await createClient();
  const { runSweep } = await import("@/lib/campaigns/runSweep");
  const outcomes = await runSweep(supabase as never, new Date());
  const queued = outcomes.reduce((n, o) => n + o.queued, 0);
  const matched = outcomes.reduce((n, o) => n + o.matched, 0);
  const sent = outcomes.reduce((n, o) => n + o.sent, 0);
  const exited = outcomes.reduce((n, o) => n + o.exited, 0);
  const errors = outcomes.flatMap((o) => o.errors);
  revalidatePath("/crm/campaigns/queue");
  revalidatePath("/crm/campaigns");
  if (errors.length) return { ok: false, message: errors[0] };
  return {
    ok: true,
    message: outcomes.length === 0
      ? "No live campaigns, so nothing to sweep."
      : `${matched} matched, ${queued} newly queued${exited ? `, ${exited} finished by an exit rule` : ""}${sent ? `, ${sent} sent on auto-send` : ""}.`,
    data: { queued, matched, sent },
  };
}

/**
 * Approve one message and send it.
 *
 * The guard chain runs again in deliverMessage, against the customer as they
 * are in this second — not as they were when the sweep queued them. Someone
 * who accepted a quote an hour ago gets nothing, and that is the entire point
 * of approving at send time rather than at enrolment.
 */
export async function approveAndSend(messageId: string): Promise<CampaignResult> {
  if (!uuid.safeParse(messageId).success) return { ok: false, message: "That isn't a message." };
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  const r = await deliverMessage(supabase, messageId, { humanApproved: true, approvedBy: user?.id ?? null });
  revalidatePath("/crm/campaigns/queue");
  return { ok: r.ok, message: r.message };
}

/** Approve many at once — each one still walks the whole guard chain. */
export async function approveMany(messageIds: string[]): Promise<CampaignResult<{ sent: number; held: number; stopped: number; failed: number }>> {
  const ids = messageIds.filter((id) => uuid.safeParse(id).success).slice(0, 200);
  if (ids.length === 0) return { ok: false, message: "Nothing selected." };
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  const tally = { sent: 0, held: 0, stopped: 0, failed: 0 };
  for (const id of ids) {
    const r = await deliverMessage(supabase, id, { humanApproved: true, approvedBy: user?.id ?? null });
    if (r.ok) tally.sent += 1;
    else if (r.state === "held") tally.held += 1;
    else if (r.state === "stopped") tally.stopped += 1;
    else tally.failed += 1;
  }
  revalidatePath("/crm/campaigns/queue");
  const parts = [`${tally.sent} sent`];
  if (tally.held) parts.push(`${tally.held} approved and held for the sending window`);
  if (tally.stopped) parts.push(`${tally.stopped} refused by the guard`);
  if (tally.failed) parts.push(`${tally.failed} failed`);
  return { ok: tally.failed === 0, message: parts.join(", ") + ".", data: tally };
}

export async function cancelMessage(messageId: string, reason: string): Promise<CampaignResult> {
  if (!uuid.safeParse(messageId).success) return { ok: false, message: "That isn't a message." };
  const supabase = await createClient();
  const { error } = await supabase.from("campaign_messages")
    .update({ state: "stopped", reason: reason.trim() || "Cancelled by the office." }).eq("id", messageId);
  if (error) return { ok: false, message: error.message };
  revalidatePath("/crm/campaigns/queue");
  return { ok: true, message: "Cancelled — it won't go." };
}

/** Take one customer out of a campaign for good. */
export async function removeFromCampaign(enrolmentId: string): Promise<CampaignResult> {
  if (!uuid.safeParse(enrolmentId).success) return { ok: false, message: "That isn't an enrolment." };
  const supabase = await createClient();
  const { finishEnrolment } = await import("@/lib/campaigns/deliver");
  await finishEnrolment(supabase, enrolmentId, "Removed by the office.", new Date());
  revalidatePath("/crm/campaigns/queue");
  return { ok: true, message: "Removed — nothing more from this campaign goes to them." };
}
