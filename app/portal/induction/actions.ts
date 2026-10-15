"use server";

import { after } from "next/server";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { createServiceClient } from "@/lib/supabase/service";
import { reportError } from "@/lib/monitoring/report";
import { LANGUAGES } from "@/lib/induction/languages";
import { SIGN_OFF_SECTIONS } from "@/lib/standards/model";
import { completeInduction } from "@/lib/induction/notify";
import { completeStandardsConfirmation } from "@/lib/standards/notify";

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

/**
 * One tick on one module (Step 5; ruling I1: one tick per module). The RPC
 * identifies the login, writes the row for the REQUIRED version and says how
 * far along they are; on the last it writes the `induction_completed` event
 * and this hands the PDF + message to the background. Module 5 takes the
 * standards section: a contractor's tick goes through standards_ack_section
 * (one writer), so the sixth section also fires the standards PDF.
 */
export type AckResult = { ok: true; complete: boolean; ticked: number; total: number } | { ok: false; message: string };

export async function ackModuleAction(raw: unknown): Promise<AckResult> {
  const parsed = z.object({ module: z.string().regex(/^m\d{2}$/), section: z.enum(SIGN_OFF_SECTIONS).optional() }).safeParse(raw);
  if (!parsed.success) return { ok: false, message: "That is not one of the modules." };
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("induction_ack_module", { p_module_key: parsed.data.module, p_section_key: parsed.data.section ?? "" });
  if (error) {
    reportError(error, { where: "induction.ack" });
    return { ok: false, message: error.code === "42883" ? "The induction ticks are not switched on yet (migration 20270270)." : "Could not save that tick — it has been reported. Try again." };
  }
  const r = String(data ?? "");
  if (r === "ok:complete" || r === "ok:confirmed" || /^ok:\d+\/\d+$/.test(r) || /^ok:\d+$/.test(r)) {
    const { data: { user } } = await supabase.auth.getUser();
    const service = createServiceClient();
    if (r === "ok:complete" && user && service) after(() => completeInduction(service, user.id));
    if (parsed.data.module === "m05" && parsed.data.section === "defect" && user && service) {
      // The sixth standards section on a contractor: the standards PDF (ruling S8), as the standards screen does.
      const { data: me, error: meErr } = await supabase.rpc("current_contractor_id");
      if (meErr) reportError(meErr, { where: "induction.ack.whoami", bestEffort: true });
      if (!meErr && typeof me === "string") after(() => completeStandardsConfirmation(service, me));
    }
    const m = /^ok:(\d+)\/(\d+)$/.exec(r);
    return { ok: true, complete: r === "ok:complete", ticked: m ? Number(m[1]) : 0, total: m ? Number(m[2]) : 0 };
  }
  const wording: Record<string, string> = {
    "error:not_a_painter": "Only a painter can tick the induction.",
    "error:no_version": "The induction has not been published yet.",
    "error:bad_module": "That module is not in your induction.",
    "error:section_required": "Pick a standards section to tick.",
    "error:bad_section": "That section is not one of the six.",
  };
  return { ok: false, message: wording[r] ?? "Could not save that tick. Try again." };
}
