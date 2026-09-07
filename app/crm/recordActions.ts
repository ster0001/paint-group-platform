"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { buildEvent, type CrmEventType } from "@/lib/crm/events";
import { refreshAccountFacts } from "@/lib/crm/facts";
import { melbourneInstant } from "@/lib/time/businessHours";
import { recordMessage } from "@/lib/messaging/record";
import { buildPlainEmailHtml, sendEmail, sendSms } from "@/lib/messaging/send";
import { loadMessaging } from "@/lib/messaging/load";
import { normalisePhoneAU } from "@/lib/messaging/config";
import type { CrmResult } from "./actions";
import { CONTACT_ROLES, LOG_KINDS, type LogKind } from "./recordTypes";

/**
 * CRM v2 P2 — the customer record's writes (deep dive §4.1). Every one is an
 * RPC from migration 20270123 or 20261207; the browser never touches a table,
 * and every write leaves an event on the timeline. The cached card is
 * recomputed before the page re-renders.
 */

const uuid = z.string().uuid();
const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

async function refreshFor(db: Awaited<ReturnType<typeof createClient>>, ...ids: Array<string | null | undefined>) {
  const real = ids.filter((x): x is string => Boolean(x));
  if (real.length) await refreshAccountFacts(db, real).catch(() => null);
}

/** A calendar day (YYYY-MM-DD) in Melbourne at a given hour, as an instant — DST-safe via lib/time. */
async function atMelbourne(day: string, hour = 9): Promise<string> {
  const [y, m, d] = day.split("-").map(Number);
  return melbourneInstant(y, m, d, hour).toISOString();
}

// ---- the log sheet ---------------------------------------------------------


const WORDING: Record<LogKind, string> = {
  call_no_answer: "Logged — called, no answer.",
  voicemail: "Logged — left a voicemail.",
  call_connected: "Logged — spoke to them.",
  email_logged: "Logged — emailed them.",
  sms_logged: "Logged — texted them.",
  note_added: "Note saved.",
};

export type LogInput = {
  kind: LogKind;
  note: string;
  direction?: "out" | "in";
  /** YYYY-MM-DD, Melbourne; null = leave the reminder as it is. */
  followupDay?: string | null;
};

export async function logContact(accountId: string, input: LogInput): Promise<CrmResult> {
  if (!uuid.safeParse(accountId).success) return { ok: false, message: "That isn't a customer id." };
  if (!LOG_KINDS.includes(input.kind)) return { ok: false, message: "That isn't something we log." };
  const note = input.note.trim();
  if (input.kind === "note_added" && !note) return { ok: false, message: "A note needs some words." };

  const type: CrmEventType = input.kind === "voicemail" ? "call_no_answer" : input.kind;
  const payload =
    input.kind === "note_added" ? { body: note }
    : input.kind === "voicemail" ? { voicemail: true, ...(note ? { note } : {}) }
    : input.kind === "email_logged" || input.kind === "sms_logged" ? { direction: input.direction ?? "out", ...(note ? { note } : {}) }
    : note ? { note } : {};

  let args: ReturnType<typeof buildEvent>;
  try {
    args = buildEvent({ type, accountId, source: "staff", payload });
  } catch (e) {
    return { ok: false, message: e instanceof Error ? e.message : "That didn't look right." };
  }

  const supabase = await createClient();
  const { error } = await supabase.rpc("crm_log_event", args);
  if (error) return { ok: false, message: error.message };

  // P3: a call, an email or a text the office made by hand is a message row
  // too — the one table every conversation lives in.
  if (input.kind !== "note_added") {
    const { data: { user } } = await supabase.auth.getUser();
    await recordMessage({
      channel: input.kind === "email_logged" ? "email" : input.kind === "sms_logged" ? "sms" : "call",
      direction: input.direction ?? "out",
      body: note || (input.kind === "voicemail" ? "Left a voicemail" : input.kind === "call_no_answer" ? "No answer" : input.kind === "call_connected" ? "Spoke" : ""),
      provider: "manual", status: input.direction === "in" ? "received" : "sent",
      accountId, actorProfileId: user?.id ?? null, kind: input.kind,
    }, supabase);
  }

  let extra = "";
  if (input.followupDay && isoDate.safeParse(input.followupDay).success) {
    const dueAt = await atMelbourne(input.followupDay, 9);
    const { error: e2 } = await supabase.rpc("crm_set_followup", { p_account_id: accountId, p_due_at: dueAt, p_note: note || null });
    if (e2) return { ok: false, message: `Logged, but the reminder failed: ${e2.message}` };
    extra = ` Follow-up ${new Intl.DateTimeFormat("en-AU", { timeZone: "Australia/Melbourne", day: "numeric", month: "short" }).format(new Date(dueAt))}.`;
  }

  await refreshFor(supabase, accountId);
  revalidatePath("/crm", "layout");
  return { ok: true, message: WORDING[input.kind] + extra };
}

