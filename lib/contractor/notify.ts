import type { SupabaseClient } from "@supabase/supabase-js";
import { buildEstimateEmailHtml } from "@/lib/messaging/send";
import { sendAutomation } from "@/lib/automations/dispatch";
import { automationOn, normalisePhoneAU, renderTemplate } from "@/lib/messaging/config";
import { loadMessaging } from "@/lib/messaging/load";
import { isTestEmail } from "@/lib/accounts/identity";
import { siteUrl } from "@/lib/invoicing/pdf";
import { reportError } from "@/lib/monitoring/report";
import { emailLogoUrl } from "@/lib/messaging/logo";

/**
 * Contractor notifications (Tom, 1 Sep #2). SERVER ONLY — service client.
 *
 * Three moments reach the painter's phone now: a job OFFER goes out (text +
 * email, 24h clock), a variation is RELEASED for their approval (text), and a
 * QUALITY CHECK FAILS (text). All best-effort behind after() — a lost text
 * never unwinds the thing it announces; the portal itself always shows the
 * same facts (home-page cards), so the SMS is a tap-saver, not the record.
 *
 * Phone: contractors.phone (20261223) — missing column, unset number or a
 * non-AU shape all degrade to "no text". Email: the login address through
 * auth.admin (contractors carry no email column — the sendInvoice rule).
 */

type ContractorContact = { phone: string | null; email: string | null; firstName: string };

export async function contactFor(service: SupabaseClient, contractorId: string): Promise<ContractorContact> {
  const { data, error } = await service
    .from("contractors")
    .select("profile_id, company_name, phone, profiles(name)")
    .eq("id", contractorId)
    .maybeSingle();
  // Pre-20261223 the phone column 42703s the select — retry without it.
  const row = (error
    ? ((await service.from("contractors").select("profile_id, company_name, profiles(name)").eq("id", contractorId).maybeSingle()).data)
    : data) as { profile_id: string | null; company_name: string | null; phone?: string | null; profiles: { name: string | null } | null } | null;
  if (!row) return { phone: null, email: null, firstName: "there" };

  let email: string | null = null;
  if (row.profile_id) {
    const { data: u } = await service.auth.admin.getUserById(row.profile_id);
    email = u?.user?.email ?? null;
  }
  const name = (row.profiles?.name || row.company_name || "").trim();
  return {
    phone: row.phone ? normalisePhoneAU(row.phone) : null,
    email,
    firstName: name.split(/\s+/)[0] || "there",
  };
}

/** One notification per fact — guarded by a wo_events row, the preStart rule. */
async function once(
  service: SupabaseClient,
  workOrderId: string,
  type: string,
  key: Record<string, string>,
): Promise<boolean> {
  const { data } = await service
    .from("wo_events").select("id, meta").eq("work_order_id", workOrderId).eq("type", type).limit(50);
  const seen = ((data ?? []) as { meta: Record<string, string> | null }[])
    .some((e) => Object.entries(key).every(([k, v]) => e.meta?.[k] === v));
  return !seen;
}

const record = (service: SupabaseClient, workOrderId: string, type: string, meta: Record<string, unknown>) =>
  service.from("wo_events").insert({ work_order_id: workOrderId, type, actor_kind: "system", meta });

