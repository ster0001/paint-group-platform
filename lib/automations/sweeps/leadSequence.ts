/**
 * The lead sequence sweep, L1–L3, L5–L7 and L10's customer chat (automations brief §4). SERVER ONLY, service
 * client, off the half-hour campaign sweep (`?only=leads` is the hand run).
 *
 * Candidates are wizard leads with a range page (A‑F: an unsent draft holding
 * `lead_snapshot` and a share token). Each is staged by the one stage engine
 * (lib/crm/estimateStageLoad.ts), and `leadStepsDue` says what is due. Every
 * step is CLAIMED before it goes (automation_claims), so two sweeps never
 * double up, and goes through `sendAutomation` — the switch (all three ship
 * off, ruling A‑D), STOP and declined permits (A‑E, `consent: "marketing"`)
 * and quiet hours for the text (A‑N) all apply there.
 *
 * R1: the chat steps are a message on the lead's own chat, in the estimator's
 * name, with an email notification from the brand that carries the words and
 * the link. The chat row is written only when the email went (or the server
 * has no email configured); a STOP or a failed send leaves no message the
 * customer was never told about.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import { automationByKey } from "../registry";
import { outcomeWord, sendAutomation } from "../dispatch";
import { claimRung } from "../reminders";
import { timingFor } from "../decide";
import { LEAD_STEPS, conversationAt, leadRangeWords, leadStepsDue, streetOf, type LeadStep, type LeadStepKey } from "../leadSequence";
import { loadMessaging } from "@/lib/messaging/load";
import { automationOn, normalisePhoneAU, renderTemplate, type MessagingSettings } from "@/lib/messaging/config";
import { buildChatEmailHtml } from "@/lib/messaging/send";
import { emailLogoUrl } from "@/lib/messaging/logo";
import { brandRecord, companyForBrand, fromForBrand, messageBrandOf, publicOriginFor } from "@/lib/messaging/brand";
import { siteUrl } from "@/lib/invoicing/pdf";
import { isTestEmail } from "@/lib/accounts/identity";
import { parseLeadSnapshot, type LeadSnapshot } from "@/lib/estimate/leadSnapshot";
import { loadEstimateStages, STAGE_DRAFT_COLUMNS, type StageDraftRow, type StageEstimateRow } from "@/lib/crm/estimateStageLoad";
import { realOnly } from "@/lib/demo/scope";
import { BOOKING_RULES_KEY, mergeBookingRules } from "@/lib/visits/schedule";
import { dueWords } from "@/lib/staff/requestAlertRules";
import { reportError } from "@/lib/monitoring/report";

export type LeadSequenceResult = { candidates: number; due: number; sent: Record<LeadStepKey, number>; skipped: number; error?: string };

/** The longest a lead can still have a step due: L3 at its longest plus its lateness. */
const LOOKBACK_DAYS = 23;

type LeadRow = StageEstimateRow & {
  brand: string | null; share_token: string | null; lead_snapshot: unknown;
  contact_email: string | null; contact_phone: string | null;
};

