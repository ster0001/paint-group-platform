/**
 * The estimate sequence sweep, E2–E7 and E9–E12 (automations brief §4.3). SERVER ONLY,
 * service client, off the half-hour campaign sweep (`?only=estimates` is the
 * hand run).
 *
 * Candidates are sent estimates with a share token (the customer's /e page).
 * Each is staged by the one stage engine; `sequenceStepsDue` says what is
 * due; every step is CLAIMED first (automation_claims) and goes through
 * `sendAutomation` — the switch (all ship off, A‑D), STOP and declined
 * permits (`consent: "marketing"`, A‑E) and quiet hours for the text (A‑N).
 * The chat steps are a message on the estimate's own chat in the estimator's
 * name, with the email that carries it (R1), written only when the email went.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import { automationByKey } from "../registry";
import { outcomeWord, sendAutomation } from "../dispatch";
import { claimRung } from "../reminders";
import { timingFor } from "../decide";
import { conversationAt, sequenceStepsDue, streetOf } from "../leadSequence";
import { ESTIMATE_STEPS, expiryWarningDue, expiryWords, type EstimateStep, type EstimateStepKey } from "../estimateSequence";
import { declineReasonMissing, isTimingReason, reasonLinks } from "@/lib/estimate/declineReason";
import { loadMessaging } from "@/lib/messaging/load";
import { automationOn, normalisePhoneAU, renderTemplate, type MessagingSettings } from "@/lib/messaging/config";
import { buildChatEmailHtml } from "@/lib/messaging/send";
import { emailLogoUrl } from "@/lib/messaging/logo";
import { brandRecord, companyForBrand, fromForBrand, messageBrandOf, publicOriginFor } from "@/lib/messaging/brand";
import { siteUrl } from "@/lib/invoicing/pdf";
import { isTestEmail } from "@/lib/accounts/identity";
import { loadEstimateStages, type StageEstimateRow } from "@/lib/crm/estimateStageLoad";
import { realOnly } from "@/lib/demo/scope";
import { reportError } from "@/lib/monitoring/report";

export type EstimateSequenceResult = { candidates: number; due: number; sent: Record<EstimateStepKey | "estimate_expiry_warning", number>; skipped: number; error?: string };

/** E7 at its longest after the first open, plus a fortnight for the open itself. */
const LOOKBACK_DAYS = 60;
/** E12 at its longest: 60 days after the decline, a day late, and the timing setting's max. */
const DECLINED_LOOKBACK_DAYS = 125;

type Row = StageEstimateRow & {
  brand: string | null; share_token: string | null;
  sent_snapshot: { contactName?: string; contactEmail?: string; jobAddress?: string } | null;
  declined_reason: string | null;
  contact_name: string | null; contact_email: string | null; contact_phone: string | null;
};