/** "You have a job offer" — text + email, on send/reassign/re-offer. */
export async function notifyJobOffer(service: SupabaseClient, workOrderId: string, contractorId: string): Promise<void> {
  try {
    // Settings → Automations: "Job offer". Off = the portal still shows the
    // offer (the record), the painter just isn't pinged.
    const { messaging, company } = await loadMessaging(service);
    if (!automationOn(messaging, "contractor_offer")) {
      await record(service, workOrderId, "offer_notify_skipped", { contractor_id: contractorId, reason: "automation off" });
      return;
    }
    const { data: w } = await service
      .from("work_orders").select("wo_ref").eq("id", workOrderId).maybeSingle();
    const woRef = (w as { wo_ref?: string } | null)?.wo_ref ?? "a job";
    const c = await contactFor(service, contractorId);
    const link = `${siteUrl()}/portal/requests`;
    const companyName = company.name || "Paint Group";
    const vars = { first_name: c.firstName, company_name: companyName, wo_ref: woRef, link };
    const body = renderTemplate(messaging.offerSms, vars);

    // Through the dispatcher (Session 1): Text / Email / Both is the office's
    // choice; no mobile falls back to email and says so on the record.
    await sendAutomation(service, {
      key: "contractor_offer",
      to: { phone: c.phone, email: c.email && !isTestEmail(c.email) ? c.email : null },
      sms: { body },
      email: {
        subject: renderTemplate(messaging.offerEmailSubject, vars),
        html: buildEstimateEmailHtml({
          companyName,
          logoUrl: emailLogoUrl(company),
          intro: renderTemplate(messaging.offerEmailIntro, vars),
          link,
          buttonLabel: "Open your portal",
        }),
      },
      ctx: { workOrderId, kind: "offer" },
      contractorId,
    });
    await record(service, workOrderId, "offer_notified", { contractor_id: contractorId, wo_ref: woRef });
  } catch (e) {
    reportError(e, { where: "notify.jobOffer", extra: { workOrderId } });
  }
}

/**
 * Employed painters (Session 2): "you're on a job — tap Accept", "your dates
 * changed — accept again", "you're off this job". Text + email for the
 * assignment, text for the other two. Best-effort like every painter ping:
 * the assignment is already in their calendar, this is the tap-saver.
 */
export async function notifyAssignment(
  service: SupabaseClient,
  assignmentId: string,
  kind: "assigned" | "dates_changed" | "released",
): Promise<void> {
  try {
    const { data, error } = await service
      .from("wo_assignments")
      .select("id, contractor_id, work_order_id, start_date, end_date, work_orders(wo_ref, wo_snapshot)")
      .eq("id", assignmentId)
      .maybeSingle();
    if (error) throw error;
    const a = data as {
      id: string; contractor_id: string; work_order_id: string; start_date: string; end_date: string;
      work_orders: { wo_ref: string; wo_snapshot: { jobAddress?: string } | null } | null;
    } | null;
    if (!a?.work_orders) return;

    const key = kind === "assigned" ? "employee_assigned" : kind === "dates_changed" ? "employee_dates_changed" : "employee_released";
    const { messaging, company } = await loadMessaging(service);
    if (!automationOn(messaging, key)) {
      await record(service, a.work_order_id, "assignment_notify_skipped", { assignment_id: a.id, kind, reason: "automation off" });
      return;
    }
    const c = await contactFor(service, a.contractor_id);
    const link = `${siteUrl()}/portal/jobs/${a.work_order_id}`;
    const dmy = (iso: string) => iso.split("-").reverse().join("/");
    const dates = a.start_date === a.end_date ? dmy(a.start_date) : `${dmy(a.start_date)} → ${dmy(a.end_date)}`;
    const companyName = company.name || "Paint Group";
    const vars = {
      first_name: c.firstName, company_name: companyName, wo_ref: a.work_orders.wo_ref,
      address: a.work_orders.wo_snapshot?.jobAddress ?? "", start_date: dmy(a.start_date), dates, link,
    };
    const smsTemplate = kind === "assigned" ? messaging.assignmentSms
      : kind === "dates_changed" ? messaging.assignmentDatesChangedSms : messaging.assignmentReleasedSms;

    await sendAutomation(service, {
      key,
      to: { phone: c.phone, email: c.email && !isTestEmail(c.email) ? c.email : null },
      sms: { body: renderTemplate(smsTemplate, vars) },
      ...(kind === "assigned" ? {
        email: {
          subject: renderTemplate(messaging.assignmentEmailSubject, vars),
          html: buildEstimateEmailHtml({
            companyName,
            logoUrl: emailLogoUrl(company),
            intro: renderTemplate(messaging.assignmentEmailIntro, vars),
            link,
            buttonLabel: "Open your work order",
          }),
        },
      } : {}),
      ctx: { workOrderId: a.work_order_id, kind: "assignment" },
      contractorId: a.contractor_id,
    });
    await record(service, a.work_order_id, "assignment_notified", { assignment_id: a.id, contractor_id: a.contractor_id, kind });
  } catch (e) {
    reportError(e, { where: "notify.assignment", extra: { assignmentId, kind } });
  }
}

