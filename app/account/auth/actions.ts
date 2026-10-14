"use server";

import { redirect } from "next/navigation";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { ensureMembership, safeNextPath } from "@/lib/portal/auth";
import { reportError } from "@/lib/monitoring/report";

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

  // Tom, 24 Sep: staff and painters click magic links too now (a password
  // reset lands here). Joining THEM to a customer account chain would mint a
  // customer account for an office address — membership is for customers.
  const { data: profile, error: profileError } = await supabase.from("profiles").select("role").eq("id", data.user.id).maybeSingle();
  if (profileError) reportError(profileError, { where: "account.auth.role", bestEffort: true });
  const isCustomer = profile?.role !== "staff" && profile?.role !== "contractor";

  try {
    if (isCustomer) await ensureMembership(data.user.id, data.user.email);
  } catch (err) {
    // Membership is retried on the next visit by the portal gate — a hiccup
    // here must not cost the customer their sign-in.
    reportError(err, { where: "account.auth.membership", bestEffort: true });
  }

  redirect(next);
}
