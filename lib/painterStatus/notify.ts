import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { contactFor } from "@/lib/contractor/notify";
import { outcomeWord, sendAutomation } from "@/lib/automations/dispatch";
import { renderTemplate } from "@/lib/messaging/config";
import { loadMessaging } from "@/lib/messaging/load";
import { siteUrl } from "@/lib/invoicing/pdf";
import { reportError } from "@/lib/monitoring/report";
import { COLOUR_NAME } from "./copy";
import type { Colour } from "./evaluate";

/**
 * Message 6 (brief §9): the painter's colour changed. Reached Green gets the
 * Green wording (an employed lead's leaves out priority and payment, R17);
 * any other change gets the "see why" wording. One automation, editable in
 * Settings, through the one dispatcher. Not sent while status is staff-only
 * (⚑21) and never for the first row (New at launch is not a change).
 */
export async function notifyStatusChanged(service: SupabaseClient, painterId: string, from: Colour, to: Colour, lead: boolean): Promise<string> {
  try {
    const { messaging, company } = await loadMessaging(service);
    const c = await contactFor(service, painterId);
    const vars = { first_name: c.firstName, company_name: company.name || "Paint Group", colour: COLOUR_NAME[to], link: `${siteUrl()}/portal/status` };
    const template = to === "green" ? (lead ? messaging.statusGreenLeadSms : messaging.statusGreenSms) : messaging.statusDroppedSms;
    const out = await sendAutomation(service, {
      key: "contractor_status_changed", to: { phone: c.phone }, sms: { body: renderTemplate(template, vars) },
      ctx: { kind: "status_changed" }, contractorId: painterId,
    });
    const word = outcomeWord(out);
    const { error } = await service.from("contractor_events").insert({ contractor_id: painterId, type: "status_changed_sent", detail: { from, to, outcome: word } });
    if (error) reportError(error, { where: "painterStatus.notify.record", bestEffort: true });
    return word;
  } catch (e) {
    reportError(e, { where: "painterStatus.notify", extra: { painterId, from, to } });
    return "error";
  }
}

/** Message 8 (brief §9; Tom 8 Oct 2026): the owner approved a bonus — the amount, and how it is paid. */
export async function notifyBonusApproved(service: SupabaseClient, painterId: string, bonusId: string, amountCents: number, employee: boolean): Promise<string> {
  try {
    const { messaging, company } = await loadMessaging(service);
    const c = await contactFor(service, painterId);
    const amount = "$" + (amountCents / 100).toLocaleString("en-AU", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    const vars = { first_name: c.firstName, company_name: company.name || "Paint Group", amount, link: `${siteUrl()}/portal/money` };
    const out = await sendAutomation(service, {
      key: "contractor_bonus_approved", to: { phone: c.phone },
      sms: { body: renderTemplate(employee ? messaging.bonusApprovedEmployeeSms : messaging.bonusApprovedSms, vars) },
      ctx: { kind: "bonus_approved" }, contractorId: painterId,
    });
    const word = outcomeWord(out);
    const { error } = await service.from("contractor_events").insert({ contractor_id: painterId, type: "bonus_approved_sent", detail: { bonus_id: bonusId, outcome: word } });
    if (error) reportError(error, { where: "painterStatus.notify.bonus", bestEffort: true });
    return word;
  } catch (e) {
    reportError(e, { where: "painterStatus.notifyBonus", extra: { painterId, bonusId } });
    return "error";
  }
}
