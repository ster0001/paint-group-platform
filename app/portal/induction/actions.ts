"use server";

import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { reportError } from "@/lib/monitoring/report";
import { LANGUAGES } from "@/lib/induction/languages";

/**
 * The painter picks the language they read and tick in (ruling I8). The RPC
 * identifies the painter from the session — a contractor writes their own
 * row, a worker login its contractor_users row — and refuses a language staff
 * have not switched on (⚑3). English always goes through.
 */
export type SetLanguageResult = { ok: true; code: string } | { ok: false; message: string };

export async function setLanguageAction(raw: unknown): Promise<SetLanguageResult> {
  const parsed = z.object({ code: z.enum(LANGUAGES.map((l) => l.code) as [string, ...string[]]) }).safeParse(raw);
  if (!parsed.success) return { ok: false, message: "That is not one of the languages we offer." };
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("induction_set_language", { p_code: parsed.data.code });
  if (error) {
    reportError(error, { where: "induction.setLanguage" });
    return { ok: false, message: error.code === "42883" ? "Languages are not switched on yet (migration 20270267)." : "Could not save your language — it has been reported. Try again." };
  }
  const r = String(data ?? "");
  if (r.startsWith("ok:")) return { ok: true, code: r.slice(3) };
  const wording: Record<string, string> = {
    "error:not_live": "That language is not ready yet. Pick another for now — you can change it later.",
    "error:unknown_language": "That is not one of the languages we offer.",
    "error:not_a_painter": "Only a painter can choose a language.",
  };
  return { ok: false, message: wording[r] ?? "Could not save your language. Try again." };
}
