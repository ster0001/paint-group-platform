/**
 * The dispatcher (Session 1) — SERVER ONLY, service client.
 *
 * Every AUTOMATIC message goes through `sendAutomation`. It loads the
 * office's settings, asks `decide()` what to do, and then either sends on the
 * planned channels through lib/messaging/send (the one send path — every
 * send is still recorded in `messages`), or writes an `automation_holds` row:
 * `pending` when the office wants to approve first, `held` with a release
 * time when quiet hours or the daily cap apply.
 *
 * `releaseDueHolds` is called by the sweeps; `sendHold` is what Approve on
 * the queue and a release both use. Before a held or pending message goes,
 * three things are re-checked: the switch is still on, the customer has not
 * turned the kind off (the send layer does that), and `stillNeeded` — a per-
 * automation question ("is the invoice still unpaid?") that Sessions 3–7 fill
 * in (stillNeeded.ts). A message that is no longer needed is marked skipped
 * with the reason, never sent.
 *
 * Best-effort, like the sites it replaces: a failure here is reported and
 * never unwinds the event it announces.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import { automationByKey } from "./registry";
import { decide, type Decision } from "./decide";
import { melbourneDayStart, type SendChannel } from "./controls";
import { loadMessaging } from "@/lib/messaging/load";
import { automationOn } from "@/lib/messaging/config";
import { sendEmail, sendSms, type DeliveryResult } from "@/lib/messaging/send";
import type { MessageContext } from "@/lib/messaging/record";
import { reportError } from "@/lib/monitoring/report";
import { createServiceClient } from "@/lib/supabase/service";
import { stillNeeded } from "./stillNeeded";

export type AutomationSend = {
  key: string;
  to: { email?: string | null; phone?: string | null };
  email?: { subject: string; html: string; replyTo?: string; attachments?: { filename: string; content: string; contentType?: string }[] };
  sms?: { body: string };
  /** Who this is about. `kind` is stamped from the registry when absent. */
  ctx?: MessageContext;
  /** For a painter message: lets the queue show who it goes to. */
  contractorId?: string | null;
  now?: Date;
};

/** The wo_events-style outcome word for a dispatch, so existing guards keep working. */
export function outcomeWord(o: DispatchOutcome): string {
  if (o.outcome === "sent") {
    const rs = Object.values(o.results);
    if (rs.some((r) => r && r.status === "sent")) return "sent";
    if (rs.some((r) => r && r.status === "not_configured")) return "not_configured";
    if (rs.some((r) => r && r.status === "suppressed")) return "suppressed";
    return "failed";
  }
  return o.outcome;
}
/** Sent, or safely on its way (queued / held) — the guard should stand. */
export function dispatched(o: DispatchOutcome): boolean {
  return outcomeWord(o) === "sent" || o.outcome === "pending" || o.outcome === "held";
}

export type DispatchOutcome =
  | { outcome: "sent"; channels: SendChannel[]; results: Partial<Record<SendChannel, DeliveryResult>>; fallback?: string }
  | { outcome: "off" }
  | { outcome: "nobody"; detail: string }
  | { outcome: "pending"; holdId: string }
  | { outcome: "held"; holdId: string; releaseAt: string; reason: "quiet" | "cap" }
  | { outcome: "error"; message: string };

export type HoldRow = {
  id: string; automation_key: string; audience: string;
  account_id: string | null; contractor_id: string | null; estimate_id: string | null; work_order_id: string | null; invoice_id: string | null;
  to_email: string | null; to_phone: string | null; channels: string[];
  subject: string | null; body_html: string | null; sms_body: string | null;
  attachments: { filename: string; content: string; contentType?: string }[] | null;
  ctx: MessageContext; reason: "approve" | "quiet" | "cap"; reason_detail: string | null;
  release_at: string | null; status: "pending" | "held" | "sent" | "skipped" | "failed";
  decided_by: string | null; decided_at: string | null; result: unknown; created_at: string;
};