export async function runEstimateSequenceSweep(db: SupabaseClient, now = new Date()): Promise<EstimateSequenceResult> {
  const out: EstimateSequenceResult = { candidates: 0, due: 0, sent: Object.fromEntries([...ESTIMATE_STEPS.map((s) => [s.key, 0]), ["estimate_expiry_warning", 0]]) as EstimateSequenceResult["sent"], skipped: 0 };
  try {
    const { messaging, company } = await loadMessaging(db);
    const enabled = new Map<EstimateStepKey, number>();
    for (const step of ESTIMATE_STEPS) {
      const a = automationByKey(step.key);
      if (a && automationOn(messaging, step.key)) enabled.set(step.key, timingFor(a, messaging, "after"));
    }
    const warnA = automationByKey("estimate_expiry_warning");
    const warnDays = warnA && automationOn(messaging, "estimate_expiry_warning") ? timingFor(warnA, messaging, "before") : null;
    if (enabled.size === 0 && warnDays == null) return out;

    const since = new Date(now.getTime() - LOOKBACK_DAYS * 86_400_000).toISOString();
    const declinedSince = new Date(now.getTime() - DECLINED_LOOKBACK_DAYS * 86_400_000).toISOString();
    const { data, error } = await realOnly(db.from("estimates")
      .select("id, title, status, created_at, sent_at, valid_until, accepted_at, declined_at, declined_reason, account_id, brand, share_token, sent_snapshot, contact_name:builder_state->contact->>name, contact_email:builder_state->contact->>email, contact_phone:builder_state->contact->>phone"))
      .in("status", ["sent", "expired", "declined"]).not("share_token", "is", null)
      .or(`sent_at.gte.${since},declined_at.gte.${declinedSince}`).order("sent_at", { ascending: false }).limit(500);
    if (error) throw error;
    const rows = (data ?? []) as unknown as Row[];
    out.candidates = rows.length;
    if (rows.length === 0) return out;

    const ids = rows.map((r) => r.id);
    const [claims, chat] = await Promise.all([
      db.from("automation_claims").select("automation_key, entity_id, claimed_at").in("automation_key", [...ESTIMATE_STEPS.map((s) => s.key), "estimate_expiry_warning"]).in("entity_id", ids),
      db.from("estimate_messages").select("estimate_id, direction, created_at").in("estimate_id", ids).order("created_at"),
    ]);
    if (claims.error) throw claims.error;
    if (chat.error) throw chat.error;
    const claimedOf = new Map<string, Set<string>>();
    const claimTimesOf = new Map<string, string[]>();
    for (const c of (claims.data ?? []) as { automation_key: string; entity_id: string; claimed_at: string }[]) {
      claimedOf.set(c.entity_id, (claimedOf.get(c.entity_id) ?? new Set()).add(c.automation_key));
      claimTimesOf.set(c.entity_id, [...(claimTimesOf.get(c.entity_id) ?? []), c.claimed_at]);
    }
    const chatOf = new Map<string, { direction: string; created_at: string }[]>();
    for (const m of (chat.data ?? []) as { estimate_id: string; direction: string; created_at: string }[]) chatOf.set(m.estimate_id, [...(chatOf.get(m.estimate_id) ?? []), m]);

    const staged = await loadEstimateStages(db, rows.map((r) => ({ estimate: r, draft: null })), now);
    if (!staged.ok) throw new Error(staged.error);

    for (const est of rows) {
      const stage = staged.stages.get(est.id)?.result ?? null;
      const claimed = claimedOf.get(est.id) ?? new Set<string>();
      const due = sequenceStepsDue(ESTIMATE_STEPS, {
        stage: stage?.stage ?? null, since: stage?.since ?? null, claimed,
        conversationAt: conversationAt(chatOf.get(est.id) ?? [], stage?.since ?? null, claimTimesOf.get(est.id) ?? []),
      }, now, enabled).filter((step) =>
        // E11 asks only a decline with no reason; E12 follows only "Postponing".
        step.key === "estimate_declined_reason" ? declineReasonMissing(est.declined_reason)
        : step.key === "estimate_declined_timing" ? isTimingReason(est.declined_reason)
        : true);
      const email = (est.contact_email || est.sent_snapshot?.contactEmail || "").trim() || null;
      // E9: a date offset, not a stage age — a text and a chat, claimed once.
      if (warnDays != null && !claimed.has("estimate_expiry_warning") && expiryWarningDue(est.valid_until, stage?.stage ?? null, now, warnDays)) {
        out.due += 1;
        if (!est.share_token || (email && isTestEmail(email))) out.skipped += 1;
        else if (await claimRung(db, "estimate_expiry_warning", est.id, "")) {
          const ok = await sendExpiryWarning(db, { est, email, messaging, company, now });
          if (ok) out.sent.estimate_expiry_warning += 1; else out.skipped += 1;
        }
      }
      for (const step of due) {
        out.due += 1;
        if (!est.share_token || (email && isTestEmail(email))) { out.skipped += 1; continue; }
        if (!(await claimRung(db, step.key, est.id, ""))) continue;
        const ok = await sendStep(db, { step, est, email, messaging, company, now });
        if (ok) out.sent[step.key] += 1; else out.skipped += 1;
      }
    }
  } catch (err) {
    out.error = err instanceof Error ? err.message : String(err);
    reportError(err, { where: "automations.estimateSequence" });
  }
  return out;
}

