import type { SupabaseClient } from "@supabase/supabase-js";
import { dispatched, sendAutomation } from "@/lib/automations/dispatch";
import { contactFor } from "@/lib/contractor/notify";
import { normalisePhoneAU, renderTemplate } from "@/lib/messaging/config";
import { loadMessaging } from "@/lib/messaging/load";
import { isTestEmail } from "@/lib/accounts/identity";
import { siteUrl } from "@/lib/invoicing/pdf";
import { reportError } from "@/lib/monitoring/report";
import { realOnly } from "@/lib/demo/scope";

/**
 * Movements — the texts (brief §3.5, Session 5). SERVER ONLY — service client.
 *
 * Three moments reach a phone:
 *   - the ORDER STEP (`movement_mark_ordered`): a pickup on a painter's lane → "ready at
 *     <shop>, <address>, from <time>, order <ref>"; a supplier delivery → "coming to site
 *     <day> <when>"; and, only when the chip's Client notice is on (ruling 11), the
 *     customer hears a delivery is coming;
 *   - SEND TO PHONE on the Day view: the person's run for the day with a link to their own
 *     list (staff → /pc/movements/run, painters → the portal's card);
 *   - the 6 pm SWEEP: a supplier delivery due today that nobody ticked Done → "did it
 *     arrive?" to the job's painter.
 *
 * Every send goes through the automations dispatcher, so Settings → Automations decides
 * the channel and whether the office approves each text first (draft-first is the
 * default — build plan §3, Session 5). Nothing here writes a movement row directly: the
 * "told" stamp is `movement_record_alert` (migration 20270281), and a skipped send is a
 * wo_events row so the board can say why nobody was texted. Best-effort, like every
 * painter ping: a lost text never unwinds the order it announces.
 */

type MovementForAlert = {
  id: string; work_order_id: string | null; kind: string; title: string; status: string;
  assignee_kind: "supplier" | "person" | null; assignee_table: "profiles" | "contractors" | null; assignee_id: string | null;
  due_date: string | null; half: "AM" | "PM" | null; time: string | null;
  from_kind: string | null; from_branch_id: string | null; from_text: string; to_text: string;
  order_ref: string; client_notice: boolean; painter_alerted_at: string | null; client_notified_at: string | null; ordered_at: string | null;
};
type BranchForAlert = { id: string; brand: string; branch: string; address: string; suburb: string; opens_weekday: string | null };
type JobForAlert = {
  id: string; wo_ref: string | null; job_no: number | null; contractor_id: string | null; estimate_id: string | null;
  wo_snapshot: { jobAddress?: string } | null;
};

const MOVEMENT_COLUMNS = "id, work_order_id, kind, title, status, assignee_kind, assignee_table, assignee_id, due_date, half, time, from_kind, from_branch_id, from_text, to_text, order_ref, client_notice, painter_alerted_at, client_notified_at, ordered_at";

/** "Tue 21 Oct" for an ISO date, in Melbourne (never the UTC date — CLAUDE.md, Dates). */
export function dayWord(iso: string | null): string {
  if (!iso) return "";
  const [y, m, d] = iso.split("-").map(Number);
  // 02:00 UTC is midday or 1 pm in Melbourne all year, so the calendar day cannot shift.
  const at = new Date(Date.UTC(y, m - 1, d, 2));
  const parts = new Intl.DateTimeFormat("en-AU", { timeZone: "Australia/Melbourne", weekday: "short", day: "numeric", month: "short" }).formatToParts(at);
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? "";
  return `${get("weekday")} ${get("day")} ${get("month")}`;
}

/** "from 6:30" / "in the morning" / "in the afternoon" — what the painter is told about when. */
export function whenWord(m: Pick<MovementForAlert, "time" | "half">): string {
  if (m.time) return `at ${clock(m.time)}`;
  return m.half === "PM" ? "in the afternoon" : "in the morning";
}

const clock = (t: string) => {
  const [h, mm] = t.slice(0, 5).split(":").map(Number);
  const suffix = h >= 12 ? "pm" : "am";
  const hour = h % 12 === 0 ? 12 : h % 12;
  return `${hour}:${String(mm).padStart(2, "0")} ${suffix}`;
};

const jobRef = (j: Pick<JobForAlert, "wo_ref" | "job_no">) => (j.job_no != null ? `PG-${String(j.job_no).padStart(4, "0")}` : j.wo_ref ?? "your job");

