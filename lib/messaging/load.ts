/**
 * The one way server code reads the messaging settings — merged over the
 * shipped defaults so a field that was added after the row was last saved
 * still has its default, and the company profile alongside it because every
 * template wants {{company_name}}.
 *
 * SERVER ONLY (takes any Supabase client — the caller decides service vs
 * session). Tolerant: a failed read returns the defaults, never throws — a
 * message must not be lost because the settings table hiccuped.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import { DEFAULT_MESSAGING, MESSAGING_KEY, type MessagingSettings } from "./config";

export type CompanyForMessages = {
  name?: string; email?: string; phone?: string; logoUrl?: string; logoUrlLight?: string; estimatorName?: string;
};

export async function loadMessaging(db: SupabaseClient): Promise<{ messaging: MessagingSettings; company: CompanyForMessages }> {
  const { data } = await db.from("settings").select("key, value").in("key", [MESSAGING_KEY, "company_profile"]);
  const rows = (data ?? []) as { key: string; value: unknown }[];
  const saved = (rows.find((r) => r.key === MESSAGING_KEY)?.value as Partial<MessagingSettings> | undefined) ?? {};
  const company = (rows.find((r) => r.key === "company_profile")?.value as CompanyForMessages | undefined) ?? {};
  return { messaging: { ...DEFAULT_MESSAGING, ...saved }, company };
}
