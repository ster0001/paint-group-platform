import type { SupabaseClient } from "@supabase/supabase-js";
import { sendAutomation } from "@/lib/automations/dispatch";
import { contactFor } from "@/lib/contractor/notify";
import { normalisePhoneAU, renderTemplate } from "@/lib/messaging/config";
import { loadMessaging } from "@/lib/messaging/load";
import { buildPlainEmailHtml } from "@/lib/messaging/send";
import { emailLogoUrl } from "@/lib/messaging/logo";
import { isTestEmail } from "@/lib/accounts/identity";
import { siteUrl } from "@/lib/invoicing/pdf";
import { buildIcs } from "@/lib/workorder/ics";
import { addMinutes, kindLabel } from "@/lib/movements/evaluate";
import { dayWord } from "@/lib/movements/notify";

/**
 * The calendar invitation (Tom, 22 Oct 2026): when a movement goes onto a person's day and
 * the office confirms the day and time, that person gets an email with an .ics invitation —
 * the stop sits in their phone's calendar with the shop or the site as the location. The
 * SEQUENCE climbs with every send (movements.invite_sequence), so a moved stop edits the
 * entry rather than adding a second one. Staff and painters alike; nothing goes to a
 * supplier. Returns what happened in words for the toast.
 */
type Row = {
  id: string; work_order_id: string | null; kind: string; title: string; detail: string | null; status: string;
  assignee_kind: "supplier" | "person" | null; assignee_table: "profiles" | "contractors" | null; assignee_id: string | null;
  due_date: string | null; half: "AM" | "PM" | null; time: string | null; duration_min: number | null;
  from_kind: string | null; from_branch_id: string | null; from_text: string; to_text: string; order_ref: string; note: string; invite_sequence: number;
};

export type InviteOutcome = { ok: true; sent: true; to: string; texted: boolean } | { ok: true; sent: false; why: string; texted: boolean } | { ok: false; message: string };

/** "Please collect the paint (…) from Dulux Trade Oakleigh" — what the worker is asked to do, in words. */
export function askWord(m: { kind: string; title: string; from_kind: string | null; to_kind?: string | null; detail: string | null }, shop: string, site: string, warehouse: string): string {
  const what = m.title.split(" · ").slice(0, 2).join(" · ");
  switch (m.kind) {
    case "paint": return m.from_kind === "branch" ? `Please collect the paint (${what}) from ${shop}` : `Please bring the paint (${what}) from ${warehouse} to ${site}`;
    case "materials": case "restock": return m.from_kind === "branch" ? `Please pick up the materials (${what}) from ${shop}` : `Please bring the materials (${what}) from ${warehouse} to ${site}`;
    case "rubbish_out": return m.to_kind === "tip" ? `Please collect the rubbish from ${site} and take it to the tip` : `Please collect the rubbish from ${site}`;
    case "rubbish_in": return `Please see the skip in at ${site}`;
    case "equipment_out": case "hire_on": return `Please drop off the gear (${what}) at ${site}`;
    case "equipment_return": case "hire_off": case "repair_back": return `Please bring ${what} back from ${site}`;
    case "repair_out": return `Please take ${what} in for repair`;
    default: return `${what} at ${site}`;
  }
}

