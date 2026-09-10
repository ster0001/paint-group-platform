"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";

/**
 * ⚑ THE SELF-SIGNUP ACTION IS GONE (Tom, 10 Sep: "remove 'create user'").
 *
 * Removing the button and leaving the action would have been theatre — a
 * server action with no caller is still an endpoint, and this one minted an
 * account for anybody who could reach the login page and type an email.
 *
 * The two ways in that remain are both decisions somebody makes:
 *   · STAFF — Settings → Staff logins, where the areas they can see are set
 *   · CUSTOMERS — the portal's magic link (lib/portal/auth.ts), which creates
 *     the auth user at verification, against an account the estimate already
 *     made
 */

// Where a signed-in user belongs, by role. Staff get the estimating app,
// contractors get the portal, everyone else the customer account (3a-2).
export async function homeForRole(role: string | null | undefined) {
  if (role === "staff") return "/estimates";
  if (role === "contractor") return "/portal";
  return "/account";
}

// Sign in an existing account.
export async function login(formData: FormData) {
  const supabase = await createClient();

  const email = String(formData.get("email") ?? "");
  const password = String(formData.get("password") ?? "");

  const { data, error } = await supabase.auth.signInWithPassword({ email, password });

  if (error) {
    redirect(`/login?error=${encodeURIComponent(error.message)}`);
  }

  const { data: profile } = await supabase
    .from("profiles")
    .select("role")
    .eq("id", data.user!.id)
    .single();

  revalidatePath("/", "layout");
  redirect(await homeForRole(profile?.role));
}

// Sign out.
export async function signout() {
  const supabase = await createClient();
  await supabase.auth.signOut();
  revalidatePath("/", "layout");
  redirect("/login");
}
