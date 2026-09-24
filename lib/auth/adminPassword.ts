import type { SupabaseClient, User } from "@supabase/supabase-js";
import { sendMagicLink, type MagicLinkResult } from "@/lib/portal/auth";
import { reportError } from "@/lib/monitoring/report";

/**
 * Tom, 24 Sep 2026: "allow to manually update passwords and send reset links"
 * for contractors AND staff. SERVER ONLY — every function takes the service
 * client, and the callers (settings/staffActions, contractors/actions) decide
 * who may ask. One implementation for both roles, never a fork.
 */

export const PASSWORD_MIN = 8;

/** The page a reset link lands on once the click has proved the inbox. */
export const RESET_PASSWORD_PATH = "/reset-password";

/**
 * Find the auth user behind an email. `auth.admin` has no lookup-by-email,
 * and paging `listUsers` stopped finding anyone once the wizard's anon
 * sessions pushed the test project past the page cap (10 Sep). `generateLink`
 * answers directly with the user and sends nothing (the trade portal relies
 * on the same trick); the token it mints is discarded unused.
 */
export async function findAuthUserByEmail(svc: SupabaseClient, email: string): Promise<User | null> {
  const wanted = email.trim().toLowerCase();
  if (!wanted) return null;
  const link = await svc.auth.admin.generateLink({ type: "magiclink", email: wanted });
  if (!link.error && link.data?.user) return link.data.user;
  // Last resort: a short walk through the list.
  for (let page = 1; page <= 5; page++) {
    const { data, error } = await svc.auth.admin.listUsers({ page, perPage: 200 });
    if (error) { reportError(error, { where: "adminPassword.listUsers", bestEffort: true }); return null; }
    const u = data.users.find((x) => (x.email ?? "").toLowerCase() === wanted);
    if (u) return u;
    if (data.users.length < 200) break;
  }
  return null;
}

/** A login the office removed (removeStaffAction's fallback bans it for a hundred years). */
export function isBanned(u: Pick<User, "banned_until"> | null | undefined): boolean {
  const until = u?.banned_until;
  return !!until && new Date(until).getTime() > Date.now();
}

export type SetPasswordResult = { ok: true } | { ok: false; message: string };

/** Set a password by hand. The caller has already decided this person may. */
export async function setPasswordForUser(svc: SupabaseClient, userId: string, password: string): Promise<SetPasswordResult> {
  if (password.length < PASSWORD_MIN) return { ok: false, message: `The password needs at least ${PASSWORD_MIN} characters.` };
  const { error } = await svc.auth.admin.updateUserById(userId, { password });
  if (error) {
    reportError(error, { where: "adminPassword.set", extra: { userId } });
    return { ok: false, message: /weak|pwned|leaked|common/i.test(error.message) ? "That password is too easy to guess — pick a longer one." : "That didn't save — try again." };
  }
  return { ok: true };
}

export type ResetLinkResult = { ok: true; message: string } | { ok: false; message: string };

/**
 * Email a reset link: the portal's own magic link (one implementation),
 * landing on /reset-password where they choose a new password. The click
 * proves the inbox; nothing about their old password is needed.
 */
export async function sendPasswordResetLink(opts: { email: string; firstName?: string | null }): Promise<ResetLinkResult> {
  const first = (opts.firstName ?? "").trim().split(/\s+/)[0] || "there";
  const r: MagicLinkResult = await sendMagicLink({
    email: opts.email,
    next: RESET_PASSWORD_PATH,
    subject: "Reset your password",
    intro: `Hi ${first},\n\nThe office has sent you this link so you can choose a new password. Open it, type a new password twice, and you're signed in.\n\nThe link works for 60 minutes. If it runs out, ask the office for a fresh one.`,
    buttonLabel: "Choose a new password",
  });
  if (r.status === "sent") return { ok: true, message: `Reset link emailed to ${opts.email}. It works for 60 minutes.` };
  if (r.status === "throttled") return { ok: false, message: "Three links have gone to that address in the last hour — wait a while, or set a password by hand." };
  if (r.status === "not_configured") return { ok: false, message: "Email isn't configured on this server — set a password by hand instead." };
  if (r.status === "invalid") return { ok: false, message: "That login has no email address to send to." };
  return { ok: false, message: "The link couldn't be sent just now — try again, or set a password by hand." };
}
