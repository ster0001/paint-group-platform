"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { loadSubjects } from "@/lib/crm/loadSubjects";
import { evaluateSegment } from "@/lib/crm/segments";
import { getSegment } from "@/lib/crm/segmentsStore";
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

  const supabase = await createClient();
  if (!(await getSegment(supabase, segmentKey))) return { ok: false, message: "Pick a list for it to go to." };

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

  const segment = await getSegment(supabase, campaign.segment_key as string);
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

// ---- the approval queue ------------------------------------------------------

export type QueueRow = {
  id: string;
  accountName: string;
  email: string;
  campaign: string;
  templateName: string;
  templateId: string | null;
  subject: string;
  step: number;
  state: string;
  reason: string | null;
  verdict: string;
  sendable: boolean;
};

/**
 * Run the sweep by hand.
 *
 * The cron does this on weekday mornings; the button exists so somebody can
 * see the result now rather than tomorrow. Identical code either way.
 */
export async function sweepNow(): Promise<CampaignResult<{ queued: number; matched: number }>> {
  const supabase = await createClient();
  const { runSweep } = await import("@/lib/campaigns/runSweep");
  const outcomes = await runSweep(supabase as never, new Date());
  const queued = outcomes.reduce((n, o) => n + o.queued, 0);
  const matched = outcomes.reduce((n, o) => n + o.matched, 0);
  const errors = outcomes.flatMap((o) => o.errors);
  revalidatePath("/crm/campaigns/queue");
  if (errors.length) return { ok: false, message: errors[0] };
  return {
    ok: true,
    message: outcomes.length === 0
      ? "No live campaigns, so nothing to sweep."
      : `${matched} matched, ${queued} newly queued.`,
    data: { queued, matched },
  };
}

/**
 * Approve one message and send it.
 *
 * The guard chain runs again HERE, against the customer as they are in this
 * second — not as they were when the sweep queued them. Someone who accepted a
 * quote an hour ago gets nothing, and that is the entire point of approving at
 * send time rather than at enrolment.
 */
