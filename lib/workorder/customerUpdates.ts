/**
 * The Customer updates queue's two settings (work order UX Step 2) — SERVER.
 *
 *  · WHO the customer reads it from: Settings → Automations → Customer updates →
 *    "Sender first name", else the coordinator on the Company profile, else the
 *    company itself. The timeline shows "Felipe, Paint Group" (ruling R8: in the
 *    sender line only, never at the top of the message).
 *  · WHETHER drafts go on their own: the registry's approve/auto MODE for
 *    `customer_updates_queue` (Step 0 ruling M2 — one switch, the one every
 *    other automation has, not a second `auto_send` setting). Default: office
 *    approves first (R7).
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import { loadMessaging } from "@/lib/messaging/load";
import { MESSAGING_KEY, type MessagingSettings } from "@/lib/messaging/config";
import { CUSTOMER_UPDATES_KEY } from "./draftFromTicks";

export type CustomerUpdatesSettings = {
  /** "Felipe" — the first name the customer reads. */
  senderFirstName: string;
  /** "Felipe, Paint Group" — the whole sender line. */
  senderLine: string;
  companyName: string;
  autoSend: boolean;
  bundleMinutes: number;
};

export function autoSendOn(messaging: Pick<MessagingSettings, "controls" | "disabled">): boolean {
  if ((messaging.disabled ?? []).includes(CUSTOMER_UPDATES_KEY)) return false;
  return messaging.controls?.[CUSTOMER_UPDATES_KEY]?.mode === "auto";
}

export function senderFirstNameOf(messaging: Pick<MessagingSettings, "customerUpdatesSender">, company: { coordinatorName?: string; name?: string }): string {
  const typed = (messaging.customerUpdatesSender ?? "").trim();
  const person = typed || (company.coordinatorName ?? "").trim();
  if (person) return person.split(/\s+/)[0] ?? person;
  // No person to name: the company itself, whole — never its first word.
  return (company.name ?? "").trim() || "Paint Group";
}

export async function loadCustomerUpdatesSettings(db: SupabaseClient): Promise<CustomerUpdatesSettings> {
  const { messaging, company } = await loadMessaging(db);
  const companyName = (company.name ?? "").trim() || "Paint Group";
  const senderFirstName = senderFirstNameOf(messaging, company as { coordinatorName?: string; name?: string });
  const timing = messaging.controls?.[CUSTOMER_UPDATES_KEY]?.timing?.bundle_minutes;
  return {
    senderFirstName,
    senderLine: senderFirstName === companyName ? companyName : `${senderFirstName}, ${companyName}`,
    companyName,
    autoSend: autoSendOn(messaging),
    bundleMinutes: typeof timing === "number" && timing >= 0 ? timing : 5,
  };
}

/** Flip the one switch: the registry mode for the queue. Merges into the saved messaging row. */
export async function setAutoSend(db: SupabaseClient, on: boolean): Promise<{ error: string | null }> {
  const { data, error } = await db.from("settings").select("value").eq("key", MESSAGING_KEY).maybeSingle();
  if (error) return { error: error.message };
  const saved = ((data?.value as Partial<MessagingSettings> | null) ?? {});
  const controls = { ...(saved.controls ?? {}) };
  controls[CUSTOMER_UPDATES_KEY] = { ...(controls[CUSTOMER_UPDATES_KEY] ?? {}), mode: on ? "auto" : "approve" };
  const { error: upErr } = await db.from("settings").upsert({ key: MESSAGING_KEY, value: { ...saved, controls } }, { onConflict: "key" });
  return { error: upErr?.message ?? null };
}

/** The kinds that reach the customer on the timeline only — never emailed or texted (R10; Step 3 default for the defect-day note). */
export const TIMELINE_ONLY_KINDS: ReadonlySet<string> = new Set(["checkin_40", "defect_day"]);
export function isTimelineOnlyKind(kind: string | null | undefined): boolean {
  return !!kind && TIMELINE_ONLY_KINDS.has(kind);
}