const record = (service: SupabaseClient, workOrderId: string | null, type: string, meta: Record<string, unknown>) =>
  workOrderId ? service.from("wo_events").insert({ work_order_id: workOrderId, type, actor_kind: "system", meta }) : Promise.resolve({ error: null });

async function readMovement(service: SupabaseClient, movementId: string): Promise<{ m: MovementForAlert | null; job: JobForAlert | null; branch: BranchForAlert | null }> {
  const { data, error } = await service.from("movements").select(MOVEMENT_COLUMNS).eq("id", movementId).maybeSingle();
  if (error) throw new Error(`movement: ${error.message}`);
  const m = (data as MovementForAlert | null) ?? null;
  if (!m) return { m: null, job: null, branch: null };
  const [jobRes, branchRes] = await Promise.all([
    m.work_order_id ? service.from("work_orders").select("id, wo_ref, job_no, contractor_id, estimate_id, wo_snapshot").eq("id", m.work_order_id).maybeSingle() : Promise.resolve({ data: null, error: null }),
    m.from_branch_id ? service.from("supplier_branches").select("id, brand, branch, address, suburb, opens_weekday").eq("id", m.from_branch_id).maybeSingle() : Promise.resolve({ data: null, error: null }),
  ]);
  if (jobRes.error) throw new Error(`job: ${jobRes.error.message}`);
  if (branchRes.error) throw new Error(`branch: ${branchRes.error.message}`);
  return { m, job: (jobRes.data as JobForAlert | null) ?? null, branch: (branchRes.data as BranchForAlert | null) ?? null };
}

/** The painter a job's texts go to: the lead assignment, else work_orders.contractor_id. */
async function painterOf(service: SupabaseClient, job: JobForAlert | null): Promise<string | null> {
  if (!job) return null;
  const { data, error } = await realOnly(service.from("wo_assignments").select("contractor_id, is_lead")).eq("work_order_id", job.id).order("is_lead", { ascending: false }).limit(1);
  if (error) throw new Error(`assignments: ${error.message}`);
  const lead = (data as { contractor_id: string }[] | null)?.[0]?.contractor_id;
  return lead ?? job.contractor_id ?? null;
}

/**
 * The order step → the painter (and, when flagged, the customer). Idempotent: a movement
 * already stamped painter_alerted_at is not texted again; Back to tray clears the stamp
 * (20270279 movement_unplace), so re-ordering alerts again — as it should.
 */
