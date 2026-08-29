"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { loadSubjects } from "@/lib/crm/loadSubjects";
import { evaluateSegment, STANDING_SEGMENTS } from "@/lib/crm/segments";
import { planSweep, type CampaignDefinition } from "@/lib/campaigns/sweep";
import { DEFAULT_POLICY, dryRun, type MessageState, type SendCandidate } from "@/lib/campaigns/guard";

export type CampaignResult<T = undefined> =
  | { ok: true; message: string; data?: T }
  | { ok: false; message: string };

const uuid = z.string().uuid();

const stepSchema = z.object({
  step: z.number().int().min(1).max(10),
  templateId: z.string().uuid().nullable(),
  waitDays: z.number().int().min(0).max(365),
  channel: z.enum(["email", "sms"]),
});

export async function createCampaign(name: string, segmentKey: string): Promise<CampaignResult<{ id: string }>> {
  const clean = name.trim();
  if (clean.length < 3) return { ok: false, message: "Give it a name you'll recognise in six months." };
  if (!STANDING_SEGMENTS.some((s) => s.key === segmentKey)) return { ok: false, message: "Pick a list for it to go to." };

  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  const key = clean.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 40)
    + "-" + Math.random().toString(36).slice(2, 6);

  const { data, error } = await supabase.from("campaigns")
    .insert({ key, name: clean, segment_key: segmentKey, created_by: user?.id ?? null })
    .select("id").single();
  if (error) return { ok: false, message: error.message };
  revalidatePath("/crm/campaigns");
  return { ok: true, message: "Campaign started — nothing sends until you say so.", data: { id: data.id as string } };
}

export async function saveCampaign(
  id: string,
  patch: { name?: string; segmentKey?: string; steps?: unknown; status?: "draft" | "live" | "paused" },
): Promise<CampaignResult> {
  if (!uuid.safeParse(id).success) return { ok: false, message: "That isn't a campaign." };

  const update: Record<string, unknown> = {};
  if (patch.name != null) update.name = patch.name.trim() || "Untitled campaign";
  if (patch.segmentKey != null) update.segment_key = patch.segmentKey;
  if (patch.status != null) update.status = patch.status;
  if (patch.steps != null) {
    const parsed = z.array(stepSchema).min(1).max(10).safeParse(patch.steps);
    if (!parsed.success) return { ok: false, message: "Those steps don't look right." };
    update.steps = parsed.data;
  }

  const supabase = await createClient();
  const { error } = await supabase.from("campaigns").update(update).eq("id", id);
  if (error) return { ok: false, message: error.message };
  revalidatePath(`/crm/campaigns/c/${id}`);
  revalidatePath("/crm/campaigns");
  return {
    ok: true,
    message: patch.status === "live"
      ? "Live — it will enrol people, and every message still waits for you."
      : "Saved.",
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
 * The whole point: it runs the REAL segment evaluator, the REAL sweep planner
 * and the REAL guard chain, then writes nothing. A preview built from different
 * code than the send is a preview that lies, and this is the screen people will
 * trust before turning a campaign on.
 */
export async function dryRunCampaign(id: string): Promise<CampaignResult<DryRunReport>> {
  if (!uuid.safeParse(id).success) return { ok: false, message: "That isn't a campaign." };
  const supabase = await createClient();

  const { data: campaign } = await supabase.from("campaigns")
    .select("id, key, name, segment_key, status, steps, auto_send").eq("id", id).maybeSingle();
  if (!campaign) return { ok: false, message: "That campaign is gone." };

  const segment = STANDING_SEGMENTS.find((s) => s.key === campaign.segment_key);
  if (!segment) return { ok: false, message: "Its list no longer exists." };

  const now = new Date();
  const subjects = await loadSubjects(supabase, now);
  const matching = evaluateSegment(subjects, segment, now);

  const { data: enrolments } = await supabase.from("campaign_enrolments")
    .select("account_id, last_step, last_queued_at, finished_at").eq("campaign_id", id).limit(3000);

  const definition: CampaignDefinition = {
    key: campaign.key as string,
    name: campaign.name as string,
    segmentKey: campaign.segment_key as string,
    status: campaign.status as CampaignDefinition["status"],
    steps: (Array.isArray(campaign.steps) ? campaign.steps : []) as CampaignDefinition["steps"],
  };

  // The dry run answers "if this were live", so a draft is planned as though
  // it were — otherwise the only thing it could ever tell you is "it's a draft".
  const plan = planSweep({ ...definition, status: "live" }, matching.map((m) => m.accountId),
    (enrolments ?? []).map((e) => ({
      accountId: e.account_id as string,
      campaignKey: definition.key,
      lastStep: (e.last_step as number) ?? 0,
      lastQueuedAt: (e.last_queued_at as string) ?? now.toISOString(),
      finished: e.finished_at != null,
    })), now);

  const byId = new Map(subjects.map((s) => [s.accountId, s]));
  const approvedTemplates = new Set<string>();
  const templateIds = definition.steps.map((s) => s.templateId).filter(Boolean) as string[];
  if (templateIds.length) {
    const { data: tpls } = await supabase.from("campaign_templates")
      .select("id, approved_at").in("id", templateIds).limit(20);
    for (const t of tpls ?? []) if (t.approved_at) approvedTemplates.add(t.id as string);
  }

  const rows = plan.queue.map((q) => {
    const s = byId.get(q.accountId)!;
    const candidate: SendCandidate = {
      sendKey: q.sendKey, accountId: q.accountId, campaignKey: q.campaignKey,
      channel: q.channel, enrolledAt: q.dueAt,
    };
    const message: MessageState = {
      templateApproved: approvedTemplates.has(q.templateId),
      // Nothing has been approved by a person yet — this is a preview of a
      // campaign nobody has turned on.
      humanApproved: false,
      alreadySent: false,
    };
    return {
      candidate,
      customer: {
        unsubscribed: s.unsubscribedAt != null,
        stillInSegment: true,
        hasOpenWork: s.hasOpenWork,
        acceptedSince: s.acceptedAt,
        snoozedUntil: s.snoozedUntil,
        lastMarketingAt: s.lastMarketingAt,
        undeliverable: s.undeliverableAt != null,
      },
      message,
    };
  });

  const melbourneHour = Number(new Intl.DateTimeFormat("en-AU", { timeZone: "Australia/Melbourne", hour: "numeric", hour12: false }).format(now));
  const melbourneDay = new Date(now.toLocaleString("en-US", { timeZone: "Australia/Melbourne" })).getDay();
  const result = dryRun(rows, DEFAULT_POLICY, now, melbourneHour, melbourneDay);

  const label = (accountId: string, reason: string): DryRunRow => {
    const s = byId.get(accountId);
    return { name: s?.name ?? "Unknown", email: s?.email ?? "", reason };
  };

  const notes: string[] = [];
  if (campaign.status !== "live") notes.push(`This campaign is ${campaign.status}, so nothing is enrolled yet. This is what would happen if it were live.`);
  if (!campaign.auto_send) notes.push("Auto-send is off, so every message would wait for you — that is why nothing is in the first column.");
  if (definition.steps.some((s) => !s.templateId)) notes.push("A step has no email written yet.");

  return {
    ok: true,
    message: `${matching.length} on the list, ${plan.queue.length} due a message.`,
    data: {
      matching: matching.length,
      wouldQueue: result.going.map((c) => label(c.accountId, "Ready")),
      held: result.held.map((h) => label(h.candidate.accountId, h.reason)),
      stopped: result.stopped.map((s) => label(s.candidate.accountId, s.reason)),
      notes,
    },
  };
}
