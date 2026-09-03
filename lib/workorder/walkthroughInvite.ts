import type { SupabaseClient } from "@supabase/supabase-js";
import { buildIcs } from "./ics";
import { sendEmail, emailConfigured, buildPlainEmailHtml } from "@/lib/messaging/send";
import { isTestEmail } from "@/lib/accounts/identity";
import { reportError } from "@/lib/monitoring/report";
import { automationOn, renderTemplate } from "@/lib/messaging/config";
import { loadMessaging } from "@/lib/messaging/load";

/**
 * Final-walkthrough calendar invites (Tom, 1 Sep). SERVER ONLY — service client.
 *
 * When the final walkthrough is booked (or moved), the customer and the
 * painter each get their own email with an .ics invite attached —
 * "Final walk through — (customer x painter)". The UID is stable per job and
 * SEQUENCE climbs on every send, so a date change EDITS the entry already in
 * their calendars; a cancellation sends METHOD:CANCEL and pulls it.
 *
 * Idempotent by content: the last `walkthrough_invite` wo_event carries a
 * hash of what was sent — an unchanged booking sends nothing. Every trigger
 * (book, rebook, finish-date move, cancel) calls this same reconciler-shaped
 * function, so a missed trigger heals on the next one (the gcal-sync rule).
 */

type InviteState = {
  date: string;
  time: string | null;
  cancelled: boolean;
};

const hashOf = (s: InviteState) => `${s.cancelled ? "X" : "B"}:${s.date}:${s.time ?? "-"}`;

export async function sendWalkthroughInvites(
  service: SupabaseClient,
  workOrderId: string,
): Promise<void> {
  try {
    await run(service, workOrderId);
  } catch (e) {
    reportError(e, { where: "walkthroughInvite", extra: { workOrderId } });
  }
}