export async function sendMovementInvite(service: SupabaseClient, movementId: string): Promise<InviteOutcome> {
  const { data, error } = await service.from("movements")
    .select("id, work_order_id, kind, title, detail, status, assignee_kind, assignee_table, assignee_id, due_date, half, time, duration_min, from_kind, from_branch_id, from_text, to_text, order_ref, note, invite_sequence")
    .eq("id", movementId).maybeSingle();
  if (error) return { ok: false, message: `Couldn't read the movement: ${error.message}` };
  const m = data as Row | null;
  if (!m) return { ok: false, message: "That movement is not there any more." };
  if (m.assignee_kind !== "person" || !m.assignee_id || !m.due_date) return { ok: true, sent: false, why: "not on a person's day", texted: false };
  if (m.status === "cancelled" || m.status === "done") return { ok: true, sent: false, why: `the movement is ${m.status}`, texted: false };

  // Who, and where to send it.
  let to: string | null = null; let phone: string | null = null; let firstName = "there"; let contractorId: string | null = null;
  if (m.assignee_table === "contractors") {
    const c = await contactFor(service, m.assignee_id);
    to = c.email && !isTestEmail(c.email) ? c.email : null; phone = c.phone; firstName = c.firstName; contractorId = m.assignee_id;
  } else {
    const [prof, userRes] = await Promise.all([
      service.from("profiles").select("name, phone").eq("id", m.assignee_id).maybeSingle(),
      service.auth.admin.getUserById(m.assignee_id),
    ]);
    if (prof.error) return { ok: false, message: `Couldn't read the person: ${prof.error.message}` };
    if (userRes.error) return { ok: false, message: `Couldn't read the login: ${userRes.error.message}` };
    const u = userRes.data;
    const pr = prof.data as { name: string | null; phone?: string | null } | null;
    firstName = (pr?.name ?? "").trim().split(/\s+/)[0] || "there";
    phone = pr?.phone ? normalisePhoneAU(pr.phone) : null;
    to = u?.user?.email && !isTestEmail(u.user.email) ? u.user.email : null;
  }
  if (!to && !phone) return { ok: true, sent: false, why: `${firstName} has no email or phone on file`, texted: false };

  // Where: a pickup from a shop is at the shop; everything else is at the job (or the warehouse).
  const [jobRes, branchRes] = await Promise.all([
    m.work_order_id ? service.from("work_orders").select("id, wo_ref, job_no, wo_snapshot").eq("id", m.work_order_id).maybeSingle() : Promise.resolve({ data: null, error: null }),
    m.from_branch_id ? service.from("supplier_branches").select("brand, branch, address, suburb").eq("id", m.from_branch_id).maybeSingle() : Promise.resolve({ data: null, error: null }),
  ]);
  if (jobRes.error) return { ok: false, message: `Couldn't read the job: ${jobRes.error.message}` };
  if (branchRes.error) return { ok: false, message: `Couldn't read the shop: ${branchRes.error.message}` };
  const job = jobRes.data, branch = branchRes.data;
  const j = job as { id: string; wo_ref: string | null; job_no: number | null; wo_snapshot: { jobAddress?: string; jobTitle?: string } | null } | null;
  const b = branch as { brand: string; branch: string; address: string; suburb: string } | null;
  const ref = j ? (j.job_no != null ? `PG-${String(j.job_no).padStart(4, "0")}` : j.wo_ref ?? "the job") : "the warehouse";
  const site = j?.wo_snapshot?.jobAddress ?? "";
  const shop = b ? `${b.brand} ${b.branch}${b.address ? `, ${b.address}` : ""}${b.suburb ? `, ${b.suburb}` : ""}` : m.from_text;
  const pickup = m.from_kind === "branch" && Boolean(b);
  const location = pickup ? shop : site || m.to_text || "";
  const { messaging, company } = await loadMessaging(service);
  const companyName = company.name || "Paint Group";
  const what = `${kindLabel({ kind: m.kind as Parameters<typeof kindLabel>[0]["kind"], assignee_kind: m.assignee_kind, source_key: null, detail: m.detail, to_kind: null, title: m.title })} · ${m.title}`;
  const time = (m.time ?? (m.half === "PM" ? "13:00" : "07:00")).slice(0, 5);
  const minutes = m.duration_min ?? 60;
  const link = m.assignee_table === "contractors" ? `${siteUrl()}/portal/jobs/${m.work_order_id ?? ""}#logistics` : `${siteUrl()}/pc/movements/run?day=${m.due_date}&who=me`;
  const warehouse = m.from_text || "the warehouse";
  const vars = {
    first_name: firstName, company_name: companyName, wo_ref: ref, what, where: location || "see the job", day: dayWord(m.due_date),
    when: `${time}–${addMinutes(time, minutes)}`, order_ref: m.order_ref || "—", note: m.note || "", link,
    ask: askWord({ kind: m.kind, title: m.title, from_kind: m.from_kind, to_kind: null, detail: m.detail }, shop || "the shop", site || "the site", warehouse),
    order_line: m.order_ref ? `Order ${m.order_ref} under ${companyName}. ` : "",
  };
  // Tom, 22 Oct 2026: the text goes with the invitation — what to do, where and when.
  let texted = false;
  if (phone) {
    const t = await sendAutomation(service, {
      key: "movement_booked_text", to: { phone }, sms: { body: renderTemplate(messaging.movementBookedSms, vars) },
      ctx: { workOrderId: m.work_order_id, kind: "movement_booked_text" }, contractorId,
    });
    texted = t.outcome === "sent";
  }
  if (!to) return { ok: true, sent: false, why: `${firstName} has no email on file${texted ? " — the text went" : ""}`, texted };
  const subject = renderTemplate(messaging.movementInviteSubject, vars);
  const body = renderTemplate(messaging.movementInviteBody, vars);
  const ics = buildIcs({
    uid: `movement-${m.id}@paintgroup`, sequence: m.invite_sequence, method: "REQUEST",
    summary: `${companyName}: ${what}${j ? ` — ${ref}` : ""}`,
    description: [body, m.order_ref ? `Order ${m.order_ref}` : "", link].filter(Boolean).join("\n"),
    location: location || undefined, date: m.due_date, time, durationMinutes: minutes,
    organizerEmail: company.email || "info@paintgroup.com.au", organizerName: companyName,
    attendeeEmail: to, attendeeName: firstName, now: new Date(),
  });
  const sent = await sendAutomation(service, {
    key: "movement_calendar_invite",
    to: { email: to },
    email: {
      subject, replyTo: company.email || undefined,
      html: buildPlainEmailHtml({ heading: `${what} — ${dayWord(m.due_date)} ${time}`, message: body, companyName, logoUrl: emailLogoUrl(company), companyPhone: company.phone }),
      attachments: [{ filename: "movement.ics", content: Buffer.from(ics, "utf8").toString("base64"), contentType: "text/calendar; method=REQUEST" }],
    },
    ctx: { workOrderId: m.work_order_id, kind: "movement_calendar_invite" }, contractorId,
  });
  if (sent.outcome === "error") return { ok: false, message: sent.message };
  if (sent.outcome !== "sent") {
    const why = sent.outcome === "off" ? "the invitation automation is switched off" : sent.outcome === "nobody" ? sent.detail
      : sent.outcome === "pending" ? "waiting for approval in Automations" : "held until the quiet hours end";
    return { ok: true, sent: false, why, texted };
  }
  const { error: recErr } = await service.rpc("movement_record_invite", { p_id: m.id });
  if (recErr) return { ok: false, message: `Sent, but could not record it: ${recErr.message}` };
  return { ok: true, sent: true, to, texted };
}