export async function runLeadSequenceSweep(db: SupabaseClient, now = new Date()): Promise<LeadSequenceResult> {
  const out: LeadSequenceResult = { candidates: 0, due: 0, sent: Object.fromEntries(LEAD_STEPS.map((s) => [s.key, 0])) as Record<LeadStepKey, number>, skipped: 0 };
  try {
    const { messaging, company } = await loadMessaging(db);
    const enabled = new Map<LeadStepKey, number>();
    for (const step of LEAD_STEPS) {
      const a = automationByKey(step.key);
      if (a && automationOn(messaging, step.key)) enabled.set(step.key, timingFor(a, messaging, "after"));
    }
    if (enabled.size === 0) return out;

    const since = new Date(now.getTime() - LOOKBACK_DAYS * 86_400_000).toISOString();
    const { data, error } = await realOnly(db.from("estimates")
      .select("id, title, status, created_at, sent_at, valid_until, accepted_at, declined_at, account_id, brand, share_token, lead_snapshot, contact_email:builder_state->contact->>email, contact_phone:builder_state->contact->>phone"))
      .eq("status", "draft").is("sent_at", null).not("lead_snapshot", "is", null).not("share_token", "is", null)
      .gte("created_at", since).order("created_at", { ascending: false }).limit(300);
    if (error) throw error;
    const leads = (data ?? []) as unknown as LeadRow[];
    out.candidates = leads.length;
    if (leads.length === 0) return out;

    const ids = leads.map((l) => l.id);
    const [drafts, claims, chat, rules, requests] = await Promise.all([
      // wizard_drafts carries no demo flag; the estimates read above is already realOnly.
      db.from("wizard_drafts").select(STAGE_DRAFT_COLUMNS).in("estimate_id", ids),
      // Every lead key's claims, switched on or not: an L2 sent before L2 was switched off still marks its own chat row.
      db.from("automation_claims").select("automation_key, entity_id, claimed_at").in("automation_key", LEAD_STEPS.map((s) => s.key)).in("entity_id", ids),
      db.from("estimate_messages").select("estimate_id, direction, created_at").in("estimate_id", ids).order("created_at"),
      // L10: office days skip the Settings holidays, and {{due}} is the open request's reply-by.
      db.from("settings").select("value").eq("key", BOOKING_RULES_KEY).maybeSingle(),
      db.from("visit_requests").select("estimate_id, due_at, created_at").in("estimate_id", ids).is("answered_at", null).order("created_at", { ascending: false }),
    ]);
    if (drafts.error) throw drafts.error;
    if (claims.error) throw claims.error;
    if (chat.error) throw chat.error;
    if (rules.error) throw rules.error;
    if (requests.error) throw requests.error;
    const holidays = new Set(mergeBookingRules(rules.data?.value).publicHolidays);
    const dueOf = new Map<string, string>();
    for (const r of (requests.data ?? []) as { estimate_id: string; due_at: string }[]) if (!dueOf.has(r.estimate_id)) dueOf.set(r.estimate_id, r.due_at);
    const draftOf = new Map<string, StageDraftRow>();
    for (const d of (drafts.data ?? []) as unknown as StageDraftRow[]) if (d.estimate_id && !draftOf.has(d.estimate_id)) draftOf.set(d.estimate_id, d);
    const claimedOf = new Map<string, Set<string>>();
    const claimTimesOf = new Map<string, string[]>();
    for (const c of (claims.data ?? []) as { automation_key: string; entity_id: string; claimed_at: string }[]) {
      claimedOf.set(c.entity_id, (claimedOf.get(c.entity_id) ?? new Set()).add(c.automation_key));
      claimTimesOf.set(c.entity_id, [...(claimTimesOf.get(c.entity_id) ?? []), c.claimed_at]);
    }
    const chatOf = new Map<string, { direction: string; created_at: string }[]>();
    for (const m of (chat.data ?? []) as { estimate_id: string; direction: string; created_at: string }[]) chatOf.set(m.estimate_id, [...(chatOf.get(m.estimate_id) ?? []), m]);

    const staged = await loadEstimateStages(db, leads.map((l) => ({ estimate: l, draft: draftOf.get(l.id) ?? null })), now);
    if (!staged.ok) throw new Error(staged.error);

    for (const lead of leads) {
      const stage = staged.stages.get(lead.id)?.result ?? null;
      const stageSince = stage?.since ?? null;
      const due = leadStepsDue({
        stage: stage?.stage ?? null, since: stageSince, claimed: claimedOf.get(lead.id) ?? new Set(),
        conversationAt: conversationAt(chatOf.get(lead.id) ?? [], stageSince, claimTimesOf.get(lead.id) ?? []),
      }, now, enabled, holidays);
      const snap = parseLeadSnapshot(lead.lead_snapshot);
      for (const step of due) {
        out.due += 1;
        if (!snap || !lead.share_token || (lead.contact_email && isTestEmail(lead.contact_email))) { out.skipped += 1; continue; }
        // Claim BEFORE sending, so two sweeps at once never double up.
        if (!(await claimRung(db, step.key, lead.id, ""))) continue;
        const ok = await sendStep(db, { step, lead, snap, messaging, company, now, dueAt: dueOf.get(lead.id) ?? null });
        if (ok) out.sent[step.key] += 1; else out.skipped += 1;
      }
    }
  } catch (err) {
    out.error = err instanceof Error ? err.message : String(err);
    reportError(err, { where: "automations.leadSequence" });
  }
  return out;
}

