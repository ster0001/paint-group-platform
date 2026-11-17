/**
 * E1 — estimate overdue after a visit (automations brief, master plan C1 +2
 * days; 17 Nov 2026). SERVER ONLY, service client, off the half-hour
 * campaign sweep (`?only=overdue` is the hand run).
 *
 * The rule is the Today card's (lib/crm/work-queue.ts: a visit marked done,
 * no estimate sent to that customer since, due two days after) — read by the
 * same loader, so the alert and the card never disagree. Sent in office hours
 * only (an overdue estimate waits for the morning), once per visit
 * (notifyStaff's guard row), to everyone ticked under Staff logins. Ships off.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import { loadAfterVisitFacts, overdueAfterVisit } from "@/lib/crm/work-queue";
import { alertRouteNow } from "@/lib/staff/requestAlerts";
import { notifyStaff } from "@/lib/staff/notify";
import { loadMessaging } from "@/lib/messaging/load";
import { automationOn } from "@/lib/messaging/config";
import { siteUrl } from "@/lib/invoicing/pdf";
import { reportError } from "@/lib/monitoring/report";

export type EstimateOverdueResult = { overdue: number; sent: number; error?: string; skipped?: "off" | "out_of_hours" };

export async function runEstimateOverdueSweep(db: SupabaseClient, now = new Date()): Promise<EstimateOverdueResult> {
  const out: EstimateOverdueResult = { overdue: 0, sent: 0 };
  try {
    const { messaging } = await loadMessaging(db);
    if (!automationOn(messaging, "office_estimate_overdue")) return { ...out, skipped: "off" };
    if (!(await alertRouteNow(db, now)).inHours) return { ...out, skipped: "out_of_hours" };
    const facts = await loadAfterVisitFacts(db, now);
    if (facts.error) throw new Error(facts.error);
    const due = overdueAfterVisit(facts.rows, facts.estimates, now);
    out.overdue = due.length;
    for (const { visit, item, days } of due) {
      const address = (visit.address || visit.customer_name || "A visit").split(",")[0].trim();
      const link = `${siteUrl()}${item.action?.href ?? "/crm/today"}`;
      const vars = { address, days: String(days), link };
      const r = await notifyStaff(db, {
        key: "office_estimate_overdue", entityId: visit.id, link,
        subject: `Estimate overdue — ${address}`,
        message: `${address} visited ${days} days ago, estimate not sent. Open: ${link}`,
        templates: { subject: "officeEstimateOverdueSubject", body: "officeEstimateOverdueBody" }, vars,
        smsFromMessage: true, estimateId: visit.estimate_id,
      });
      if (r === "sent") out.sent += 1;
    }
  } catch (e) {
    out.error = e instanceof Error ? e.message : String(e);
    reportError(e, { where: "automations.estimateOverdue" });
  }
  return out;
}
