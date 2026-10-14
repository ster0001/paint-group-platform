import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { sendAutomation, outcomeWord, type DispatchOutcome } from "@/lib/automations/dispatch";
import { automationByKey } from "@/lib/automations/registry";
import { loadMessaging } from "@/lib/messaging/load";
import { automationOn, renderTemplate } from "@/lib/messaging/config";
import { contactFor } from "@/lib/contractor/notify";
import { suburbFromAddress } from "@/lib/automations/sweeps/moneySignoff";
import { siteUrl } from "@/lib/invoicing/pdf";
import { reportError } from "@/lib/monitoring/report";

/**
 * The DEMO text (induction brief §4.1 Module 6, §4.2; rulings I12 and ⚑4):
 * the one real text of the induction, sent by the facilitator's button and
 * never by the reminder sweep. Through the messaging adapter like every other
 * send (registry key `contractor_demo_prompt`, wording editable in Settings),
 * prefixed "DEMO:". It plants a reminder moment on the practice job for today,
 * so the painter's next tick or photo answers it exactly as a real moment is
 * answered (trigger wo_reminder_moment_answer, 20270227) and the job page
 * shows it as answered.
 */
export const DEMO_PROMPT_KEY = "contractor_demo_prompt";

const melbDay = (d: Date) => new Intl.DateTimeFormat("en-CA", { timeZone: "Australia/Melbourne", year: "numeric", month: "2-digit", day: "2-digit" }).format(d);

export type DemoPromptResult = { ok: true; outcome: string } | { ok: false; message: string };

export async function sendDemoPrompt(service: SupabaseClient, workOrderId: string, now = new Date()): Promise<DemoPromptResult> {
  const { data: wo, error } = await service.from("work_orders").select("id, wo_ref, contractor_id, is_demo, wo_snapshot").eq("id", workOrderId).maybeSingle();
  if (error) { reportError(error, { where: "demo.prompt.job" }); return { ok: false, message: "Couldn't read the practice job — it has been reported." }; }
  const job = wo as { id: string; wo_ref: string; contractor_id: string | null; is_demo: boolean; wo_snapshot: { jobAddress?: string } | null } | null;
  if (!job?.is_demo) return { ok: false, message: "That is not a practice job." };
  if (!job.contractor_id) return { ok: false, message: "The practice job has no painter." };

  // The moment the text stands for: today, due now, through its RPC (the table
  // is written only by RPCs and the sweep). Re-sending re-arms it.
  const day = melbDay(now);
  const moment = await service.rpc("demo_prompt_plant", { p_work_order_id: job.id });
  const planted = String(moment.data ?? "");
  if (moment.error || !planted.startsWith("ok:")) {
    reportError(moment.error ?? new Error(planted), { where: "demo.prompt.moment", extra: { workOrderId: job.id } });
    return { ok: false, message: "Couldn't plant the reminder — it has been reported." };
  }

  const a = automationByKey(DEMO_PROMPT_KEY);
  if (!a) return { ok: false, message: "The DEMO text is not in the messaging registry." };
  const { messaging, company } = await loadMessaging(service);
  if (!automationOn(messaging, DEMO_PROMPT_KEY)) return { ok: false, message: "The DEMO text is switched off in Settings → Messaging." };
  const c = await contactFor(service, job.contractor_id);
  if (!c.phone) return { ok: false, message: "The painter has no mobile on file." };
  const body = renderTemplate(messaging.contractorDemoPromptSms, {
    first_name: c.firstName, company_name: company.name, wo_ref: job.wo_ref,
    suburb: suburbFromAddress(job.wo_snapshot?.jobAddress, job.wo_ref), day_label: "today",
    link: `${siteUrl()}/portal/jobs/${job.id}`,
  });
  const o: DispatchOutcome = await sendAutomation(service, {
    key: a.key, to: { phone: c.phone }, sms: { body },
    ctx: { workOrderId: job.id, kind: "job_update_reminder" }, contractorId: job.contractor_id, now,
  });
  await service.from("wo_events").insert({ work_order_id: job.id, type: "demo_prompt_sent", actor_kind: "staff", meta: { day, outcome: o.outcome } });
  if (o.outcome === "error") return { ok: false, message: `The text did not go: ${o.message}` };
  return { ok: true, outcome: outcomeWord(o) };
}