// ---- reminders and snoozes, by date ------------------------------------------

export async function setFollowupOn(accountId: string, day: string | null, note: string): Promise<CrmResult> {
  if (!uuid.safeParse(accountId).success) return { ok: false, message: "That isn't a customer id." };
  if (day != null && !isoDate.safeParse(day).success) return { ok: false, message: "Pick a date." };
  const supabase = await createClient();
  const dueAt = day ? await atMelbourne(day, 9) : null;
  const { error } = await supabase.rpc("crm_set_followup", { p_account_id: accountId, p_due_at: dueAt, p_note: note.trim() || null });
  if (error) return { ok: false, message: error.message };
  await refreshFor(supabase, accountId);
  revalidatePath("/crm", "layout");
  return { ok: true, message: dueAt ? "Reminder set." : "Reminder cleared." };
}

export async function snoozeOn(accountId: string, day: string | null, reason: string): Promise<CrmResult> {
  if (!uuid.safeParse(accountId).success) return { ok: false, message: "That isn't a customer id." };
  if (day != null && !isoDate.safeParse(day).success) return { ok: false, message: "Pick a date." };
  const supabase = await createClient();
  const until = day ? await atMelbourne(day, 9) : null;
  if (until && new Date(until) <= new Date()) return { ok: false, message: "A snooze has to end in the future." };
  const { error } = await supabase.rpc("crm_snooze", { p_account_id: accountId, p_until: until, p_reason: reason.trim() || null });
  if (error) return { ok: false, message: error.message };
  await refreshFor(supabase, accountId);
  revalidatePath("/crm", "layout");
  return { ok: true, message: until ? "Snoozed." : "Snooze cleared." };
}

// ---- details, owner, contacts ------------------------------------------------

export type DetailsResult = CrmResult & { otherAccountId?: string };

export async function updateDetails(accountId: string, details: { name: string; email: string; phone: string }): Promise<DetailsResult> {
  if (!uuid.safeParse(accountId).success) return { ok: false, message: "That isn't a customer id." };
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("crm_update_account", {
    p_account_id: accountId, p_name: details.name, p_email: details.email, p_phone: details.phone,
  });
  if (error) return { ok: false, message: error.message };
  const r = data as { ok: boolean; reason?: string; otherAccountId?: string; changed?: string[] };
  if (!r.ok) {
    if (r.reason === "email_taken") return { ok: false, message: "That email belongs to another customer.", otherAccountId: r.otherAccountId };
    if (r.reason === "unreachable") return { ok: false, message: "A customer needs an email or a phone number we can dial." };
    return { ok: false, message: "That didn't save." };
  }
  await refreshFor(supabase, accountId);
  revalidatePath("/crm", "layout");
  return { ok: true, message: r.changed?.length ? "Details saved." : "Nothing changed." };
}

export async function setOwner(accountId: string, ownerId: string | null): Promise<CrmResult> {
  if (!uuid.safeParse(accountId).success) return { ok: false, message: "That isn't a customer id." };
  if (ownerId != null && !uuid.safeParse(ownerId).success) return { ok: false, message: "That isn't a staff member." };
  const supabase = await createClient();
  const { error } = await supabase.rpc("crm_set_owner", { p_account_id: accountId, p_owner_id: ownerId });
  if (error) return { ok: false, message: error.message };
  await refreshFor(supabase, accountId);
  revalidatePath("/crm", "layout");
  return { ok: true, message: ownerId ? "Owner set." : "Owner cleared." };
}


export type ContactInput = {
  id?: string | null;
  name: string;
  role: string;
  email: string;
  phone: string;
  preferred: "" | "email" | "sms" | "phone";
  notes: string;
};

export async function saveContact(accountId: string, c: ContactInput): Promise<CrmResult & { id?: string }> {
  if (!uuid.safeParse(accountId).success) return { ok: false, message: "That isn't a customer id." };
  if (!c.name.trim() && !c.email.trim() && !c.phone.trim()) return { ok: false, message: "A contact needs a name, an email or a phone." };
  if (!CONTACT_ROLES.includes(c.role as (typeof CONTACT_ROLES)[number])) return { ok: false, message: "Pick a role." };
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("crm_upsert_contact", {
    p_account_id: accountId, p_contact_id: c.id ?? null, p_name: c.name, p_role: c.role,
    p_email: c.email, p_phone: c.phone, p_preferred: c.preferred || null, p_notes: c.notes,
  });
  if (error) return { ok: false, message: error.message };
  await refreshFor(supabase, accountId);
  revalidatePath("/crm", "layout");
  return { ok: true, message: c.id ? "Contact saved." : "Contact added.", id: data as string };
}