export async function notifyMovementOrdered(service: SupabaseClient, movementId: string): Promise<void> {
  try {
    const { m, job, branch } = await readMovement(service, movementId);
    if (!m || !m.ordered_at || m.status === "cancelled") return;
    const { messaging, company } = await loadMessaging(service);
    const companyName = company.name || "Paint Group";
    const ref = job ? jobRef(job) : "the warehouse";
    const link = job ? `${siteUrl()}/portal/jobs/${job.id}#logistics` : `${siteUrl()}/portal`;
    const isPickup = m.assignee_kind === "person";

    if (!m.painter_alerted_at) {
      // A pickup on a contractor's lane texts THAT painter; a staff pickup texts nobody (they
      // are on the board); a delivery texts the job's painter.
      const contractorId = isPickup
        ? (m.assignee_table === "contractors" ? m.assignee_id : null)
        : await painterOf(service, job);
      if (!contractorId) {
        await record(service, m.work_order_id, "movement_alert_skipped", { movement_id: m.id, reason: isPickup ? "staff pickup — on the board" : "no painter on the job yet" });
      } else {
        const c = await contactFor(service, contractorId);
        const vars = {
          first_name: c.firstName, company_name: companyName, wo_ref: ref, what: m.title,
          shop: branch ? `${branch.brand} ${branch.branch}` : m.from_text || "the shop",
          shop_address: branch ? [branch.address, branch.suburb].filter(Boolean).join(", ") : "",
          from_time: branch?.opens_weekday ? clock(branch.opens_weekday) : m.time ? clock(m.time) : "opening",
          day: dayWord(m.due_date), when: whenWord(m), order_ref: m.order_ref || "—", link,
        };
        const key = isPickup ? "movement_pickup_ready" : "movement_delivery_booked";
        const body = renderTemplate(isPickup ? messaging.movementPickupReadySms : messaging.movementDeliveryBookedSms, vars);
        const outcome = await sendAutomation(service, {
          key, to: { phone: c.phone, email: c.email && !isTestEmail(c.email) ? c.email : null }, sms: { body },
          ctx: { workOrderId: m.work_order_id, kind: key }, contractorId,
        });
        if (dispatched(outcome)) {
          const { error } = await service.rpc("movement_record_alert", { p_id: m.id, p_target: "painter" });
          if (error) reportError(new Error(error.message), { where: "movements.notify.recordPainter", extra: { movementId } });
        } else {
          await record(service, m.work_order_id, "movement_alert_skipped", { movement_id: m.id, reason: outcome.outcome, detail: "detail" in outcome ? outcome.detail : null });
        }
      }
    }

    // Ruling 11: the customer hears about a DELIVERY only when this chip says so.
    if (!isPickup && m.client_notice && !m.client_notified_at && job) {
      const customer = await customerOf(service, job);
      if (!customer.phone && !customer.email) {
        await record(service, m.work_order_id, "movement_alert_skipped", { movement_id: m.id, target: "client", reason: "no customer contact" });
      } else {
        const body = renderTemplate(messaging.movementDeliveryClientNoticeSms, {
          first_name: customer.firstName, company_name: companyName, address: job.wo_snapshot?.jobAddress ?? "your home",
          what: m.title, day: dayWord(m.due_date), when: whenWord(m),
        });
        const outcome = await sendAutomation(service, {
          key: "movement_delivery_client_notice", to: { phone: customer.phone, email: customer.email }, sms: { body },
          ctx: { workOrderId: m.work_order_id, estimateId: job.estimate_id, accountId: customer.accountId, kind: "movement_delivery_client_notice" },
        });
        if (dispatched(outcome)) {
          const { error } = await service.rpc("movement_record_alert", { p_id: m.id, p_target: "client" });
          if (error) reportError(new Error(error.message), { where: "movements.notify.recordClient", extra: { movementId } });
        } else {
          await record(service, m.work_order_id, "movement_alert_skipped", { movement_id: m.id, target: "client", reason: outcome.outcome });
        }
      }
    }
  } catch (e) {
    reportError(e, { where: "movements.notify.ordered", extra: { movementId } });
  }
}

type CustomerContact = { firstName: string; phone: string | null; email: string | null; accountId: string | null };

/** The customer on the job's estimate: the builder's contact first, the account behind it as the fallback. */
async function customerOf(service: SupabaseClient, job: JobForAlert): Promise<CustomerContact> {
  if (!job.estimate_id) return { firstName: "there", phone: null, email: null, accountId: null };
  const { data: est, error: estError } = await service.from("estimates").select("customer_id, builder_state").eq("id", job.estimate_id).maybeSingle();
  if (estError) throw new Error(`estimate: ${estError.message}`);
  const e = est as { customer_id: string | null; builder_state: { contact?: { first_name?: string; name?: string; phone?: string; email?: string } } | null } | null;
  const contact = e?.builder_state?.contact ?? {};
  let phone = contact.phone ? normalisePhoneAU(contact.phone) : null;
  let email = contact.email?.trim() || null;
  let name = contact.first_name || contact.name || "";
  if ((!phone || !email) && e?.customer_id) {
    const { data: acc, error: accError } = await service.from("accounts").select("name, email, phone").eq("id", e.customer_id).maybeSingle();
    if (accError) throw new Error(`account: ${accError.message}`);
    const a = acc as { name: string | null; email: string | null; phone: string | null } | null;
    phone = phone ?? (a?.phone ? normalisePhoneAU(a.phone) : null);
    email = email ?? a?.email ?? null;
    name = name || a?.name || "";
  }
  if (email && isTestEmail(email)) email = null;
  return { firstName: name.trim().split(/\s+/)[0] || "there", phone, email, accountId: e?.customer_id ?? null };
}

/**
 * Send to <name>'s phone (Day view). The RPC has already stamped run_plan_sent_at on the
 * stops and logged the event; this is the text. Staff get their own run view, painters the
 * portal card. The stop count and km come from the evaluator on the screen that pressed
 * Send — display words, not a record.
 */
