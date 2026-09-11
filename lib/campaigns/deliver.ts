/**
 * Delivering ONE queued campaign message (P5). SERVER ONLY.
 *
 * The queue's "Approve & send", "Approve all", and the sweep's auto-send all
 * come through here — one path, so the guard chain is asked the same way
 * whoever pressed the button. It re-reads the customer as they are in THIS
 * second (refreshing a stale facts row first), asks `guardSend`, and only
 * then personalises, tracks the links and hands the message to the sender.
 *
 * Verdicts land on the row in the words the office reads: held (with the
 * approval remembered, so the sweep sends it in the window), stopped (this
 * step, or the whole enrolment when the customer has answered), sent, failed.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import { DEFAULT_POLICY, guardSend, type CampaignClass, type CampaignRules, type CustomerState, type ExitRule, type GuardVerdict, type SendCandidate, type StepCondition } from "./guard";
import { fillTokens, personaliseTemplate, recipientTokens } from "./personalise";
import { refreshAccountFacts } from "@/lib/crm/facts";
import { matchesAudience } from "@/lib/crm/audience";
import { getSegment } from "@/lib/crm/segmentsStore";
import { delayHolds } from "@/lib/crm/states";
import { buildEvent, dedupeKey } from "@/lib/crm/events";

export type DeliverOptions = {
  /** A person pressed approve (or did so earlier — approved_at on the row). */
  humanApproved: boolean;
  approvedBy?: string | null;
  now?: Date;
  baseUrl?: string;
};

export type DeliverResult =
  | { ok: true; state: "sent"; message: string }
  | { ok: false; state: "held" | "stopped" | "failed" | "error"; message: string; verdict?: GuardVerdict };

/** Melbourne's hour and weekday, for the C11 window. */
export function melbourneClock(now: Date): { hour: number; day: number } {
  const hour = Number(new Intl.DateTimeFormat("en-AU", { timeZone: "Australia/Melbourne", hour: "numeric", hour12: false }).format(now)) % 24;
  const day = new Date(now.toLocaleString("en-US", { timeZone: "Australia/Melbourne" })).getDay();
  return { hour, day };
}

type FactsRow = {
  account_id: string; name: string | null; email: string | null; phone: string | null; stage: string;
  relationship_state: string; state_until: string | null; permit_email: string; permit_sms: string;
  snoozed_until: string | null; last_accepted_at: string | null; last_declined_at: string | null;
  last_opened_at: string | null; last_inbound_at: string | null; last_inbound_call_at: string | null;
  last_staff_contact_at: string | null; stale: boolean;
};

const FACTS_COLS = "account_id, name, email, phone, stage, relationship_state, state_until, permit_email, permit_sms, snoozed_until, last_accepted_at, last_declined_at, last_opened_at, last_inbound_at, last_inbound_call_at, last_staff_contact_at, stale";

/** The facts row, fresh. A stale row is recomputed first — the guard must not read yesterday. */
export async function freshFacts(db: SupabaseClient, accountId: string, now: Date): Promise<FactsRow | null> {
  const { data } = await db.from("crm_account_facts").select(FACTS_COLS).eq("account_id", accountId).maybeSingle();
  if (data && !data.stale) return data as FactsRow;
  await refreshAccountFacts(db, [accountId], now);
  // A different column order: Next memoises a byte-identical read within one request.
  const { data: again } = await db.from("crm_account_facts").select(`stale, ${FACTS_COLS.replace(", stale", "")}`).eq("account_id", accountId).maybeSingle();
  return (again as FactsRow | null) ?? null;
}

export async function lastMarketingAt(db: SupabaseClient, accountId: string): Promise<string | null> {
  const { data } = await db.from("campaign_messages")
    .select("sent_at, campaigns!inner(class)")
    .eq("account_id", accountId).eq("state", "sent").eq("campaigns.class", "marketing")
    .order("sent_at", { ascending: false }).limit(1);
  return (data?.[0]?.sent_at as string | undefined) ?? null;
}

export function customerStateFrom(
  facts: FactsRow,
  account: { marketing_unsubscribed_at: string | null; marketing_undeliverable_at: string | null; email: string | null; phone: string | null },
  channel: "email" | "sms",
  stillInAudience: boolean,
  lastMarketing: string | null,
  now: Date,
): CustomerState {
  return {
    permit: ((channel === "sms" ? facts.permit_sms : facts.permit_email) as CustomerState["permit"]) ?? "unknown",
    unsubscribed: account.marketing_unsubscribed_at != null,
    undeliverable: account.marketing_undeliverable_at != null,
    reachable: channel === "sms" ? !!(account.phone ?? facts.phone) : !!(account.email ?? facts.email),
    relationshipState: facts.relationship_state ?? "active",
    stateHolding: delayHolds(facts.relationship_state, facts.state_until, now),
    stillInAudience,
    hasOpenWork: facts.stage === "job_on",
    lastAcceptedAt: facts.last_accepted_at,
    lastDeclinedAt: facts.last_declined_at,
    lastOpenedAt: facts.last_opened_at,
    lastInboundAt: facts.last_inbound_at,
    lastInboundCallAt: facts.last_inbound_call_at,
    lastStaffContactAt: facts.last_staff_contact_at,
    snoozedUntil: facts.snoozed_until,
    lastMarketingAt: lastMarketing,
  };
}

