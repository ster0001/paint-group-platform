"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { reportError } from "@/lib/monitoring/report";
import { LANGUAGES } from "@/lib/induction/languages";

/**
 * Settings → Communications → Induction languages: switch a language on once
 * Tom's team has tested its file (⚑3). The RPC checks staff and keeps
 * English always live.
 */
export type LiveResult = { ok: true; live: boolean } | { ok: false; message: string };

export async function setLanguageLiveAction(raw: unknown): Promise<LiveResult> {
  const parsed = z.object({ code: z.enum(LANGUAGES.map((l) => l.code) as [string, ...string[]]), live: z.boolean() }).safeParse(raw);
  if (!parsed.success) return { ok: false, message: "That is not one of the languages." };
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("induction_language_set_live", { p_code: parsed.data.code, p_live: parsed.data.live });
  if (error) {
    reportError(error, { where: "induction.setLive" });
    return { ok: false, message: error.code === "42883" ? "Migration 20270267 is not applied." : "Could not save that — it has been reported." };
  }
  const r = String(data ?? "");
  if (r === "ok:live" || r === "ok:off") { revalidatePath("/settings"); return { ok: true, live: r === "ok:live" }; }
  const wording: Record<string, string> = {
    "error:not_staff": "Only staff can switch a language on.",
    "error:english_always_live": "English is always on.",
    "error:unknown_language": "That is not one of the languages.",
  };
  return { ok: false, message: wording[r] ?? r };
}