/** "A variation is approved and waiting for you" — text, once per variation. */
export async function notifyVariationReleased(service: SupabaseClient, variationId: string): Promise<void> {
  try {
    const { data: v } = await service
      .from("wo_variations")
      .select("id, status, released_at, credit, work_order_id, work_orders(wo_ref, contractor_id)")
      .eq("id", variationId)
      .maybeSingle();
    const row = v as {
      id: string; status: string; released_at: string | null; credit: boolean;
      work_order_id: string; work_orders: { wo_ref: string; contractor_id: string | null } | null;
    } | null;
    if (!row?.work_orders?.contractor_id || row.status !== "customer_approved" || !row.released_at) return;
    if (!(await once(service, row.work_order_id, "variation_release_notified", { variation_id: row.id }))) return;
    const { messaging, company } = await loadMessaging(service);
    if (!automationOn(messaging, "contractor_variation_released")) return;

    const c = await contactFor(service, row.work_orders.contractor_id);
    const link = `${siteUrl()}/portal/jobs/${row.work_order_id}`;
    const body = renderTemplate(messaging.variationReleasedSms, {
      company_name: company.name || "Paint Group", wo_ref: row.work_orders.wo_ref,
      action: row.credit ? "acknowledge" : "approve", link,
    });
    await sendAutomation(service, {
      key: "contractor_variation_released", to: { phone: c.phone }, sms: { body },
      ctx: { workOrderId: row.work_order_id, kind: "variation_released" }, contractorId: row.work_orders.contractor_id,
    });

    await record(service, row.work_order_id, "variation_release_notified", { variation_id: row.id });
  } catch (e) {
    reportError(e, { where: "notify.variationReleased", extra: { variationId } });
  }
}

/** "Areas need rectifying" — text after a failed quality check, once per check. */
export async function notifyQaFail(service: SupabaseClient, checkId: string): Promise<void> {
  try {
    const { data: q } = await service
      .from("wo_qa_checks")
      .select("id, result, work_order_id, work_orders(wo_ref, contractor_id)")
      .eq("id", checkId)
      .maybeSingle();
    const row = q as {
      id: string; result: string | null; work_order_id: string;
      work_orders: { wo_ref: string; contractor_id: string | null } | null;
    } | null;
    if (!row?.work_orders?.contractor_id || row.result !== "fail") return;
    if (!(await once(service, row.work_order_id, "qa_fail_notified", { check_id: row.id }))) return;
    const { messaging, company } = await loadMessaging(service);
    if (!automationOn(messaging, "contractor_qa_fail")) return;

    const c = await contactFor(service, row.work_orders.contractor_id);
    const link = `${siteUrl()}/portal/jobs/${row.work_order_id}`;
    const body = renderTemplate(messaging.qaFailSms, {
      company_name: company.name || "Paint Group", wo_ref: row.work_orders.wo_ref, link,
    });
    await sendAutomation(service, {
      key: "contractor_qa_fail", to: { phone: c.phone }, sms: { body },
      ctx: { workOrderId: row.work_order_id, kind: "qa_fail" }, contractorId: row.work_orders.contractor_id,
    });

    await record(service, row.work_order_id, "qa_fail_notified", { check_id: row.id });
  } catch (e) {
    reportError(e, { where: "notify.qaFail", extra: { checkId } });
  }
}

// ---- Employed painters, Session 7 (brief §3.9) ------------------------------

const dmy = (iso: string) => iso.split("-").reverse().join("/");

/** Is this painter an employee? Read once per send; a missing column reads as contractor. */
async function isEmployeePainter(service: SupabaseClient, contractorId: string): Promise<boolean> {
  const { data, error } = await service.from("contractors").select("employment_type").eq("id", contractorId).maybeSingle();
  if (error) throw error;
  return (data as { employment_type?: string } | null)?.employment_type === "employee";
}

