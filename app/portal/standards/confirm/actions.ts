"use server";

import { after } from "next/server";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { createServiceClient } from "@/lib/supabase/service";
import { reportError } from "@/lib/monitoring/report";
import { SIGN_OFF_SECTIONS } from "@/lib/standards/model";
import { completeStandardsConfirmation } from "@/lib/standards/notify";

/**
 * One tick on one sign-off section (ruling S4). The RPC identifies the painter
 * from the session, writes the row for the REQUIRED version and says how many
 * sections are in; on the sixth it writes the `standards_confirmed` event and
 * this hands the PDF + email to the background (ruling S8, message 3).
 */
export type AckResult = { ok: true; confirmed: boolean; count: number } | { ok: false; message: string };

export async function ackSectionAction(raw: unknown): Promise<AckResult> {
  const parsed = z.object({ section: z.enum(SIGN_OFF_SECTIONS) }).safeParse(raw);
  if (!parsed.success) return { ok: false, message: "That section is not one of the six." };
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("standards_ack_section", { p_section: parsed.data.section });
  if (error) {
    reportError(error, { where: "standards.ack" });
    return { ok: false, message: error.code === "42883" ? "The sign-off is not switched on yet (migration 20270225)." : "Could not save that tick — it has been reported. Try again." };
  }
  const r = String(data ?? "");
  if (r === "ok:confirmed") {
    const { data: me, error: meErr } = await supabase.rpc("current_contractor_id");
    if (meErr) reportError(meErr, { where: "standards.ack.whoami", bestEffort: true });
    const contractorId = !meErr && typeof me === "string" ? me : null;
    const service = createServiceClient();
    if (contractorId && service) after(() => completeStandardsConfirmation(service, contractorId));
    return { ok: true, confirmed: true, count: 6 };
  }
  if (r.startsWith("ok:")) return { ok: true, confirmed: false, count: Number(r.slice(3)) || 0 };
  const wording: Record<string, string> = {
    "error:not_a_painter": "Only a painter can confirm the standards.",
    "error:no_version": "No standards have been published yet.",
    "error:bad_section": "That section is not one of the six.",
  };
  return { ok: false, message: wording[r] ?? "Could not save that tick. Try again." };
}