/** Each step's wording (Settings → Automations; the defaults are Appendix A). */
type SmsKey = "lead_range_reminder" | "lead_tighten_resume" | "lead_tightened_close";
type ChatKey = Exclude<LeadStepKey, SmsKey>;
const SMS_TEMPLATE: Record<SmsKey, (m: MessagingSettings) => string> = {
  lead_range_reminder: (m) => m.leadRangeReminderSms,
  lead_tighten_resume: (m) => m.leadTightenResumeSms,
  lead_tightened_close: (m) => m.leadTightenedCloseSms,
};
const CHAT_TEMPLATE: Record<ChatKey, (m: MessagingSettings) => [string, string]> = {
  lead_range_nudge: (m) => [m.leadRangeNudgeSubject, m.leadRangeNudgeBody],
  lead_range_human: (m) => [m.leadRangeHumanSubject, m.leadRangeHumanBody],
  lead_tighten_help: (m) => [m.leadTightenHelpSubject, m.leadTightenHelpBody],
  lead_visit_request_ack: (m) => [m.leadVisitAckSubject, m.leadVisitAckBody],
};

async function sendStep(db: SupabaseClient, i: {
  step: LeadStep; lead: LeadRow; snap: LeadSnapshot;
  messaging: MessagingSettings; company: Awaited<ReturnType<typeof loadMessaging>>["company"]; now: Date;
  /** L10: the open visit request's reply-by. */
  dueAt: string | null;
}): Promise<boolean> {
  const { step, lead, snap, messaging } = i;
  const brand = messageBrandOf(lead.brand);
  const co = companyForBrand(i.company, brand);
  const estimator = (i.company.estimatorName ?? "").trim().split(/\s+/)[0] || "The team";
  const link = `${publicOriginFor(brand, siteUrl())}/e/${lead.share_token}`;
  const vars = {
    first_name: snap.firstName || "there",
    estimator,
    brand: brandRecord(brand).name,
    address: streetOf(snap.address) || "your place",
    range: leadRangeWords(snap.rangeLoCents, snap.rangeHiCents),
    link,
    due: i.dueAt ? dueWords(i.dueAt) : "the end of the next working day",
  };
  const ctx = { estimateId: lead.id, accountId: lead.account_id };

  if (step.channel === "sms") {
    const phone = lead.contact_phone ? normalisePhoneAU(lead.contact_phone) : null;
    if (!phone) return false;
    const o = await sendAutomation(db, { key: step.key, to: { phone }, sms: { body: renderTemplate(SMS_TEMPLATE[step.key as SmsKey](messaging), vars) }, ctx, now: i.now });
    const word = outcomeWord(o);
    return word === "sent" || word === "not_configured" || o.outcome === "held";
  }

  const email = lead.contact_email?.trim() || null;
  if (!email) return false;
  const [subjectT, bodyT] = CHAT_TEMPLATE[step.key as ChatKey](messaging);
  const body = renderTemplate(bodyT, vars);
  const o = await sendAutomation(db, {
    key: step.key, to: { email },
    email: {
      subject: renderTemplate(subjectT, vars),
      html: buildChatEmailHtml({ message: body, link: `${link}#chat`, companyName: co.name || brandRecord(brand).name, logoUrl: emailLogoUrl(co), estimatorName: i.company.estimatorName || undefined, companyPhone: co.phone || undefined }),
      from: fromForBrand(brand),
    },
    ctx, now: i.now,
  });
  const word = outcomeWord(o);
  if (word !== "sent" && word !== "not_configured") return false;
  // The message itself, on the lead's chat, in the estimator's name.
  const { error } = await db.from("estimate_messages").insert({ estimate_id: lead.id, direction: "staff", body, author_name: estimator === "The team" ? null : estimator });
  if (error) { reportError(error, { where: "automations.leadSequence.chatRow", extra: { estimateId: lead.id, key: step.key } }); return false; }
  return true;
}