const CHAT: Record<Exclude<EstimateStepKey, "estimate_unopened">, (m: MessagingSettings) => [string, string]> = {
  estimate_expired_chat: (m) => [m.estimateExpiredSubject, m.estimateExpiredBody],
  estimate_declined_reason: (m) => [m.estimateDeclinedReasonSubject, m.estimateDeclinedReasonBody],
  estimate_declined_timing: (m) => [m.estimateDeclinedTimingSubject, m.estimateDeclinedTimingBody],
  estimate_unopened_again: (m) => [m.estimateUnopenedAgainSubject, m.estimateUnopenedAgainBody],
  estimate_viewed_any_q: (m) => [m.estimateViewedAnyQSubject, m.estimateViewedAnyQBody],
  estimate_viewed_worth: (m) => [m.estimateViewedWorthSubject, m.estimateViewedWorthBody],
  estimate_viewed_held: (m) => [m.estimateViewedHeldSubject, m.estimateViewedHeldBody],
};

type Ctx = { est: Row; email: string | null; messaging: MessagingSettings; company: Awaited<ReturnType<typeof loadMessaging>>["company"]; now: Date };

function varsFor(i: Ctx) {
  const brand = messageBrandOf(i.est.brand);
  const estimator = (i.company.estimatorName ?? "").trim().split(/\s+/)[0] || "The team";
  const origin = publicOriginFor(brand, siteUrl());
  const link = `${origin}/e/${i.est.share_token}`;
  const name = (i.est.sent_snapshot?.contactName || i.est.contact_name || "").trim();
  return {
    brand, estimator, link,
    vars: {
      first_name: name.split(/\s+/)[0] || "there", estimator, brand: brandRecord(brand).name,
      address: streetOf(i.est.sent_snapshot?.jobAddress || i.est.title || "") || "your place",
      expiry: expiryWords(i.est.valid_until), link,
      reason_links: reasonLinks(`${link}/reason`),
    },
  };
}

async function sendText(db: SupabaseClient, key: string, i: Ctx, template: string): Promise<boolean> {
  const phone = i.est.contact_phone ? normalisePhoneAU(i.est.contact_phone) : null;
  if (!phone) return false;
  const o = await sendAutomation(db, { key, to: { phone }, sms: { body: renderTemplate(template, varsFor(i).vars) }, ctx: { estimateId: i.est.id, accountId: i.est.account_id }, now: i.now });
  const word = outcomeWord(o);
  return word === "sent" || word === "not_configured" || o.outcome === "held";
}

/** A chat step (R1): the email that carries it, then the message on the estimate's own chat in the estimator's name. */
async function sendChat(db: SupabaseClient, key: string, i: Ctx, subjectT: string, bodyT: string): Promise<boolean> {
  if (!i.email) return false;
  const { brand, estimator, link, vars } = varsFor(i);
  const co = companyForBrand(i.company, brand);
  const body = renderTemplate(bodyT, vars);
  const o = await sendAutomation(db, {
    key, to: { email: i.email },
    email: {
      subject: renderTemplate(subjectT, vars),
      html: buildChatEmailHtml({ message: body, link: `${link}#chat`, companyName: co.name || brandRecord(brand).name, logoUrl: emailLogoUrl(co), estimatorName: i.company.estimatorName || undefined, companyPhone: co.phone || undefined }),
      from: fromForBrand(brand),
    },
    ctx: { estimateId: i.est.id, accountId: i.est.account_id }, now: i.now,
  });
  const word = outcomeWord(o);
  if (word !== "sent" && word !== "not_configured") return false;
  const { error } = await db.from("estimate_messages").insert({ estimate_id: i.est.id, direction: "staff", body, author_name: estimator === "The team" ? null : estimator });
  if (error) { reportError(error, { where: "automations.estimateSequence.chatRow", extra: { estimateId: i.est.id, key } }); return false; }
  return true;
}

async function sendStep(db: SupabaseClient, i: Ctx & { step: EstimateStep }): Promise<boolean> {
  if (i.step.channel === "sms") return sendText(db, i.step.key, i, i.messaging.estimateUnopenedSms);
  const [subjectT, bodyT] = CHAT[i.step.key as keyof typeof CHAT](i.messaging);
  return sendChat(db, i.step.key, i, subjectT, bodyT);
}

/** E9: the text and the chat, one each. Either going counts. */
async function sendExpiryWarning(db: SupabaseClient, i: Ctx): Promise<boolean> {
  const text = await sendText(db, "estimate_expiry_warning", i, i.messaging.estimateExpirySms);
  const chat = await sendChat(db, "estimate_expiry_warning", i, i.messaging.estimateExpirySubject, i.messaging.estimateExpiryBody);
  return text || chat;
}
