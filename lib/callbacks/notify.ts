import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { contactFor } from "@/lib/contractor/notify";
import { outcomeWord, sendAutomation } from "@/lib/automations/dispatch";
import { renderTemplate } from "@/lib/messaging/config";
import { loadMessaging } from "@/lib/messaging/load";
import { siteUrl } from "@/lib/invoicing/pdf";
import { reportError } from "@/lib/monitoring/report";
import { dmy } from "./model";

/**
 * Message 7 (brief §9): "Call back at [address] on [day]: [what is wrong]" to
 * the painter booked to fix it, when the return visit is booked or moved.
 * SERVER ONLY, service client, best-effort behind after(). Once per
 * (call back, visit day) — guarded by a wo_events row — so a re-booking on
 * the same day never double-texts and a moved visit does tell them.
 */
export async function notifyCallbackBooked(service: SupabaseClient, callbackId: string): Promise<void> {
  try {
    const { data, error } = await service.from("wo_callbacks")
      .select("id, work_order_id, description, status, fixed_by_painter_id, painter_id, wo_appointments(start_date, end_date), work_orders(wo_ref, wo_snapshot)")
      .eq("id", callbackId).maybeSingle();
    if (error) throw error;
    const cb = data as unknown as {
      id: string; work_order_id: string; description: string; status: string; fixed_by_painter_id: string | null; painter_id: string;
      wo_appointments: { start_date: string; end_date: string } | null; work_orders: { wo_ref: string; wo_snapshot: { jobAddress?: string; jobTitle?: string } | null } | null;
    } | null;
    if (!cb || !cb.wo_appointments || cb.status === "done" || cb.status === "void") return;
    const day = cb.wo_appointments.start_date;
    const { data: seen, error: seenErr } = await service.from("wo_events").select("id").eq("work_order_id", cb.work_order_id)
      .eq("type", "callback_notified").contains("meta", { callback_id: cb.id, day }).limit(1);
    if (seenErr) throw seenErr;
    if ((seen ?? []).length) return;

    const { messaging, company } = await loadMessaging(service);
    const contractorId = cb.fixed_by_painter_id ?? cb.painter_id;
    const c = await contactFor(service, contractorId);
    const vars = {
      first_name: c.firstName, company_name: company.name || "Paint Group",
      address: cb.work_orders?.wo_snapshot?.jobAddress || cb.work_orders?.wo_snapshot?.jobTitle || cb.work_orders?.wo_ref || "the job",
      day: dmy(day), what: cb.description || "see the job", link: `${siteUrl()}/portal/jobs/${cb.work_order_id}`,
    };
    const out = await sendAutomation(service, {
      key: "contractor_callback_booked", to: { phone: c.phone },
      sms: { body: renderTemplate(messaging.callbackBookedSms, vars) },
      ctx: { workOrderId: cb.work_order_id, kind: "callback_booked" }, contractorId,
    });
    const ins = await service.from("wo_events").insert({
      work_order_id: cb.work_order_id, type: "callback_notified", actor_kind: "system",
      meta: { callback_id: cb.id, day, contractor_id: contractorId, outcome: outcomeWord(out) },
    });
    if (ins.error) throw ins.error;
  } catch (e) {
    reportError(e, { where: "callbacks.notify.booked", extra: { callbackId } });
  }
}
