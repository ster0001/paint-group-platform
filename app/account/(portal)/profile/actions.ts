"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { getPortalContext } from "@/lib/portal/data";
import { createServiceClient } from "@/lib/supabase/service";

const detailsSchema = z.object({
  name: z.string().trim().max(120),
  phone: z.string().trim().max(40),
});

/**
 * Save the customer's own details. Ownership is the session: only accounts
 * whose email IS the caller's email are written (a trade member of someone
 * else's account edits nothing there). Marketing preference lives in
 * accounts.flags.marketing_opt_out — an OPT OUT flag, so the default (unset)
 * keeps existing accounts opted in, exactly as they are today.
 */
export async function saveProfileAction(formData: FormData): Promise<void> {
  const ctx = await getPortalContext();
  if (!ctx) redirect("/account/login");

  const parsed = detailsSchema.safeParse({
    name: String(formData.get("name") ?? ""),
    phone: String(formData.get("phone") ?? ""),
  });
  if (!parsed.success) redirect("/account/profile?error=invalid");
  const { name, phone } = parsed.data;

  const svc = createServiceClient();
  if (!svc) redirect("/account/profile?error=save");

  const own = ctx.accounts.filter((a) => a.email.toLowerCase() === ctx.email.toLowerCase());
  for (const account of own) {
    // The marketing tick moved to /account/notifications (7 Sep) — flags are untouched here.
    const { error } = await svc.from("accounts")
      .update({ name: name || null, phone: phone || null })
      .eq("id", account.id);
    if (error) redirect("/account/profile?error=save");
  }

  // The greeting reads profiles.name as its fallback — keep it in step.
  if (name) {
    await svc.from("profiles").update({ name }).eq("id", ctx.userId);
  }

  revalidatePath("/account/profile");
  redirect("/account/profile?saved=1");
}
