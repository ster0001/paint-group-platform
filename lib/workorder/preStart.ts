import type { SupabaseClient } from "@supabase/supabase-js";
import { DEFAULT_MESSAGING, MESSAGING_KEY, automationOn, renderTemplate, type MessagingSettings } from "@/lib/messaging/config";
import { buildPlainEmailHtml, emailConfigured, sendEmail } from "@/lib/messaging/send";
import { melbourneDate } from "./console";

/**
 * The pre-start checklist email (Tom, 23 Aug).
 *
 * The office ticks "Pre-start checklist" on a job's pre-start list — THAT is
 * the approval. From then on, once the start is within N days (Settings →
 * Messaging, default 2), the customer gets the checklist once. The
 * `pre_start_checklist_sent` event is the guard, so a late sweep sends one
 * email, never a week's worth, and a job whose start moves does not send twice.
 *
 * Returns the number of emails sent this pass.
 */
export async function sendPreStartChecklists(db: SupabaseClient, now = new Date()): Promise<number> {
  const [{ data: settingsRows }, { data: ticked }] = await Promise.all([
    db.from("settings").select("key, value").in("key", [MESSAGING_KEY, "company_profile"]),
    db.from("wo_checklist_items").select("work_order_id")
      .eq("phase", "pre_start").eq("item_key", "pre_start_checklist").not("done_at", "is", null),
  ]);
  const rows = (settingsRows as { key: string; value: unknown }[] | null) ?? [];
  const messaging: MessagingSettings = { ...DEFAULT_MESSAGING, ...((rows.find((r) => r.key === MESSAGING_KEY)?.value as Partial<MessagingSettings>) ?? {}) };
  // Settings → Automations: "Pre-start checklist". Off = nothing sent, and
  // nothing recorded either, so switching it back on sends to jobs still due.
  if (!automationOn(messaging, "pre_start_checklist")) return 0;
  const company = (rows.find((r) => r.key === "company_profile")?.value as { name?: string; phone?: string; logoUrl?: string; logoUrlLight?: string; email?: string; estimatorName?: string } | null) ?? {};
  const ids = [...new Set(((ticked ?? []) as { work_order_id: string }[]).map((t) => t.work_order_id))];
  if (ids.length === 0) return 0;

  const today = melbourneDate(now);
  const horizon = melbourneDate(new Date(now.getTime() + messaging.preStartDaysBefore * 86_400_000));

  const { data: wos } = await db.from("work_orders")
    .select("id, estimate_id, stage, start_date, wo_snapshot, estimates(title, builder_state)")
    .in("id", ids).eq("stage", "pre_start").not("start_date", "is", null)
    .gte("start_date", today).lte("start_date", horizon);
  const jobs = (wos ?? []) as unknown as {
    id: string; estimate_id: string; start_date: string;
    wo_snapshot: { jobAddress?: string; jobTitle?: string } | null;
    estimates: { title: string | null; builder_state: { contact?: { first_name?: string; email?: string } } | null } | null;
  }[];
  if (jobs.length === 0) return 0;

  // One attempt per job: sent OR skipped (no email / not configured) both count,
  // so a sweep never writes a row a day for the same job.
  const { data: sentEvents } = await db.from("wo_events").select("work_order_id")
    .in("type", ["pre_start_checklist_sent", "pre_start_checklist_skipped"]).in("work_order_id", jobs.map((j) => j.id));
  const already = new Set(((sentEvents ?? []) as { work_order_id: string }[]).map((e) => e.work_order_id));

  let sent = 0;
  for (const j of jobs) {
    if (already.has(j.id)) continue;
    const contact = j.estimates?.builder_state?.contact;
    const to = contact?.email?.trim();
    if (!to) {
      await db.from("wo_events").insert({
        work_order_id: j.id, type: "pre_start_checklist_skipped", actor_kind: "system",
        meta: { reason: "no customer email" },
      });
      continue;
    }
    const vars = {
      first_name: contact?.first_name ?? "",
      company_name: company.name ?? "Paint Group",
      start_date: new Date(`${j.start_date}T00:00:00`).toLocaleDateString("en-AU", { weekday: "long", day: "numeric", month: "long" }),
      address: j.wo_snapshot?.jobAddress ?? "",
      estimate_title: j.estimates?.title ?? j.wo_snapshot?.jobTitle ?? "",
    };
    const subject = renderTemplate(messaging.preStartSubject, vars);
    const body = renderTemplate(messaging.preStartBody, vars);
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
    await db.from("wo_events").insert({
      work_order_id: j.id,
      type: delivered ? "pre_start_checklist_sent" : "pre_start_checklist_skipped",
      actor_kind: "system",
      meta: { to, outcome, ...(detail ? { message: detail } : {}), days_before: messaging.preStartDaysBefore },
    });
    if (delivered) sent += 1;
  }
  return sent;
}
