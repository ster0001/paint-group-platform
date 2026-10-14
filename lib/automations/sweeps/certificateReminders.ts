/**
 * Certificate reminders (induction brief §6 "Certificates later", ruling I5).
 * SERVER ONLY, service client, off the half-hour campaign sweep.
 *
 * A painter who tapped "I will add this later" on their certificates
 * (contractor_defer_certificates, 20270266) and still has no verified public
 * liability certificate is texted on days 2, 4 and 6 after the tap at 9 am
 * Melbourne (settings.certificate_rules) — the standards ladder, reused:
 * one claim per (painter, rung), missed rungs claimed quietly, "still
 * needed?" asked at send time, and the claim entity carries the deferral
 * instant so a second deferral never finds old claims. `offerable` is exactly
 * "a verified, unexpired insurance certificate", so it is the stop signal.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import { automationByKey } from "../registry";
import { runLadder } from "../reminders";
import { sendAutomation, outcomeWord } from "../dispatch";
import { loadMessaging } from "@/lib/messaging/load";
import { automationOn, renderTemplate } from "@/lib/messaging/config";
import { reportError } from "@/lib/monitoring/report";
import { contactFor } from "@/lib/contractor/notify";
import { mergeStandardsRules, standardsReminderLadder } from "@/lib/standards/acks";
import { siteUrl } from "@/lib/invoicing/pdf";

export const CERTIFICATE_REMINDER_KEY = "contractor_certificate_reminder";

export type CertificateReminderResult = { reminded: number; stopped: number };

type Deferred = { id: string; certificates_deferred_at: string; offerable: boolean };

async function loadCertificateRules(db: SupabaseClient): Promise<{ reminderDays: number[]; reminderHour: number }> {
  const { data, error } = await db.from("settings").select("value").eq("key", "certificate_rules").maybeSingle();
  if (error) reportError(error, { where: "certificates.rules", bestEffort: true });
  const v = (data as { value?: { reminderDays?: unknown; reminderHour?: unknown } } | null)?.value ?? {};
  const days = Array.isArray(v.reminderDays) ? v.reminderDays.filter((n): n is number => typeof n === "number" && n > 0) : [2, 4, 6];
  const hour = typeof v.reminderHour === "number" ? v.reminderHour : 9;
  return { reminderDays: days.length ? days : [2, 4, 6], reminderHour: hour };
}

export async function sendCertificateReminder(service: SupabaseClient, contractorId: string, rung: string): Promise<string> {
  try {
    const { messaging, company } = await loadMessaging(service);
    const c = await contactFor(service, contractorId);
    const out = await sendAutomation(service, {
      key: CERTIFICATE_REMINDER_KEY,
      to: { phone: c.phone },
      sms: { body: renderTemplate(messaging.certificateReminderSms, { first_name: c.firstName, company_name: company.name, link: `${siteUrl()}/portal/profile`, version: "" }) },
      ctx: { kind: "certificate_reminder" }, contractorId,
    });
    const word = outcomeWord(out);
    const { error } = await service.from("contractor_events").insert({ contractor_id: contractorId, type: "certificate_reminder_sent", detail: { rung, outcome: word } });
    if (error) reportError(error, { where: "certificates.notify.record", bestEffort: true, extra: { contractorId } });
    return word;
  } catch (e) {
    reportError(e, { where: "certificates.notify.reminder", extra: { contractorId } });
    return "error";
  }
}

export async function runCertificateReminderSweep(db: SupabaseClient, now = new Date()): Promise<CertificateReminderResult> {
  const out: CertificateReminderResult = { reminded: 0, stopped: 0 };
  try {
    const reminder = automationByKey(CERTIFICATE_REMINDER_KEY);
    const { messaging } = await loadMessaging(db);
    if (!reminder || !automationOn(messaging, reminder.key)) return out;
    const { data, error } = await db.from("contractors").select("id, certificates_deferred_at, offerable")
      .eq("active", true).eq("employment_type", "contractor").eq("offerable", false).not("certificates_deferred_at", "is", null).limit(500);
    if (error) throw error;
    const rules = await loadCertificateRules(db);
    // The standards ladder shape: reminderHour on the day of the tap, then day N × 24 h.
    const ladderRules = mergeStandardsRules({ reminderDays: rules.reminderDays, reminderHour: rules.reminderHour });
    for (const r of (data ?? []) as Deferred[]) {
      const deferredAt = new Date(r.certificates_deferred_at);
      const ladder = standardsReminderLadder(deferredAt, ladderRules);
      const res = await runLadder(db, {
        key: reminder.key, entityId: `${r.id}@${deferredAt.toISOString()}`,
        anchor: ladder.anchor, rungs: ladder.rungs, now,
        stillNeeded: async () => {
          const { data: again, error: againErr } = await db.from("contractors").select("offerable, active").eq("id", r.id).maybeSingle();
          // A failed re-read must not send a text on stale evidence: treat it as "stop this rung".
          if (againErr) { reportError(againErr, { where: "automations.certificateReminders.stillNeeded", extra: { contractorId: r.id } }); return { ok: false, reason: "could not re-read the record" }; }
          const a = again as { offerable: boolean; active: boolean } | null;
          return a && a.active && !a.offerable ? { ok: true } : { ok: false, reason: "the certificate is on file" };
        },
        send: async (rung) => { await sendCertificateReminder(db, r.id, rung.id); },
      });
      if (res.fired) out.reminded++;
      if (res.stopped) out.stopped++;
    }
  } catch (e) {
    reportError(e, { where: "automations.certificateReminders" });
  }
  return out;
}
