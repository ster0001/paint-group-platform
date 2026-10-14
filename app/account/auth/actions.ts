"use server";

import { redirect } from "next/navigation";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { afterVerifiedSignIn, safeNextPath } from "@/lib/portal/auth";

const inputSchema = z.object({
  token_hash: z.string().min(1).max(300),
  next: z.string().max(300).optional(),
});

/**
 * The tap on /account/auth. verifyOtp turns the single-use token into a
 * session — that is what proves possession of the inbox — and only then does
 * the login join its account (the 3a-1 membership ruling).
 *
 * Failure is never a dead end — expired/used links land on the login page
 * with a plain explanation and a one-tap resend.
 */
export async function redeemLinkAction(formData: FormData): Promise<void> {
  const parsed = inputSchema.safeParse({
    token_hash: String(formData.get("token_hash") ?? ""),
    next: String(formData.get("next") ?? "") || undefined,
  });
  if (!parsed.success) redirect("/account/login?error=link");
  const next = safeNextPath(parsed.data.next);

  const supabase = await createClient();
  const { data, error } = await supabase.auth.verifyOtp({ type: "email", token_hash: parsed.data.token_hash });
  if (error || !data.user?.email) redirect("/account/login?error=link");

  await afterVerifiedSignIn(supabase, data.user);
  redirect(next);
}
