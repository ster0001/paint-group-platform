"use server";

import { redirect } from "next/navigation";
import { z } from "zod";
import { sendMagicLink, safeNextPath } from "@/lib/portal/auth";

const inputSchema = z.object({
  email: z.string().trim().toLowerCase().email().max(200),
  next: z.string().max(300).optional(),
});

/** Email a sign-in link. The reply never reveals whether the address has an
 * account — "we've sent it" reads the same either way. */
export async function requestLinkAction(formData: FormData): Promise<void> {
  const parsed = inputSchema.safeParse({
    email: String(formData.get("email") ?? ""),
    next: String(formData.get("next") ?? "") || undefined,
  });
  if (!parsed.success) {
    redirect("/account/login?error=email");
  }
  const { email, next } = parsed.data;

  const result = await sendMagicLink({ email, next: safeNextPath(next) });
  if (result.status === "invalid") redirect("/account/login?error=email");
  if (result.status === "throttled") redirect("/account/login?error=slow");
  if (result.status === "not_configured" || result.status === "unavailable") {
    redirect("/account/login?error=off");
  }
  redirect(`/account/login?sent=${encodeURIComponent(email)}`);
}
