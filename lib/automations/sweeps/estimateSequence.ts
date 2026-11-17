/**
 * The estimate sequence sweep, E2–E7 (automations brief §4.3). SERVER ONLY,
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
import { ESTIMATE_STEPS, expiryWords, type EstimateStep, type EstimateStepKey } from "../estimateSequence";
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

export type EstimateSequenceResult = { candidates: number; due: number; sent: Record<EstimateStepKey, number>; skipped: number; error?: string };

/** E7 at its longest after the first open, plus a fortnight for the open itself. */
const LOOKBACK_DAYS = 60;

type Row = StageEstimateRow & {
  brand: string | null; share_token: string | null;
  sent_snapshot: { contactName?: string; contactEmail?: string; jobAddress?: string } | null;
  contact_name: string | null; contact_email: string | null; contact_phone: string | null;
};

export async function runEstimateSequenceSweep(db: SupabaseClient, now = new Date()): Promise<EstimateSequenceResult> {
  const out: EstimateSequenceResult = { candidates: 0, due: 0, sent: Object.fromEntries(ESTIMATE_STEPS.map((s) => [s.key, 0])) as Record<EstimateStepKey, number>, skipped: 0 };
  try {
    const { messaging, company } = await loadMessaging(db);
    const enabled = new Map<EstimateStepKey, number>();
    for (const step of ESTIMATE_STEPS) {
      const a = automationByKey(step.key);
      if (a && automationOn(messaging, step.key)) enabled.set(step.key, timingFor(a, messaging, "after"));
    }
    if (enabled.size === 0) return out;

    const since = new Date(now.getTime() - LOOKBACK_DAYS * 86_400_000).toISOString();
    const { data, error } = await realOnly(db.from("estimates")
      .select("id, title, status, created_at, sent_at, valid_until, accepted_at, declined_at, account_id, brand, share_token, sent_snapshot, contact_name:builder_state->contact->>name, contact_email:builder_state->contact->>email, contact_phone:builder_state->contact->>phone"))
      .eq("status", "sent").not("share_token", "is", null).gte("sent_at", since).order("sent_at", { ascending: false }).limit(400);
    if (error) throw error;
    const rows = (data ?? []) as unknown as Row[];
    out.candidates = rows.length;
    if (rows.length === 0) return out;

    const ids = rows.map((r) => r.id);
    const [claims, chat] = await Promise.all([
      db.from("automation_claims").select("automation_key, entity_id, claimed_at").in("automation_key", ESTIMATE_STEPS.map((s) => s.key)).in("entity_id", ids),
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
      const due = sequenceStepsDue(ESTIMATE_STEPS, {
        stage: stage?.stage ?? null, since: stage?.since ?? null, claimed: claimedOf.get(est.id) ?? new Set(),
        conversationAt: conversationAt(chatOf.get(est.id) ?? [], stage?.since ?? null, claimTimesOf.get(est.id) ?? []),
      }, now, enabled);
      const email = (est.contact_email || est.sent_snapshot?.contactEmail || "").trim() || null;
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
  estimate_unopened_again: (m) => [m.estimateUnopenedAgainSubject, m.estimateUnopenedAgainBody],
  estimate_viewed_any_q: (m) => [m.estimateViewedAnyQSubject, m.estimateViewedAnyQBody],
  estimate_viewed_worth: (m) => [m.estimateViewedWorthSubject, m.estimateViewedWorthBody],
  estimate_viewed_held: (m) => [m.estimateViewedHeldSubject, m.estimateViewedHeldBody],
};

async function sendStep(db: SupabaseClient, i: {
  step: EstimateStep; est: Row; email: string | null;
  messaging: MessagingSettings; company: Awaited<ReturnType<typeof loadMessaging>>["company"]; now: Date;
}): Promise<boolean> {
  const { step, est, messaging } = i;
  const brand = messageBrandOf(est.brand);
  const co = companyForBrand(i.company, brand);
  const estimator = (i.company.estimatorName ?? "").trim().split(/\s+/)[0] || "The team";
  const link = `${publicOriginFor(brand, siteUrl())}/e/${est.share_token}`;
  const name = (est.sent_snapshot?.contactName || est.contact_name || "").trim();
  const vars = {
    first_name: name.split(/\s+/)[0] || "there", estimator, brand: brandRecord(brand).name,
    address: streetOf(est.sent_snapshot?.jobAddress || est.title || "") || "your place",
    expiry: expiryWords(est.valid_until), link,
  };
  const ctx = { estimateId: est.id, accountId: est.account_id };

  if (step.channel === "sms") {
    const phone = est.contact_phone ? normalisePhoneAU(est.contact_phone) : null;
    if (!phone) return false;
    const o = await sendAutomation(db, { key: step.key, to: { phone }, sms: { body: renderTemplate(messaging.estimateUnopenedSms, vars) }, ctx, now: i.now });
    const word = outcomeWord(o);
    return word === "sent" || word === "not_configured" || o.outcome === "held";
  }

  if (!i.email) return false;
  const [subjectT, bodyT] = CHAT[step.key as keyof typeof CHAT](messaging);
  const body = renderTemplate(bodyT, vars);
  const o = await sendAutomation(db, {
    key: step.key, to: { email: i.email },
    email: {
      subject: renderTemplate(subjectT, vars),
      html: buildChatEmailHtml({ message: body, link: `${link}#chat`, companyName: co.name || brandRecord(brand).name, logoUrl: emailLogoUrl(co), estimatorName: i.company.estimatorName || undefined, companyPhone: co.phone || undefined }),
      from: fromForBrand(brand),
    },
    ctx, now: i.now,
  });
  const word = outcomeWord(o);
  if (word !== "sent" && word !== "not_configured") return false;
  const { error } = await db.from("estimate_messages").insert({ estimate_id: est.id, direction: "staff", body, author_name: estimator === "The team" ? null : estimator });
  if (error) { reportError(error, { where: "automations.estimateSequence.chatRow", extra: { estimateId: est.id, key: step.key } }); return false; }
  return true;
}
