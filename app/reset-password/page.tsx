import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { homeForRole } from "@/app/auth/actions";
import { reportError } from "@/lib/monitoring/report";
import ResetPasswordForm from "./ResetPasswordForm";

export const dynamic = "force-dynamic";

/**
 * Where a reset link lands (Tom, 24 Sep 2026). The click on the emailed link
 * has already signed them in (/account/auth verified the token), so all that
 * is left is choosing the new password — through THEIR OWN session, the same
 * way the customer portal's SetPassword works, so no password crosses our
 * server. Works for any role: staff go home, painters to the portal.
 */
export default async function ResetPasswordPage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login?error=" + encodeURIComponent("That reset link has expired or was already used — ask the office for a fresh one."));
  const { data: profile, error } = await supabase.from("profiles").select("role").eq("id", user.id).maybeSingle();
  if (error) reportError(error, { where: "resetPassword.profile", bestEffort: true });
  const home = await homeForRole(profile?.role);
  return (
    <main className="flex min-h-screen items-center justify-center bg-gray-50 p-6">
      <div className="w-full max-w-sm rounded-xl border border-gray-200 bg-white p-6 shadow-sm">
        <h1 className="text-xl font-semibold tracking-tight">Choose a new password</h1>
        <p className="mt-1 text-sm text-gray-500">For {user.email}. You&rsquo;ll use it next time you sign in.</p>
        <ResetPasswordForm home={home} />
      </div>
    </main>
  );
}
