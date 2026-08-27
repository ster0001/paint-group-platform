"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { getPortalContext } from "@/lib/portal/data";
import { postPortalMessage } from "@/lib/portal/messages";

/** Post into the caller's own estimate thread — ownership re-proven from the
 * session on every post; the estimate id is never trusted from the form. */
export async function sendPortalMessageAction(formData: FormData): Promise<void> {
  const estimateId = String(formData.get("estimateId") ?? "");
  const body = String(formData.get("body") ?? "");
  if (!/^[0-9a-f-]{36}$/.test(estimateId)) redirect("/account/messages");

  const ctx = await getPortalContext();
  if (!ctx) redirect("/account/login");

  const result = await postPortalMessage(ctx.accounts.map((a) => a.id), estimateId, body);
  if (result === "not_found") redirect("/account/messages");

  revalidatePath(`/account/messages/${estimateId}`);
  redirect(`/account/messages/${estimateId}${result === "ok" ? "" : "?error=send"}`);
}