/** Cap-counted automatic sends to this customer today (Melbourne day). */
async function sentTodayFor(db: SupabaseClient, accountId: string | null | undefined, now: Date): Promise<number | null> {
  if (!accountId) return null;
  try {
    const { data } = await db.from("messages")
      .select("meta")
      .eq("account_id", accountId).eq("direction", "out").eq("status", "sent")
      .gte("occurred_at", melbourneDayStart(now).toISOString())
      .not("meta->>automation", "is", null)
      .limit(500);
    let n = 0;
    for (const row of (data ?? []) as { meta: { automation?: string } | null }[]) {
      const a = row.meta?.automation ? automationByKey(row.meta.automation) : undefined;
      if (a && a.audience === "customer" && !a.capExempt) n += 1;
    }
    return n;
  } catch {
    return null;   // unknown → the cap is not applied; a lookup hiccup must never lose a message
  }
}

async function deliver(
  channels: SendChannel[], send: AutomationSend, ctx: MessageContext, fallback?: string,
): Promise<Partial<Record<SendChannel, DeliveryResult>>> {
  const results: Partial<Record<SendChannel, DeliveryResult>> = {};
  const full: MessageContext = { ...ctx, automation: send.key, fallback: fallback ?? null };
  for (const ch of channels) {
    if (ch === "sms" && send.sms && send.to.phone) {
      results.sms = await sendSms({ to: send.to.phone, body: send.sms.body, ctx: full });
    } else if (ch === "email" && send.email && send.to.email) {
      results.email = await sendEmail({ to: send.to.email, subject: send.email.subject, html: send.email.html, replyTo: send.email.replyTo, attachments: send.email.attachments, ctx: full });
    }
  }
  return results;
}

/** The one door for an automatic message. */
export async function sendAutomation(db: SupabaseClient, send: AutomationSend): Promise<DispatchOutcome> {
  const a = automationByKey(send.key);
  if (!a) return { outcome: "error", message: `Unknown automation ${send.key}` };
  const now = send.now ?? new Date();
  try {
    const { messaging } = await loadMessaging(db);
    const ctx: MessageContext = { ...(send.ctx ?? {}), kind: send.ctx?.kind ?? a.sendKind };
    // Only what the automation can actually send counts as a contact detail.
    const contact = { email: send.email ? send.to.email : null, phone: send.sms ? send.to.phone : null };
    // Hold rows and the cap count are written/read with the service client: a
    // send site running under a staff session (the chat reply) cannot insert.
    const svc = createServiceClient() ?? db;
    const needsCap = a.audience === "customer" && !a.capExempt && modeIsAuto(messaging, send.key, a.approvable, a.defaultMode);
    const sentToday = needsCap ? await sentTodayFor(svc, ctx.accountId, now) : null;
    const d: Decision = decide({ automation: a, cfg: messaging, contact, now, sentToday });

    if (d.action === "off") return { outcome: "off" };
    if (d.action === "nobody") return { outcome: "nobody", detail: d.detail };
    if (d.action === "send") {
      const results = await deliver(d.channels, send, ctx, d.fallback);
      return { outcome: "sent", channels: d.channels, results, fallback: d.fallback };
    }
    // pending or hold → one row with both renditions.
    const row = {
      automation_key: a.key, audience: a.audience,
      account_id: ctx.accountId ?? null, contractor_id: send.contractorId ?? null,
      estimate_id: ctx.estimateId ?? null, work_order_id: ctx.workOrderId ?? null, invoice_id: ctx.invoiceId ?? null,
      to_email: send.to.email ?? null, to_phone: send.to.phone ?? null, channels: d.channels,
      subject: send.email?.subject ?? null, body_html: send.email?.html ?? null, sms_body: send.sms?.body ?? null,
      attachments: send.email?.attachments ?? null,
      ctx: { ...ctx, fallback: d.fallback ?? null },
      reason: d.action === "pending" ? "approve" : d.reason,
      reason_detail: d.action === "pending" ? "Office approves first." : d.detail,
      release_at: d.action === "hold" ? d.releaseAt.toISOString() : null,
      status: d.action === "pending" ? "pending" : "held",
    };
    const { data, error } = await svc.from("automation_holds").insert(row).select("id").single();
    if (error) throw error;
    const holdId = (data as { id: string }).id;
    return d.action === "pending" ? { outcome: "pending", holdId } : { outcome: "held", holdId, releaseAt: d.releaseAt.toISOString(), reason: d.reason };
  } catch (e) {
    reportError(e, { where: "automations.dispatch", extra: { key: send.key } });
    return { outcome: "error", message: e instanceof Error ? e.message : "dispatch failed" };
  }
}