async function run(service: SupabaseClient, workOrderId: string): Promise<void> {
  const { data: w } = await service
    .from("work_orders")
    .select("id, wo_ref, estimate_id, contractor_id, walkthrough_required, wo_snapshot, estimates(accepted_name, builder_state, sent_snapshot)")
    .eq("id", workOrderId)
    .maybeSingle();
  const wo = w as {
    id: string; wo_ref: string; estimate_id: string; contractor_id: string | null;
    walkthrough_required: boolean | null;
    wo_snapshot: { jobAddress?: string; jobTitle?: string } | null;
    estimates: {
      accepted_name: string | null;
      builder_state: { contact?: { first_name?: string; last_name?: string; email?: string } } | null;
      sent_snapshot: { jobAddress?: string; contactEmail?: string } | null;
    } | null;
  } | null;
  if (!wo?.estimates) return;

  const { data: wRows } = await service
    .from("wo_walkthroughs")
    .select("id, scheduled_date, scheduled_time, status")
    .eq("work_order_id", workOrderId)
    .eq("kind", "final")
    .order("created_at", { ascending: false })
    .limit(1);
  const booked = ((wRows ?? []) as { scheduled_date: string; scheduled_time: string | null; status: string }[])
    .find((r) => r.status === "booked");

  // What was last sent (for the sequence, the dedupe hash, and a CANCEL's dates).
  const { data: prior } = await service
    .from("wo_events")
    .select("id, meta")
    .eq("work_order_id", workOrderId)
    .eq("type", "walkthrough_invite")
    .order("created_at", { ascending: false })
    .limit(50);
  const priorEvents = (prior ?? []) as { meta: { hash?: string; date?: string; time?: string | null } | null }[];
  const lastMeta = priorEvents[0]?.meta ?? null;

  const cancelled = !booked || wo.walkthrough_required === false;
  const state: InviteState = cancelled
    ? { date: lastMeta?.date ?? "", time: lastMeta?.time ?? null, cancelled: true }
    : { date: booked.scheduled_date, time: booked.scheduled_time?.slice(0, 5) ?? null, cancelled: false };

  // Nothing was ever sent and there is nothing to send — or nothing changed.
  if (cancelled && priorEvents.length === 0) return;
  if (cancelled && !state.date) return;
  if (lastMeta?.hash === hashOf(state)) return;

  // Who's coming: the customer off the estimate, the painter off the job.
  const contact = wo.estimates.builder_state?.contact ?? {};
  const customerEmail = (contact.email || wo.estimates.sent_snapshot?.contactEmail || "").trim();
  const customerName = [contact.first_name, contact.last_name].filter(Boolean).join(" ").trim()
    || (wo.estimates.accepted_name ?? "").trim();
  const customerFirst = customerName.split(/\s+/)[0] || "there";

  let painterName = "";
  let painterEmail = "";
  if (wo.contractor_id) {
    const { data: c } = await service
      .from("contractors").select("profile_id, company_name, profiles(name)")
      .eq("id", wo.contractor_id).maybeSingle();
    const contractor = c as { profile_id: string | null; company_name: string | null; profiles: { name: string | null } | null } | null;
    painterName = (contractor?.profiles?.name || contractor?.company_name || "").trim();
    if (contractor?.profile_id) {
      const { data: u } = await service.auth.admin.getUserById(contractor.profile_id);
      painterEmail = u?.user?.email ?? "";
    }
  }
  const painterFirst = painterName.split(/\s+/)[0] || "your painter";

  const { messaging, company } = await loadMessaging(service);
  const companyName = company.name || "Paint Group";
  const organizerEmail = company.email || "email@paintgroup.com.au";
  // Settings → Automations: "Final walkthrough calendar invite". Off = no
  // invite, no event either — switching it back on sends the current state.
  if (!automationOn(messaging, "walkthrough_invite")) return;

  const address = wo.estimates.sent_snapshot?.jobAddress || wo.wo_snapshot?.jobAddress || "";
  const when = `${state.date}${state.time ? ` at ${state.time}` : ""}`;
  const vars = {
    first_name: customerFirst, customer_name: customerName || "Customer",
    painter_name: painterName || companyName, painter_first_name: painterFirst,
    walkthrough_when: when, address: address || "the property", company_name: companyName,
  };
  const summary = renderTemplate(messaging.walkthroughInviteSubject, vars);
  const sequence = priorEvents.length; // 0 on the first send, climbing after
  const now = new Date();
  const method = state.cancelled ? "CANCEL" as const : "REQUEST" as const;

  const recipients = [
    { email: customerEmail, name: customerName || "Customer", role: "customer" },
    { email: painterEmail, name: painterName || "Painter", role: "painter" },
  ].filter((r) => r.email && !isTestEmail(r.email));

  if (!emailConfigured()) {
    console.log(`[walkthrough-invite:log-driver] wo=${wo.wo_ref} ${method} date=${state.date} to=${recipients.map((r) => r.email).join(",") || "-"}`);
  } else {
    for (const r of recipients) {
      const ics = buildIcs({
        uid: `walkthrough-final-${wo.id}@paintgroup`,
        sequence,
        method,
        summary,
        description: `Final walkthrough for the painting at ${address || "your property"}. ` +
          `We walk the finished job together and sign it off.`,
        location: address || undefined,
        date: state.date,
        time: state.time,
        organizerEmail,
        organizerName: companyName,
        attendeeEmail: r.email,
        attendeeName: r.name,
        now,
      });
      const heading = state.cancelled
        ? "Final walkthrough cancelled"
        : `Final walkthrough — ${state.date}${state.time ? ` at ${state.time}` : ""}`;
      const message = state.cancelled
        ? `The final walkthrough for ${address || "the job"} has been taken out of the calendar. We'll be in touch with a new time.`
        : renderTemplate(r.role === "customer" ? messaging.walkthroughInviteCustomerBody : messaging.walkthroughInvitePainterBody, vars);
      const sent = await sendEmail({
        to: r.email,
        subject: summary,
        replyTo: company.email || undefined,
        html: buildPlainEmailHtml({
          heading,
          message,
          companyName,
          logoUrl: company.logoUrlLight || company.logoUrl,
          companyPhone: company.phone,
        }),
        attachments: [{
          filename: state.cancelled ? "walkthrough-cancelled.ics" : "final-walkthrough.ics",
          content: Buffer.from(ics, "utf8").toString("base64"),
          contentType: `text/calendar; method=${method}`,
        }],
      });
      if (sent.status === "error") {
        reportError(new Error(sent.message ?? "invite send failed"), {
          where: "walkthroughInvite.send", extra: { workOrderId, role: r.role },
        });
      }
    }
  }

  // The record — also what makes the next call idempotent and the sequence climb.
  await service.from("wo_events").insert({
    work_order_id: workOrderId,
    type: "walkthrough_invite",
    actor_kind: "system",
    meta: {
      hash: hashOf(state),
      date: state.date,
      time: state.time,
      cancelled: state.cancelled,
      sequence,
      to: recipients.map((r) => r.role),
    },
  });
}
