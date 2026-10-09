import type { SupabaseClient } from "@supabase/supabase-js";
import { buildIcs } from "./ics";
import { qaCheckLabel } from "./qaSchedule";
import { buildPlainEmailHtml, sendEmail } from "@/lib/messaging/send";
import { automationOn } from "@/lib/messaging/config";
import { loadMessaging } from "@/lib/messaging/load";
import { emailLogoUrl } from "@/lib/messaging/logo";
import { siteUrl } from "@/lib/invoicing/pdf";
import { loadStaffForEvent, recipientsFor } from "@/lib/staff/notify";
import { reportError } from "@/lib/monitoring/report";

/**
 * Felipe's calendar (Tom, 8 Oct 2026: "go into Felipe's calendar as a calendar
 * request"). SERVER ONLY — service client.
 *
 * Every dated quality check and job check-in goes to whoever is ticked for
 * "QA invite" in Settings → Staff alerts (profiles.staff_notify key
 * office_qa_check_invite) as an email with an .ics invite: METHOD:REQUEST
 * with a stable UID per check, so a moved check (the final moved, the office
 * moved it) EDITS the entry with SEQUENCE+1, and a check taken off the books
 * (waived, cleared) sends METHOD:CANCEL. A recorded check keeps its entry.
 *
 * Reconciler-shaped, like the walkthrough invites: it reads the checks as they
 * are and what was last sent, and sends only the difference. Every send — and
 * "nobody is ticked", and a failure — is recorded as a `qa_check_invite`
 * wo_event, which is both the PC's "invite sent" line and what makes the next
 * call idempotent. Any trigger that may have moved a check calls it; a missed
 * one heals on the next (the walkthrough reconcile and the daily sweep).
 */

export type QaInviteCheck = { id: string; kind: string; date: string | null; time: string | null; open: boolean };
export type QaInviteOutcome = "sent" | "nobody" | "not_configured" | "error";
export type QaInviteEvent = {
  checkId: string; kind: string; method: "REQUEST" | "CANCEL";
  date: string; time: string | null; outcome: QaInviteOutcome; hash: string; createdAt: string;
};
export type QaInviteAction = {
  checkId: string; kind: string; method: "REQUEST" | "CANCEL";
  date: string; time: string | null; sequence: number; hash: string;
};

const RETRY_AFTER_MS = 60 * 60_000;

export const qaInviteUid = (checkId: string) => `qa-check-${checkId}@paintgroup`;

/**
 * Pure: what to send for each check, given what was already sent. The hash
 * carries who it goes to, so ticking someone new re-sends the current state.
 */
export function planQaInvites(
  checks: readonly QaInviteCheck[],
  events: readonly QaInviteEvent[],
  recipientsKey: string,
  now: Date,
): QaInviteAction[] {
  const ids = [...new Set([...checks.map((c) => c.id), ...events.map((e) => e.checkId)])];
  const out: QaInviteAction[] = [];
  for (const id of ids) {
    const evs = events.filter((e) => e.checkId === id).sort((a, b) => a.createdAt.localeCompare(b.createdAt));
    const last = evs[evs.length - 1];
    if (last?.outcome === "error" && now.getTime() - Date.parse(last.createdAt) < RETRY_AFTER_MS) continue;
    const settled = [...evs].reverse().find((e) => e.outcome !== "error");
    const sentOnes = evs.filter((e) => e.outcome === "sent");
    const lastSent = sentOnes[sentOnes.length - 1];
    const check = checks.find((c) => c.id === id);

    let want: { method: "REQUEST" | "CANCEL"; date: string; time: string | null; kind: string } | null = null;
    if (check && check.open && check.date) want = { method: "REQUEST", date: check.date, time: check.time, kind: check.kind };
    else if (check && !check.open) want = null;
    else if (lastSent?.method === "REQUEST") want = { method: "CANCEL", date: lastSent.date, time: lastSent.time, kind: lastSent.kind };
    if (!want) continue;

    const hash = `${want.method}:${want.date}:${want.time ?? "-"}:${recipientsKey}`;
    if (settled?.hash === hash) continue;
    out.push({ checkId: id, kind: want.kind, method: want.method, date: want.date, time: want.time, sequence: sentOnes.length, hash });
  }
  return out;
}

const dayWords = (date: string) =>
  new Date(`${date}T12:00:00Z`).toLocaleDateString("en-AU", { weekday: "long", day: "numeric", month: "long", timeZone: "UTC" });

/** A site check-in the office removed: its history went with its row, so the caller hands it over for the CANCEL. */
export type RemovedVisitInvites = { id: string; log: Record<string, unknown>[] };

