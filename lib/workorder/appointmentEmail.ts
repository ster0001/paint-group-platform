import type { SupabaseClient } from "@supabase/supabase-js";
import { DEFAULT_MESSAGING, MESSAGING_KEY, renderTemplate, type MessagingSettings } from "@/lib/messaging/config";
import { buildPlainEmailHtml, emailConfigured, sendEmail } from "@/lib/messaging/send";
import { isTestEmail } from "@/lib/accounts/identity";
import { reportError } from "@/lib/monitoring/report";

/**
 * The appointment confirmation email (Tom, 1 Sep). SERVER ONLY — service client.
 *
 * Sent to the customer the moment their job is BOOKED — the contractor accepts
 * the offer, or the office assigns directly. The wording is the editable
 * template in Settings → Messaging (apptConfirmSubject / apptConfirmBody):
 * painter's name, the 07:30–08:00 start window, the final walkthrough (date +
 * time when organised, "we'll confirm" when not), why being present at the
 * walkthrough matters, and that progress updates land in their dashboard.
 *
 * Idempotent the preStart way: one `appt_confirm_sent` / `appt_confirm_skipped`
 * wo_event per booking start date — a re-ping, the sweep backstop, or a page
 * refresh never doubles it; a job re-booked to a NEW start date confirms again.
 */
export async function sendAppointmentConfirmation(
  service: SupabaseClient,
  workOrderId: string,
): Promise<void> {
  try {
    await run(service, workOrderId);
  } catch (e) {
    reportError(e, { where: "appointmentConfirm", extra: { workOrderId } });
  }
}

async function run(service: SupabaseClient, workOrderId: string): Promise<void> {
  const { data: w } = await service
    .from("work_orders")
    .select("id, wo_ref, stage, start_date, contractor_id, wo_snapshot, estimates(title, accepted_name, builder_state, sent_snapshot)")
    .eq("id", workOrderId)
    .maybeSingle();
  const wo = w as {
    id: string; wo_ref: string; stage: string; start_date: string | null; contractor_id: string | null;
    wo_snapshot: { jobAddress?: string; jobTitle?: string } | null;
    estimates: {
      title: string | null; accepted_name: string | null;
      builder_state: { contact?: { first_name?: string; email?: string } } | null;
      sent_snapshot: { jobAddress?: string; contactEmail?: string } | null;
    } | null;
  } | null;
  if (!wo?.estimates || !wo.start_date || !wo.contractor_id) return;

  // One confirmation per booked start date.
  const { data: priorEvents } = await service
    .from("wo_events").select("id, meta")
    .eq("work_order_id", workOrderId)
    .in("type", ["appt_confirm_sent", "appt_confirm_skipped"]);
  const already = ((priorEvents ?? []) as { meta: { start_date?: string } | null }[])
    .some((e) => e.meta?.start_date === wo.start_date);
  if (already) return;

  const contact = wo.estimates.builder_state?.contact ?? {};
  const to = (contact.email || wo.estimates.sent_snapshot?.contactEmail || "").trim();
  if (!to || isTestEmail(to)) {
    await service.from("wo_events").insert({
      work_order_id: workOrderId, type: "appt_confirm_skipped", actor_kind: "system",
      meta: { start_date: wo.start_date, reason: to ? "test email" : "no customer email" },
    });
    return;
  }

  const [{ data: settingsRows }, { data: c }, { data: walkRows }] = await Promise.all([
    service.from("settings").select("key, value").in("key", [MESSAGING_KEY, "company_profile"]),
    service.from("contractors").select("company_name, profiles(name)").eq("id", wo.contractor_id).maybeSingle(),
    service.from("wo_walkthroughs")
      .select("scheduled_date, scheduled_time, status")
      .eq("work_order_id", workOrderId).eq("kind", "final")
      .order("created_at", { ascending: false }).limit(1),
  ]);
  const rows = (settingsRows as { key: string; value: unknown }[] | null) ?? [];
  const messaging: MessagingSettings = {
    ...DEFAULT_MESSAGING,
    ...((rows.find((r) => r.key === MESSAGING_KEY)?.value as Partial<MessagingSettings>) ?? {}),
  };
  const company = (rows.find((r) => r.key === "company_profile")?.value as {
    name?: string; phone?: string; email?: string; logoUrl?: string; logoUrlLight?: string;
  } | null) ?? {};

  const contractor = c as { company_name: string | null; profiles: { name: string | null } | null } | null;
  const painterName = (contractor?.profiles?.name || contractor?.company_name || "your painter").trim();
  const painterFirst = painterName.split(/\s+/)[0] || "your painter";

  const booked = ((walkRows ?? []) as { scheduled_date: string; scheduled_time: string | null; status: string }[])
    .find((r) => r.status === "booked");
  const longDay = (iso: string) =>
    new Date(`${iso}T00:00:00`).toLocaleDateString("en-AU", { weekday: "long", day: "numeric", month: "long" });
  const walkthroughLine = booked
    ? `Your final walkthrough is booked for ${longDay(booked.scheduled_date)}${booked.scheduled_time ? ` at ${booked.scheduled_time.slice(0, 5)}` : ""} — a calendar invite is on its way separately.`
    : `We'll confirm the date and time of your final walkthrough with you closer to the finish.`;

  const vars = {
    first_name: contact.first_name || (wo.estimates.accepted_name ?? "").split(/\s+/)[0] || "there",
    company_name: company.name ?? "Paint Group",
    address: wo.estimates.sent_snapshot?.jobAddress || wo.wo_snapshot?.jobAddress || "your property",
    start_date: longDay(wo.start_date),
    painter_name: painterFirst,
    walkthrough_line: walkthroughLine,
    estimate_title: wo.estimates.title ?? wo.wo_snapshot?.jobTitle ?? "",
  };
  const subject = renderTemplate(messaging.apptConfirmSubject, vars);
  const body = renderTemplate(messaging.apptConfirmBody, vars);

  const result = emailConfigured()
    ? await sendEmail({
        to, subject, replyTo: company.email || undefined,
        html: buildPlainEmailHtml({
          heading: subject, message: body, companyName: vars.company_name,
          logoUrl: company.logoUrlLight || company.logoUrl || undefined,
          companyPhone: company.phone || undefined,
        }),
      })
    : { status: "not_configured" as const };
  const outcome = result.status;
  const delivered = outcome === "sent";
  const detail = "message" in result ? result.message : undefined;
  await service.from("wo_events").insert({
    work_order_id: workOrderId,
    type: delivered ? "appt_confirm_sent" : "appt_confirm_skipped",
    actor_kind: "system",
    meta: { to, start_date: wo.start_date, outcome, ...(detail ? { message: detail } : {}) },
  });
}
