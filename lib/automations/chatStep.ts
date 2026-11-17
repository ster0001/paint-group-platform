/**
 * A chat step (R1, automations brief): the email that carries the message,
 * then the message itself on the estimate's own chat in the estimator's
 * name. The chat row is written only when the email went (or the server has
 * no email configured) — a STOP or a failed send leaves no message the
 * customer was never told about. SERVER ONLY. The estimate sequence (E3–E12)
 * and the won stage (W2) both send through this.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import { outcomeWord, sendAutomation } from "./dispatch";
import { buildChatEmailHtml } from "@/lib/messaging/send";
import { emailLogoUrl } from "@/lib/messaging/logo";
import { brandRecord, companyForBrand, fromForBrand, type MessageBrand } from "@/lib/messaging/brand";
import type { loadMessaging } from "@/lib/messaging/load";
import { reportError } from "@/lib/monitoring/report";

export type ChatStepInput = {
  key: string; estimateId: string; accountId: string | null; invoiceId?: string | null;
  email: string | null; brand: MessageBrand;
  company: Awaited<ReturnType<typeof loadMessaging>>["company"];
  subject: string; body: string;
  /** The estimate page the email's button opens (its chat). */
  link: string;
  now: Date;
};

export async function sendChatStep(db: SupabaseClient, i: ChatStepInput): Promise<boolean> {
  if (!i.email) return false;
  const co = companyForBrand(i.company, i.brand);
  const estimator = (i.company.estimatorName ?? "").trim().split(/\s+/)[0] || "The team";
  const o = await sendAutomation(db, {
    key: i.key, to: { email: i.email },
    email: {
      subject: i.subject,
      html: buildChatEmailHtml({ message: i.body, link: `${i.link}#chat`, companyName: co.name || brandRecord(i.brand).name, logoUrl: emailLogoUrl(co), estimatorName: i.company.estimatorName || undefined, companyPhone: co.phone || undefined }),
      from: fromForBrand(i.brand),
    },
    ctx: { estimateId: i.estimateId, accountId: i.accountId, ...(i.invoiceId ? { invoiceId: i.invoiceId } : {}) }, now: i.now,
  });
  const word = outcomeWord(o);
  if (word !== "sent" && word !== "not_configured") return false;
  const { error } = await db.from("estimate_messages").insert({ estimate_id: i.estimateId, direction: "staff", body: i.body, author_name: estimator === "The team" ? null : estimator });
  if (error) { reportError(error, { where: "automations.chatStep.row", extra: { estimateId: i.estimateId, key: i.key } }); return false; }
  return true;
}
