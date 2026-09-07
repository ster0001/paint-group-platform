"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { buildEvent, type CrmEventType } from "@/lib/crm/events";
import { refreshAccountFacts } from "@/lib/crm/facts";
import { melbourneInstant } from "@/lib/time/businessHours";
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