export async function approveAndSend(messageId: string): Promise<CampaignResult> {
  if (!uuid.safeParse(messageId).success) return { ok: false, message: "That isn't a message." };

  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();

  const { data: msg } = await supabase.from("campaign_messages")
    .select("id, account_id, template_id, step, state, send_key, enrolment_id, channel")
    .eq("id", messageId).maybeSingle();
  if (!msg) return { ok: false, message: "That message is gone." };
  if (msg.state === "sent") return { ok: false, message: "Already sent." };

  const isSms = (msg.channel as string) === "sms";
  const [{ data: account }, tpl, { data: profileRow }] = await Promise.all([
    supabase.from("accounts")
      .select("id, name, email, phone, snoozed_until, marketing_unsubscribed_at, marketing_undeliverable_at")
      .eq("id", msg.account_id).maybeSingle(),
    supabase.from("campaign_templates")
      .select("id, name, subject, preheader, blocks, approved_at, kind, sms_body").eq("id", msg.template_id ?? "").maybeSingle(),
    supabase.from("settings").select("value").eq("key", "company_profile").maybeSingle(),
  ]);
  // Pre-migration-20261212: the SMS columns aren't there, but approving an
  // EMAIL must keep working while they wait.
  const template = tpl.data ?? (tpl.error && /kind|sms_body/.test(tpl.error.message)
    ? (await supabase.from("campaign_templates")
        .select("id, name, subject, preheader, blocks, approved_at").eq("id", msg.template_id ?? "").maybeSingle()).data
    : null);
  if (!account) return { ok: false, message: "That customer is gone." };
  if (!template) return { ok: false, message: `The ${isSms ? "text" : "email"} for this step is missing.` };
  // A queued text pointed at an email template (or vice versa) is a wiring
  // mistake — refuse loudly rather than send the wrong shape.
  const templateKind = (template as { kind?: string }).kind === "sms" ? "sms" : "email";
  if ((templateKind === "sms") !== isSms) {
    return { ok: false, message: "This step's channel and its template don't match — fix the campaign's step." };
  }

  const { templateSchema: schema } = await import("@/lib/campaigns/blocks");
  const parsed = isSms
    ? null
    : schema.safeParse({
        subject: template.subject ?? "", preheader: template.preheader ?? "",
        blocks: Array.isArray(template.blocks) ? template.blocks : [],
      });
  if (!isSms && (!parsed?.success || parsed.data.blocks.length === 0)) {
    return { ok: false, message: "That email isn't finished." };
  }
  const smsBody = String((template as { sms_body?: string }).sms_body ?? "").trim();
  if (isSms && !smsBody) return { ok: false, message: "That text has nothing in it." };

  // Re-ask every question, now.
  const { loadSubjects } = await import("@/lib/crm/loadSubjects");
  const { evaluateSegment } = await import("@/lib/crm/segments");
  const { getSegment: lookupSegment } = await import("@/lib/crm/segmentsStore");
  const { guardSend, DEFAULT_POLICY } = await import("@/lib/campaigns/guard");

  const now = new Date();
  const subjects = await loadSubjects(supabase, now);
  const subject = subjects.find((s) => s.accountId === msg.account_id);

  const { data: enrolment } = await supabase.from("campaign_enrolments")
    .select("campaign_id, enrolled_at").eq("id", msg.enrolment_id).maybeSingle();
  const { data: campaign } = await supabase.from("campaigns")
    .select("key, name, segment_key").eq("id", enrolment?.campaign_id ?? "").maybeSingle();
  const segment = campaign?.segment_key ? await lookupSegment(supabase, campaign.segment_key as string) : null;
  const stillInSegment = segment && subject
    ? evaluateSegment([subject], segment, now).length === 1
    : false;

  const melbourneHour = Number(new Intl.DateTimeFormat("en-AU", { timeZone: "Australia/Melbourne", hour: "numeric", hour12: false }).format(now));
  const melbourneDay = new Date(now.toLocaleString("en-US", { timeZone: "Australia/Melbourne" })).getDay();

  const verdict = guardSend(
    { sendKey: msg.send_key as string, accountId: msg.account_id as string,
      campaignKey: campaign?.key ?? "", channel: isSms ? "sms" : "email",
      enrolledAt: (enrolment?.enrolled_at as string) ?? now.toISOString() },
    {
      unsubscribed: account.marketing_unsubscribed_at != null,
      stillInSegment,
      hasOpenWork: subject?.hasOpenWork ?? false,
      acceptedSince: subject?.acceptedAt ?? null,
      snoozedUntil: account.snoozed_until as string | null,
      lastMarketingAt: subject?.lastMarketingAt ?? null,
      undeliverable: account.marketing_undeliverable_at != null,
    },
    // A person is approving it right now, so that box is ticked; every other
    // check still has to pass.
    { templateApproved: template.approved_at != null, humanApproved: true, alreadySent: msg.state === "sent" },
    DEFAULT_POLICY, now, melbourneHour, melbourneDay,
  );

  if (!verdict.send) {
    await supabase.from("campaign_messages")
      .update({ state: verdict.hold ? "held" : "stopped", reason: verdict.reason }).eq("id", messageId);
    revalidatePath("/crm/campaigns/queue");
    return { ok: false, message: verdict.hold ? `Held — ${verdict.reason}` : `Not sent — ${verdict.reason}` };
  }

  const { sendCampaignEmail, resolveRecipientLinks } = await import("@/lib/campaigns/send");
  const company = (profileRow?.value ?? {}) as { name?: string; logoUrl?: string };
  // {{estimate}} / {{account}} land on THIS person's pages, either channel.
  const links = await resolveRecipientLinks(supabase, account.id as string);
  let sent: { ok: true; id: string } | { ok: false; error: string };
  if (isSms) {
    const { sendCampaignSms } = await import("@/lib/campaigns/sms");
    sent = await sendCampaignSms({
      toRawPhone: account.phone as string | null,
      body: smsBody,
      links: { estimateUrl: links.estimateUrl, accountUrl: links.accountUrl },
      companyName: company.name || "Paint Group",
    });
  } else if (parsed?.success) {
    sent = await sendCampaignEmail({
      to: account.email as string,
      accountId: account.id as string,
      template: parsed.data,
      brand: { companyName: company.name || "Paint Group", logoUrl: company.logoUrl || null },
      links,
    });
  } else {
    // Unreachable — the email path already returned on a failed parse — but
    // the compiler cannot see across the early return, and a typed dead end
    // beats a non-null assertion.
    sent = { ok: false, error: "That email isn't finished." };
  }
  if (!sent.ok) {
    await supabase.from("campaign_messages").update({ state: "failed", reason: sent.error }).eq("id", messageId);
    revalidatePath("/crm/campaigns/queue");
    return { ok: false, message: sent.error };
  }

  await supabase.from("campaign_messages").update({
    state: "sent", sent_at: now.toISOString(), reason: null,
    approved_at: now.toISOString(), approved_by: user?.id ?? null,
  }).eq("id", messageId);

  // The timeline must show it, or the office will not know it happened.
  const { buildEvent, dedupeKey } = await import("@/lib/crm/events");
  await supabase.rpc("crm_log_event", buildEvent({
    type: "campaign_message_sent",
    accountId: account.id as string,
    source: "staff",
    payload: { campaignKey: campaign?.key ?? "campaign", step: (msg.step as number) ?? 1, channel: isSms ? "sms" : "email" },
    dedupeKey: dedupeKey("sent", msg.send_key as string),
  }));

  revalidatePath("/crm/campaigns/queue");
  return { ok: true, message: `Sent to ${isSms ? (account.phone as string) : (account.email as string)}.` };
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