export async function sendQaCheckInvites(service: SupabaseClient, workOrderId: string, removed: readonly RemovedVisitInvites[] = []): Promise<void> {
  try {
    await run(service, workOrderId, removed);
  } catch (e) {
    reportError(e, { where: "qaCheckInvite", extra: { workOrderId } });
  }
}

async function run(service: SupabaseClient, workOrderId: string, removed: readonly RemovedVisitInvites[]): Promise<void> {
  const { messaging, company } = await loadMessaging(service);
  // Settings → Automations: "Quality check calendar invite". Off = nothing
  // sent and nothing recorded; switching it back on sends the current state.
  if (!automationOn(messaging, "office_qa_check_invite")) return;

  const [woRes, checksRes, eventsRes, finalRes, visitsRes] = await Promise.all([
    service.from("work_orders")
      .select("id, wo_ref, stage, wo_snapshot, contractors(company_name, profiles(name))")
      .eq("id", workOrderId).maybeSingle(),
    service.from("wo_qa_checks").select("id, kind, result, scheduled_for, scheduled_time").eq("work_order_id", workOrderId),
    service.from("wo_events").select("meta, created_at")
      .eq("work_order_id", workOrderId).eq("type", "qa_check_invite").order("created_at").limit(500),
    service.from("wo_walkthroughs").select("scheduled_date, scheduled_time")
      .eq("work_order_id", workOrderId).eq("kind", "final").eq("status", "booked")
      .order("created_at", { ascending: false }).limit(1),
    // Site check-ins (20270248) are not checks, but they are Felipe's visits and
    // go in the same calendar. Their invite history lives on the row, not in
    // wo_events (which the job's painter and customer can read).
    service.from("wo_site_visits").select("id, scheduled_for, scheduled_time, visited_at, invite_log").eq("work_order_id", workOrderId),
  ]);
  if (woRes.error) throw new Error(`work order: ${woRes.error.message}`);
  if (visitsRes.error) throw new Error(`site check-ins: ${visitsRes.error.message}`);
  if (checksRes.error) throw new Error(`checks: ${checksRes.error.message}`);
  if (eventsRes.error) throw new Error(`invite history: ${eventsRes.error.message}`);
  if (finalRes.error) throw new Error(`final walkthrough: ${finalRes.error.message}`);
  const wo = woRes.data as {
    id: string; wo_ref: string; stage: string;
    wo_snapshot: { jobAddress?: string; jobTitle?: string } | null;
    contractors: { company_name: string | null; profiles: { name: string | null } | null } | null;
  } | null;
  if (!wo) return;

  const closed = wo.stage === "closed";
  const checks: QaInviteCheck[] = ((checksRes.data ?? []) as { id: string; kind: string; result: string | null; scheduled_for: string | null; scheduled_time: string | null }[])
    .map((c) => ({ id: c.id, kind: c.kind, date: c.scheduled_for, time: c.scheduled_time?.slice(0, 5) ?? null, open: c.result === null && !closed }));
  type VisitRow = { id: string; scheduled_for: string | null; scheduled_time: string | null; visited_at: string | null; invite_log: (InviteMeta & { created_at?: string })[] | null };
  const visitRows = (visitsRes.data ?? []) as VisitRow[];
  // A visit's entry stays once it is visited (open = false keeps it), exactly
  // like a recorded check; removing a visit cancels it (no row, last sent REQUEST).
  for (const v of visitRows) {
    checks.push({ id: v.id, kind: "visit", date: v.scheduled_for, time: v.scheduled_time?.slice(0, 5) ?? null, open: v.visited_at === null && !closed });
  }
  type InviteMeta = { check_id?: string; kind?: string; method?: string; date?: string; time?: string | null; outcome?: QaInviteOutcome; hash?: string };
  const visitIds = new Set(visitRows.map((v) => v.id));
  const eventRows: { meta: InviteMeta | null; created_at: string }[] = [
    // A visit moved from wo_qa_checks keeps its id; its history moved with it.
    ...((eventsRes.data ?? []) as { meta: InviteMeta | null; created_at: string }[]).filter((e) => !e.meta?.check_id || !visitIds.has(e.meta.check_id)),
    ...visitRows.flatMap((v) => (Array.isArray(v.invite_log) ? v.invite_log : []).map((m) => ({ meta: m, created_at: m.created_at ?? "" }))),
    ...removed.flatMap((r) => r.log.map((m) => ({ meta: m as InviteMeta, created_at: typeof m.created_at === "string" ? m.created_at : "" }))),
  ];
  const events: QaInviteEvent[] = [];
  for (const e of eventRows) {
    const m = e.meta;
    if (!m?.check_id || !m.hash) continue;
    events.push({
      checkId: m.check_id, kind: m.kind ?? "final", method: m.method === "CANCEL" ? "CANCEL" : "REQUEST",
      date: m.date ?? "", time: m.time ?? null, outcome: m.outcome ?? "sent", hash: m.hash, createdAt: e.created_at,
    });
  }

  const staff = await loadStaffForEvent(service, "office_qa_check_invite");
  const recipients = recipientsFor(staff, "office_qa_check_invite").filter((r) => r.channel === "email");
  const nameOf = new Map(staff.map((p) => [p.id, p.name || "the office"]));
  const recipientsKey = recipients.map((r) => r.profileId).sort().join(",");

  const plan = planQaInvites(checks, events, recipientsKey, new Date());
  if (plan.length === 0) return;

  const companyName = company.name || "Paint Group";
  const organizerEmail = company.email || "email@paintgroup.com.au";
  const address = wo.wo_snapshot?.jobAddress || wo.wo_snapshot?.jobTitle || wo.wo_ref;
  const painter = wo.contractors?.profiles?.name || wo.contractors?.company_name || "the painter";
  const final = ((finalRes.data ?? []) as { scheduled_date: string; scheduled_time: string | null }[])[0] ?? null;
  const finalLine = final
    ? `Final walkthrough with the client: ${dayWords(final.scheduled_date)}${final.scheduled_time ? ` at ${final.scheduled_time.slice(0, 5)}` : ""}.`
    : "No final walkthrough is booked yet.";
  const link = `${siteUrl()}/pc/wo/${wo.id}`;

  for (const a of plan) {
    const label = qaCheckLabel(a.kind);
    const when = `${dayWords(a.date)}${a.time ? ` at ${a.time}` : ""}`;
    const summary = `${label} — ${address} (${wo.wo_ref})`;
    const message = a.method === "CANCEL"
      ? `The ${label.toLowerCase()} at ${address} on ${when} is off — it has been taken out of your calendar.`
      : `${label} at ${address} — ${when}.\n\n${painter} is the painter on ${wo.wo_ref}. ${a.kind === "final" ? finalLine : ""}\n\nRecord it on the job page: ${link}`;

    const results: { profile_id: string; status: string }[] = [];
    for (const r of recipients) {
      const ics = buildIcs({
        uid: qaInviteUid(a.checkId), sequence: a.sequence, method: a.method, summary,
        description: `${label} for ${wo.wo_ref} (${painter}). ${a.kind === "final" ? finalLine : ""} ${link}`.trim(),
        location: address, date: a.date, time: a.time, durationMinutes: 60,
        organizerEmail, organizerName: companyName,
        attendeeEmail: r.to, attendeeName: nameOf.get(r.profileId) ?? "Quality checks",
        now: new Date(),
      });
      const res = await sendEmail({
        to: r.to,
        subject: a.method === "CANCEL" ? `Cancelled: ${summary}` : summary,
        replyTo: company.email || undefined,
        html: buildPlainEmailHtml({
          heading: a.method === "CANCEL" ? `${label} cancelled` : `${label} — ${when}`,
          message, companyName, logoUrl: emailLogoUrl(company), companyPhone: company.phone,
        }),
        attachments: [{
          filename: a.method === "CANCEL" ? "check-cancelled.ics" : "quality-check.ics",
          content: Buffer.from(ics, "utf8").toString("base64"),
          contentType: `text/calendar; method=${a.method}`,
        }],
        // A staff-only send: never on a customer's thread.
        ctx: { kind: "staff_alert" },
      });
      results.push({ profile_id: r.profileId, status: res.status });
    }

    const outcome: QaInviteOutcome = recipients.length === 0 ? "nobody"
      : results.some((x) => x.status === "sent") ? "sent"
      : results.every((x) => x.status === "not_configured") ? "not_configured"
      : "error";
    if (outcome === "error") {
      reportError(new Error("quality check invite failed"), { where: "qaCheckInvite.send", extra: { workOrderId, checkId: a.checkId, results } });
    }
    const meta = {
      check_id: a.checkId, kind: a.kind, method: a.method, date: a.date, time: a.time,
      sequence: a.sequence, hash: a.hash, outcome, to: results,
    };
    const visit = visitRows.find((v) => v.id === a.checkId);
    if (visit) {
      const log = [...(Array.isArray(visit.invite_log) ? visit.invite_log : []), { ...meta, created_at: new Date().toISOString() }];
      visit.invite_log = log;
      const { error } = await service.from("wo_site_visits").update({ invite_log: log }).eq("id", visit.id);
      if (error) reportError(error, { where: "qaCheckInvite.recordVisit", extra: { workOrderId, visitId: visit.id } });
    } else if (a.kind !== "visit") {
      const { error } = await service.from("wo_events").insert({
        work_order_id: workOrderId, type: "qa_check_invite", actor_kind: "system", meta,
      });
      if (error) reportError(error, { where: "qaCheckInvite.record", extra: { workOrderId, checkId: a.checkId } });
    }
  }
}
