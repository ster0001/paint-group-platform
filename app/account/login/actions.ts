"use server";

import { redirect } from "next/navigation";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { afterVerifiedSignIn, sendMagicLink, safeNextPath } from "@/lib/portal/auth";

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

const codeSchema = z.object({
  email: z.string().trim().toLowerCase().email().max(200),
  code: z.string().transform((v) => v.replace(/\D/g, "")).pipe(z.string().length(6)),
  next: z.string().max(300).optional(),
});

/** The 6-digit code from the sign-in email, typed on the "Check your email"
 * page (14 Oct 2026). It spends the same single-use token the link does —
 * the proof of the inbox is identical — but a mail scanner cannot type it.
 * A wrong or stale code lands back on the same page with a plain line. */
export async function verifyCodeAction(formData: FormData): Promise<void> {
  const parsed = codeSchema.safeParse({
    email: String(formData.get("email") ?? ""),
    code: String(formData.get("code") ?? ""),
    next: String(formData.get("next") ?? "") || undefined,
  });
  const email = String(formData.get("email") ?? "").trim().toLowerCase().slice(0, 200);
  const nextParam = String(formData.get("next") ?? "").slice(0, 300);
  const back = (error: string) =>
    `/account/login?sent=${encodeURIComponent(email)}&error=${error}${nextParam ? `&next=${encodeURIComponent(nextParam)}` : ""}`;
  if (!parsed.success) redirect(back("code"));

  const supabase = await createClient();
  const { data, error } = await supabase.auth.verifyOtp({
    type: "email",
    email: parsed.data.email,
    token: parsed.data.code,
  });
  if (error || !data.user?.email) redirect(back("code"));

  await afterVerifiedSignIn(supabase, data.user);
  redirect(safeNextPath(parsed.data.next));
}