export async function removeContact(accountId: string, contactId: string): Promise<CrmResult> {
  if (!uuid.safeParse(contactId).success) return { ok: false, message: "That isn't a contact." };
  const supabase = await createClient();
  const { error } = await supabase.rpc("crm_delete_contact", { p_contact_id: contactId });
  if (error) return { ok: false, message: error.message };
  await refreshFor(supabase, accountId);
  revalidatePath("/crm", "layout");
  return { ok: true, message: "Contact removed." };
}

// ---- quick add and merge -----------------------------------------------------

export type CreateResult = { ok: true; id: string; existed: boolean } | { ok: false; message: string };

export async function createCustomer(input: { name: string; email: string; phone: string }): Promise<CreateResult> {
  if (!input.name.trim() && !input.email.trim() && !input.phone.trim()) return { ok: false, message: "A name and a phone or email, at least." };
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("crm_create_account", { p_name: input.name, p_email: input.email, p_phone: input.phone });
  if (error) return { ok: false, message: error.message };
  const r = data as { ok: boolean; id?: string; existed?: boolean; reason?: string };
  if (!r.ok || !r.id) {
    return { ok: false, message: r.reason === "unreachable" ? "That phone number doesn't look right — try 04xx xxx xxx, or add an email." : "That didn't save." };
  }
  await refreshFor(supabase, r.id);
  revalidatePath("/crm", "layout");
  return { ok: true, id: r.id, existed: r.existed === true };
}

export async function mergeAccounts(keepId: string, dropId: string): Promise<CrmResult> {
  if (!uuid.safeParse(keepId).success || !uuid.safeParse(dropId).success) return { ok: false, message: "That isn't a customer id." };
  const supabase = await createClient();
  const { error } = await supabase.rpc("crm_merge_accounts", { p_keep: keepId, p_drop: dropId });
  if (error) return { ok: false, message: error.message };
  await refreshFor(supabase, keepId);
  revalidatePath("/crm", "layout");
  return { ok: true, message: "Merged into this record." };
}

// ---- P3: the Messages section ------------------------------------------------

export type ReplyInput = { channel: "email" | "sms"; subject: string; body: string };

/** A reply from the record: sent through the same primitives as everything
 *  else, so it is recorded, routed and delivery-tracked like everything else. */
export async function sendReply(accountId: string, input: ReplyInput): Promise<CrmResult> {
  if (!uuid.safeParse(accountId).success) return { ok: false, message: "That isn't a customer id." };
  const body = input.body.trim();
  if (!body) return { ok: false, message: "Write something first." };
  const supabase = await createClient();
  const { data: account } = await supabase.from("accounts").select("id, name, email, phone").eq("id", accountId).maybeSingle();
  const a = account as { id: string; name: string | null; email: string | null; phone: string | null } | null;
  if (!a) return { ok: false, message: "That customer isn't here any more." };
  const { data: { user } } = await supabase.auth.getUser();
  const ctx = { accountId, actorProfileId: user?.id ?? null, kind: "reply" };

  if (input.channel === "sms") {
    const to = normalisePhoneAU(a.phone ?? "");
    if (!to) return { ok: false, message: "No mobile number we can text on this record." };
    const r = await sendSms({ to, body, ctx });
    revalidatePath("/crm", "layout");
    if (r.status === "sent") return { ok: true, message: "Text sent." };
    if (r.status === "not_configured") return { ok: false, message: "Texting isn't configured on this server — recorded as not sent." };
    return { ok: false, message: r.message };
  }

  if (!a.email) return { ok: false, message: "No email address on this record." };
  const { company } = await loadMessaging(supabase);
  const subject = input.subject.trim() || `A note from ${company.name || "Paint Group"}`;
  const html = buildPlainEmailHtml({ heading: subject, message: body, companyName: company.name || "Paint Group", logoUrl: company.logoUrl, companyPhone: company.phone });
  const r = await sendEmail({ to: a.email, subject, html, replyTo: company.email, ctx });
  revalidatePath("/crm", "layout");
  if (r.status === "sent") return { ok: true, message: "Email sent." };
  if (r.status === "not_configured") return { ok: false, message: "Email isn't configured on this server — recorded as not sent." };
  return { ok: false, message: r.message };
}

export async function markMessagesRead(accountId: string): Promise<void> {
  if (!uuid.safeParse(accountId).success) return;
  const supabase = await createClient();
  await supabase.rpc("crm_mark_messages_read", { p_account_id: accountId });
}

/** An unmatched inbound message belongs to this customer. */
export async function attachMessage(messageId: string, accountId: string): Promise<CrmResult> {
  if (!uuid.safeParse(messageId).success || !uuid.safeParse(accountId).success) return { ok: false, message: "That isn't a customer id." };
  const supabase = await createClient();
  const { error } = await supabase.rpc("crm_attach_message", { p_message_id: messageId, p_account_id: accountId });
  if (error) return { ok: false, message: error.message };
  await refreshFor(supabase, accountId);
  revalidatePath("/crm", "layout");
  return { ok: true, message: "Attached." };
}