export async function notifyRunPlan(service: SupabaseClient, person: { kind: "profiles" | "contractors"; id: string }, day: string, plan: { stops: number; km: number }): Promise<void> {
  try {
    const { messaging, company } = await loadMessaging(service);
    const companyName = company.name || "Paint Group";
    let to: { phone: string | null; email: string | null }; let firstName: string; let link: string; let contractorId: string | null = null;
    if (person.kind === "contractors") {
      const c = await contactFor(service, person.id);
      to = { phone: c.phone, email: c.email && !isTestEmail(c.email) ? c.email : null }; firstName = c.firstName; contractorId = person.id;
      link = `${siteUrl()}/portal?day=${day}#movements`;
    } else {
      const { data: p, error: pError } = await service.from("profiles").select("name, phone").eq("id", person.id).maybeSingle();
      if (pError) throw new Error(`profile: ${pError.message}`);
      const prof = p as { name: string | null; phone?: string | null } | null;
      const { data: u } = await service.auth.admin.getUserById(person.id);
      to = { phone: prof?.phone ? normalisePhoneAU(prof.phone) : null, email: u?.user?.email && !isTestEmail(u.user.email) ? u.user.email : null };
      firstName = (prof?.name ?? "").trim().split(/\s+/)[0] || "there";
      link = `${siteUrl()}/pc/movements/run?day=${day}&who=me`;
    }
    const body = renderTemplate(messaging.movementRunPlanSms, {
      first_name: firstName, company_name: companyName, day: dayWord(day), stops: String(plan.stops), km: String(Math.round(plan.km)), link,
    });
    await sendAutomation(service, { key: "movement_run_plan", to, sms: { body }, ctx: { kind: "movement_run_plan" }, contractorId });
  } catch (e) {
    reportError(e, { where: "movements.notify.runPlan", extra: { person, day } });
  }
}

/**
 * The 6 pm sweep: every supplier delivery due today still only booked → "did it arrive?"
 * to the job's painter, once per movement (wo_events movement_arrived_check). Returns how
 * many it asked.
 */
export async function sendArrivedChecks(service: SupabaseClient, today: string): Promise<number> {
  const { data, error } = await realOnly(service.from("movements").select(MOVEMENT_COLUMNS))
    .eq("assignee_kind", "supplier").eq("due_date", today).eq("status", "booked").not("work_order_id", "is", null);
  if (error) throw new Error(`arrived checks: ${error.message}`);
  const due = (data ?? []) as MovementForAlert[];
  if (due.length === 0) return 0;
  const { messaging, company } = await loadMessaging(service);
  const companyName = company.name || "Paint Group";
  let asked = 0;
  for (const m of due) {
    try {
      const { data: seen, error: seenError } = await service.from("wo_events").select("id").eq("work_order_id", m.work_order_id!).eq("type", "movement_arrived_check").contains("meta", { movement_id: m.id }).limit(1);
      if (seenError) throw new Error(`events: ${seenError.message}`);
      if ((seen ?? []).length > 0) continue;
      const { data: w, error: wError } = await service.from("work_orders").select("id, wo_ref, job_no, contractor_id, estimate_id, wo_snapshot").eq("id", m.work_order_id!).maybeSingle();
      if (wError) throw new Error(`job: ${wError.message}`);
      const job = (w as JobForAlert | null) ?? null;
      const contractorId = await painterOf(service, job);
      if (!job || !contractorId) continue;
      const c = await contactFor(service, contractorId);
      const body = renderTemplate(messaging.movementArrivedCheckSms, {
        first_name: c.firstName, company_name: companyName, wo_ref: jobRef(job), what: m.title, shop: "", shop_address: "", from_time: "",
        day: dayWord(today), when: whenWord(m), order_ref: m.order_ref || "—", link: `${siteUrl()}/portal/jobs/${job.id}#logistics`,
      });
      const outcome = await sendAutomation(service, {
        key: "movement_arrived_check", to: { phone: c.phone, email: c.email && !isTestEmail(c.email) ? c.email : null }, sms: { body },
        ctx: { workOrderId: m.work_order_id, kind: "movement_arrived_check" }, contractorId,
      });
      await record(service, m.work_order_id, "movement_arrived_check", { movement_id: m.id, outcome: outcome.outcome });
      if (dispatched(outcome)) asked += 1;
    } catch (e) {
      reportError(e, { where: "movements.notify.arrivedCheck", extra: { movementId: m.id } });
    }
  }
  return asked;
}