/** "You're now the lead painter" — text to the new lead, once per change. */
export async function notifyLeadChanged(service: SupabaseClient, workOrderId: string, contractorId: string): Promise<void> {
  try {
    if (!(await isEmployeePainter(service, contractorId))) return;
    const { data, error } = await service.from("work_orders").select("wo_ref, wo_snapshot").eq("id", workOrderId).maybeSingle();
    if (error) throw error;
    const wo = data as { wo_ref: string; wo_snapshot: { jobAddress?: string } | null } | null;
    if (!wo) return;
    const stamp = new Date().toISOString().slice(0, 13); // once per painter per hour — a double tap is one text
    if (!(await once(service, workOrderId, "lead_changed_notified", { contractor_id: contractorId, hour: stamp }))) return;
    const { messaging, company } = await loadMessaging(service);
    if (!automationOn(messaging, "employee_lead_changed")) return;
    const c = await contactFor(service, contractorId);
    const link = `${siteUrl()}/portal/jobs/${workOrderId}`;
    const body = renderTemplate(messaging.leadChangedSms, {
      first_name: c.firstName, company_name: company.name || "Paint Group", wo_ref: wo.wo_ref,
      address: wo.wo_snapshot?.jobAddress ?? "", link,
    });
    await sendAutomation(service, {
      key: "employee_lead_changed", to: { phone: c.phone }, sms: { body },
      ctx: { workOrderId, kind: "lead_changed" }, contractorId,
    });
    await record(service, workOrderId, "lead_changed_notified", { contractor_id: contractorId, hour: stamp });
  } catch (e) {
    reportError(e, { where: "notify.leadChanged", extra: { workOrderId, contractorId } });
  }
}

/**
 * "The customer approved a change" — to EVERY employed painter on the job,
 * hours only (the contractor's variation text carries "approve it", which an
 * employee never does — the trigger accepted it for them). Once per painter.
 */
export async function notifyEmployeeVariationApproved(service: SupabaseClient, variationId: string): Promise<void> {
  try {
    const { data: v, error: vErr } = await service
      .from("wo_variations").select("id, status, est_hours, work_order_id, work_orders(wo_ref)")
      .eq("id", variationId).maybeSingle();
    if (vErr) throw vErr;
    const row = v as { id: string; status: string; est_hours: number | string | null; work_order_id: string; work_orders: { wo_ref: string } | null } | null;
    if (!row?.work_orders || !["customer_approved", "contractor_accepted"].includes(row.status)) return;
    const { data: crew, error: crewErr } = await service
      .from("wo_assignments").select("contractor_id, contractors!inner(employment_type)")
      .eq("work_order_id", row.work_order_id).neq("status", "released").eq("contractors.employment_type", "employee");
    if (crewErr) throw crewErr;
    const painters = [...new Set(((crew ?? []) as { contractor_id: string }[]).map((a) => a.contractor_id))];
    if (painters.length === 0) return;
    const { messaging, company } = await loadMessaging(service);
    if (!automationOn(messaging, "employee_variation_approved")) return;
    const hours = Number(row.est_hours ?? 0);
    const link = `${siteUrl()}/portal/jobs/${row.work_order_id}`;
    for (const contractorId of painters) {
      if (!(await once(service, row.work_order_id, "employee_variation_notified", { variation_id: row.id, contractor_id: contractorId }))) continue;
      const c = await contactFor(service, contractorId);
      const body = renderTemplate(messaging.employeeVariationApprovedSms, {
        first_name: c.firstName, company_name: company.name || "Paint Group", wo_ref: row.work_orders.wo_ref,
        hours_line: hours > 0 ? ` — ${hours} hr${hours === 1 ? "" : "s"} added` : "", link,
      });
      await sendAutomation(service, {
        key: "employee_variation_approved", to: { phone: c.phone }, sms: { body },
        ctx: { workOrderId: row.work_order_id, kind: "variation_approved_employee" }, contractorId,
      });
      await record(service, row.work_order_id, "employee_variation_notified", { variation_id: row.id, contractor_id: contractorId });
    }
  } catch (e) {
    reportError(e, { where: "notify.employeeVariationApproved", extra: { variationId } });
  }
}