/** The enrolment is over: mark it, and stop anything else of its still waiting. */
export async function finishEnrolment(db: SupabaseClient, enrolmentId: string, reason: string, now: Date): Promise<void> {
  await db.from("campaign_enrolments").update({ finished_at: now.toISOString(), finished_reason: reason }).eq("id", enrolmentId).is("finished_at", null);
  await db.from("campaign_messages").update({ state: "stopped", reason }).eq("enrolment_id", enrolmentId).in("state", ["queued", "held"]);
}

export async function deliverMessage(db: SupabaseClient, messageId: string, opts: DeliverOptions): Promise<DeliverResult> {
  const now = opts.now ?? new Date();
  const { data: msg } = await db.from("campaign_messages")
    .select("id, account_id, template_id, step, state, send_key, enrolment_id, channel, campaign_id, condition, approved_at")
    .eq("id", messageId).maybeSingle();
  if (!msg) return { ok: false, state: "error", message: "That message is gone." };
  if (msg.state === "sent") return { ok: false, state: "error", message: "Already sent." };
  if (msg.state === "stopped" || msg.state === "failed") return { ok: false, state: "error", message: `Already dealt with — it was ${msg.state}.` };

  const isSms = (msg.channel as string) === "sms";
  const [{ data: campaign }, { data: enrolment }, { data: account }, tpl, { data: profileRow }] = await Promise.all([
    db.from("campaigns").select("id, key, name, class, entry, segment_key, exit_rules, auto_send, status, steps").eq("id", msg.campaign_id ?? "").maybeSingle(),
    db.from("campaign_enrolments").select("id, enrolled_at, anchor_at, anchor_key, finished_at").eq("id", msg.enrolment_id).maybeSingle(),
    db.from("accounts").select("id, name, email, phone, marketing_unsubscribed_at, marketing_undeliverable_at").eq("id", msg.account_id).maybeSingle(),
    db.from("campaign_templates").select("id, name, subject, preheader, blocks, approved_at, kind, sms_body").eq("id", msg.template_id ?? "").maybeSingle(),
    db.from("settings").select("value").eq("key", "company_profile").maybeSingle(),
  ]);
  if (!campaign || !enrolment) return { ok: false, state: "error", message: "That campaign is gone." };
  if (!account) return { ok: false, state: "error", message: "That customer is gone." };
  const template = tpl.data;
  if (!template) return { ok: false, state: "error", message: `The ${isSms ? "text" : "email"} for this step is missing.` };
  const templateKind = (template as { kind?: string }).kind === "sms" ? "sms" : "email";
  if ((templateKind === "sms") !== isSms) {
    return { ok: false, state: "error", message: "This step's channel and its template don't match — fix the campaign's step." };
  }

  const { templateSchema } = await import("./blocks");
  const parsed = isSms ? null : templateSchema.safeParse({
    subject: template.subject ?? "", preheader: template.preheader ?? "",
    blocks: Array.isArray(template.blocks) ? template.blocks : [],
  });
  if (!isSms && (!parsed?.success || parsed.data.blocks.length === 0)) return { ok: false, state: "error", message: "That email isn't finished." };
  const smsBody = String((template as { sms_body?: string }).sms_body ?? "").trim();
  if (isSms && !smsBody) return { ok: false, state: "error", message: "That text has nothing in it." };

  // The customer, now.
  const facts = await freshFacts(db, msg.account_id as string, now);
  if (!facts) return { ok: false, state: "error", message: "No facts row for this customer yet — run the CRM sweep." };
  let stillInAudience = true;
  if (campaign.entry === "audience") {
    const segment = campaign.segment_key ? await getSegment(db, campaign.segment_key as string) : null;
    stillInAudience = segment && !segment.invalid ? await matchesAudience(db, segment.audience, msg.account_id as string) : false;
  }
  const lastMarketing = campaign.class === "marketing" ? await lastMarketingAt(db, msg.account_id as string) : null;

  const rules: CampaignRules = {
    class: (campaign.class as CampaignClass) ?? "marketing",
    entry: campaign.entry === "event" ? "event" : "audience",
    exitRules: ((campaign.exit_rules as string[] | null) ?? []) as ExitRule[],
  };
  const candidate: SendCandidate = {
    sendKey: msg.send_key as string, accountId: msg.account_id as string, campaignKey: campaign.key as string,
    channel: isSms ? "sms" : "email",
    enrolledAt: (enrolment.enrolled_at as string) ?? now.toISOString(),
    anchorAt: (enrolment.anchor_at as string) ?? (enrolment.enrolled_at as string) ?? now.toISOString(),
    step: (msg.step as number) ?? 1,
    condition: ((msg.condition as string) ?? "none") as StepCondition,
  };
  const customer = customerStateFrom(facts, account as never, candidate.channel, stillInAudience, lastMarketing, now);
  const humanApproved = opts.humanApproved || msg.approved_at != null;
  const { hour, day } = melbourneClock(now);
  const verdict = guardSend(
    candidate, customer,
    { templateApproved: template.approved_at != null, humanApproved, alreadySent: msg.state === "sent" },
    rules, { ...DEFAULT_POLICY, autoSend: campaign.auto_send === true }, now, hour, day,
  );

  const stamp = { judged_at: now.toISOString() };
  if (!verdict.send) {
    if (verdict.exit) {
      await db.from("campaign_messages").update({ state: "stopped", reason: verdict.reason, ...stamp }).eq("id", messageId);
      await finishEnrolment(db, enrolment.id as string, verdict.reason, now);
      return { ok: false, state: "stopped", message: `Not sent — ${verdict.reason} They're out of the campaign.`, verdict };
    }
    if (verdict.hold) {
      await db.from("campaign_messages").update({
        state: "held", reason: verdict.reason, ...stamp,
        ...(opts.humanApproved && !msg.approved_at ? { approved_at: now.toISOString(), approved_by: opts.approvedBy ?? null } : {}),
      }).eq("id", messageId);
      return { ok: false, state: "held", message: `${opts.humanApproved ? "Approved — held" : "Held"}: ${verdict.reason}${opts.humanApproved ? " It goes out on its own when it can." : ""}`, verdict };
    }
    await db.from("campaign_messages").update({ state: "stopped", reason: verdict.reason, ...stamp }).eq("id", messageId);
    return { ok: false, state: "stopped", message: `Not sent — ${verdict.reason}`, verdict };
  }

  // Send.
  const { sendCampaignEmail, resolveRecipientLinks } = await import("./send");
  const company = (profileRow?.value ?? {}) as { name?: string; logoUrl?: string; logoUrlLight?: string };
  const companyName = company.name || "Paint Group";
  const [links, tokens] = await Promise.all([
    resolveRecipientLinks(db, account.id as string, opts.baseUrl),
    recipientTokens(db, account.id as string, companyName),
  ]);
  let sent: { ok: true; id: string } | { ok: false; error: string };
  if (isSms) {
    const { sendCampaignSms } = await import("./sms");
    sent = await sendCampaignSms({
      toRawPhone: (account.phone as string | null) ?? facts.phone,
      body: fillTokens(smsBody, tokens),
      links: { estimateUrl: links.estimateUrl, accountUrl: links.accountUrl },
      companyName,
      ctx: { accountId: account.id as string, campaignMessageId: messageId },
    });
  } else if (parsed?.success) {
    sent = await sendCampaignEmail({
      to: (account.email as string | null) ?? (facts.email as string),
      accountId: account.id as string,
      template: personaliseTemplate(parsed.data, tokens),
      // White card → the light-background logo (the black wordmark).
      brand: { companyName, logoUrl: company.logoUrlLight || company.logoUrl || null },
      links,
      campaignMessageId: messageId,
      baseUrl: opts.baseUrl,
    });
  } else {
    sent = { ok: false, error: "That email isn't finished." };
  }

  if (!sent.ok) {
    await db.from("campaign_messages").update({ state: "failed", reason: sent.error, ...stamp }).eq("id", messageId);
    return { ok: false, state: "failed", message: sent.error };
  }

  await db.from("campaign_messages").update({
    state: "sent", sent_at: now.toISOString(), reason: null, ...stamp,
    approved_at: msg.approved_at ?? now.toISOString(),
    approved_by: msg.approved_at ? undefined : (opts.approvedBy ?? null),
  }).eq("id", messageId);

  // The last step sent finishes the enrolment — the stats read that.
  const steps = Array.isArray(campaign.steps) ? (campaign.steps as Array<{ step: number }>) : [];
  const lastStep = steps.reduce((m, s) => Math.max(m, Number(s.step) || 0), 0);
  if ((msg.step as number) >= lastStep) {
    await db.from("campaign_enrolments").update({ finished_at: now.toISOString(), finished_reason: "Finished every step." })
      .eq("id", enrolment.id as string).is("finished_at", null);
  }

  // The timeline must show it, or the office will not know it happened.
  await db.rpc("crm_log_event", buildEvent({
    type: "campaign_message_sent",
    accountId: account.id as string,
    source: opts.humanApproved ? "staff" : "system",
    payload: { campaignKey: campaign.key as string, step: (msg.step as number) ?? 1, channel: isSms ? "sms" : "email" },
    dedupeKey: dedupeKey("sent", msg.send_key as string),
  }));

  return { ok: true, state: "sent", message: `Sent to ${isSms ? ((account.phone as string) ?? facts.phone) : ((account.email as string) ?? facts.email)}.` };
}