function modeIsAuto(cfg: { controls?: Record<string, { mode?: string }> }, key: string, approvable?: boolean, def?: string): boolean {
  if (!approvable) return true;
  const m = cfg.controls?.[key]?.mode ?? def ?? "auto";
  return m !== "approve";
}

export type HoldEdits = { subject?: string; bodyHtml?: string; smsBody?: string };

/**
 * Send a pending or held row now — Approve on the queue, or a due release.
 * Re-checks the switch and `stillNeeded`; a skipped row says why.
 */
export async function sendHold(
  db: SupabaseClient, hold: HoldRow, opts: { decidedBy?: string | null; edits?: HoldEdits; force?: boolean } = {},
): Promise<"sent" | "skipped" | "failed"> {
  const a = automationByKey(hold.automation_key);
  const now = new Date().toISOString();
  const finish = async (status: "sent" | "skipped" | "failed", result: unknown) => {
    await db.from("automation_holds").update({ status, result, decided_by: opts.decidedBy ?? hold.decided_by ?? null, decided_at: now }).eq("id", hold.id);
    return status;
  };
  try {
    const { messaging } = await loadMessaging(db);
    if (!a || !automationOn(messaging, hold.automation_key)) return finish("skipped", { reason: "Automation switched off." });
    if (!opts.force) {
      const need = await stillNeeded(db, hold);
      if (!need.ok) return finish("skipped", { reason: need.reason });
    }
    const send: AutomationSend = {
      key: hold.automation_key,
      to: { email: hold.to_email, phone: hold.to_phone },
      email: hold.body_html != null ? { subject: opts.edits?.subject ?? hold.subject ?? "", html: opts.edits?.bodyHtml ?? hold.body_html, attachments: hold.attachments ?? undefined } : undefined,
      sms: hold.sms_body != null ? { body: opts.edits?.smsBody ?? hold.sms_body } : undefined,
      ctx: hold.ctx,
    };
    const fallback = (hold.ctx as { fallback?: string | null } | null)?.fallback ?? undefined;
    const results = await deliver(hold.channels as SendChannel[], send, { ...hold.ctx, actorProfileId: opts.decidedBy ?? hold.ctx?.actorProfileId ?? null }, fallback);
    const anyFailed = Object.values(results).some((r) => r && r.status === "error");
    const anySent = Object.values(results).some((r) => r && r.status === "sent");
    return finish(anySent || !anyFailed ? "sent" : "failed", results);
  } catch (e) {
    reportError(e, { where: "automations.sendHold", extra: { holdId: hold.id } });
    return finish("failed", { error: e instanceof Error ? e.message : "send failed" });
  }
}

/** Held rows whose release time has passed. Called by the sweeps. */
export async function releaseDueHolds(db: SupabaseClient, now = new Date()): Promise<{ released: number; skipped: number; failed: number }> {
  const out = { released: 0, skipped: 0, failed: 0 };
  const { data, error } = await db.from("automation_holds").select("*")
    .eq("status", "held").lte("release_at", now.toISOString())
    .order("release_at", { ascending: true }).limit(200);
  if (error) { reportError(error, { where: "automations.releaseDueHolds" }); return out; }
  for (const hold of (data ?? []) as HoldRow[]) {
    const r = await sendHold(db, hold);
    if (r === "sent") out.released += 1; else if (r === "skipped") out.skipped += 1; else out.failed += 1;
  }
  return out;
}