/** "Your expense claim was approved / rejected" — text, once per decision. */
export async function notifyExpenseDecided(service: SupabaseClient, expenseId: string): Promise<void> {
  try {
    const { data, error } = await service
      .from("contractor_expenses").select("id, status, amount_cents, contractor_id, work_order_id, work_orders(wo_ref)")
      .eq("id", expenseId).maybeSingle();
    if (error) throw error;
    const row = data as {
      id: string; status: string; amount_cents: number; contractor_id: string; work_order_id: string;
      work_orders: { wo_ref: string } | null;
    } | null;
    if (!row?.work_orders || !["approved", "rejected"].includes(row.status)) return;
    if (!(await once(service, row.work_order_id, "expense_decided_notified", { expense_id: row.id, status: row.status }))) return;
    const { messaging, company } = await loadMessaging(service);
    if (!automationOn(messaging, "expense_decided")) return;
    const c = await contactFor(service, row.contractor_id);
    const body = renderTemplate(messaging.expenseDecidedSms, {
      first_name: c.firstName, company_name: company.name || "Paint Group",
      amount: "$" + (row.amount_cents / 100).toLocaleString("en-AU", { minimumFractionDigits: 2, maximumFractionDigits: 2 }),
      wo_ref: row.work_orders.wo_ref, decision: row.status,
      // Rejections carry no note on the claim today; the portal shows the status.
      reason_line: "",
    });
    await sendAutomation(service, {
      key: "expense_decided", to: { phone: c.phone }, sms: { body },
      ctx: { workOrderId: row.work_order_id, kind: "expense_decided" }, contractorId: row.contractor_id,
    });
    await record(service, row.work_order_id, "expense_decided_notified", { expense_id: row.id, status: row.status });
  } catch (e) {
    reportError(e, { where: "notify.expenseDecided", extra: { expenseId } });
  }
}

/**
 * "Your leave was approved / declined" — text. No work order to hang the
 * once-guard on, so the guard is the row itself: a decision is sent once per
 * (row, outcome) through a contractor_event.
 */
export async function notifyLeaveDecided(service: SupabaseClient, unavailabilityId: string): Promise<void> {
  try {
    const { data, error } = await service
      .from("contractor_unavailability").select("id, contractor_id, kind, start_date, end_date, approved_at, declined_at, decline_reason")
      .eq("id", unavailabilityId).maybeSingle();
    if (error) throw error;
    const row = data as {
      id: string; contractor_id: string; kind: string; start_date: string; end_date: string;
      approved_at: string | null; declined_at: string | null; decline_reason: string;
    } | null;
    if (!row || (!row.approved_at && !row.declined_at)) return;
    const decision = row.approved_at ? "approved" : "declined";
    const { data: sent, error: sentErr } = await service.from("contractor_events").select("id")
      .eq("contractor_id", row.contractor_id).eq("type", "leave_decided_notified")
      .contains("detail", { unavailability_id: row.id, decision }).limit(1);
    if (sentErr) throw sentErr;
    if ((sent ?? []).length > 0) return;
    const { messaging, company } = await loadMessaging(service);
    if (!automationOn(messaging, "leave_decided")) return;
    const c = await contactFor(service, row.contractor_id);
    const body = renderTemplate(messaging.leaveDecidedSms, {
      first_name: c.firstName, company_name: company.name || "Paint Group",
      kind_word: row.kind === "rdo" ? "RDO" : "leave",
      dates: row.start_date === row.end_date ? dmy(row.start_date) : `${dmy(row.start_date)} → ${dmy(row.end_date)}`,
      decision, reason_line: decision === "declined" && row.decline_reason ? ` ${row.decline_reason}` : "",
    });
    await sendAutomation(service, {
      key: "leave_decided", to: { phone: c.phone }, sms: { body },
      ctx: { kind: "leave_decided" }, contractorId: row.contractor_id,
    });
    await service.from("contractor_events").insert({
      contractor_id: row.contractor_id, type: "leave_decided_notified", detail: { unavailability_id: row.id, decision },
    });
  } catch (e) {
    reportError(e, { where: "notify.leaveDecided", extra: { unavailabilityId } });
  }
}
