"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { getPortalContext } from "@/lib/portal/data";
import { createServiceClient } from "@/lib/supabase/service";
import { NOTIFY_CHANNELS, NOTIFY_TYPES, type NotifyPrefs } from "@/lib/notifications/prefs";

/**
 * Save the customer's alert settings (Tom, 7 Sep 2026, item 3). Ownership is
 * the session: only accounts whose email IS the caller's are written (a trade
 * team member on someone else's account changes nothing there — same rule as
 * the profile page).
 *
 * Only OFF is stored: an unticked box writes `false`; a ticked one removes the
 * key, so a customer who has never been here is indistinguishable from one who
 * ticked everything — "unset means on" holds in the column too.
 *
 * Marketing is the account's per-channel PERMISSION, not a preference: the
 * tick moves permit_email / permit_sms through crm_set_permission with the
 * `portal` provenance the CRM shows, and keeps the older flags.marketing_opt_out
 * in step for anything still reading it.
 */
export async function saveNotificationsAction(formData: FormData): Promise<void> {
  const ctx = await getPortalContext();
  if (!ctx) redirect("/account/login");
  const svc = createServiceClient();
  if (!svc) redirect("/account/notifications?error=save");

  const prefs: NotifyPrefs = {};
  for (const t of NOTIFY_TYPES) {
    for (const c of NOTIFY_CHANNELS) {
      if (formData.get(`${t.key}_${c}`) === "on") continue;
      prefs[t.key] = { ...(prefs[t.key] ?? {}), [c]: false };
    }
  }
  const marketingOn = formData.get("marketing") === "on";

  const own = ctx.accounts.filter((a) => a.email.toLowerCase() === ctx.email.toLowerCase());
  for (const account of own) {
    const { data: row } = await svc.from("accounts").select("flags, permit_email, permit_sms").eq("id", account.id).maybeSingle();
    const flags = { ...(((row as { flags?: Record<string, unknown> } | null)?.flags ?? {}) as Record<string, unknown>), marketing_opt_out: !marketingOn };
    const { error } = await svc.from("accounts").update({ notify_prefs: prefs, flags }).eq("id", account.id);
    if (error) redirect("/account/notifications?error=save");
    const want = marketingOn ? "allowed" : "declined";
    for (const channel of ["email", "sms"] as const) {
      const current = (row as { permit_email?: string; permit_sms?: string } | null)?.[channel === "email" ? "permit_email" : "permit_sms"];
      if (current === want) continue;
      await svc.rpc("crm_set_permission", { p_account_id: account.id, p_channel: channel, p_value: want, p_how: "portal" });
    }
  }

  revalidatePath("/account/notifications");
  revalidatePath("/account/profile");
  redirect("/account/notifications?saved=1");
}
