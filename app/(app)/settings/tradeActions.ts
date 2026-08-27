"use server";

import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { createServiceClient } from "@/lib/supabase/service";
import { ensureAccount } from "@/lib/accounts/link";
import { reportError } from "@/lib/monitoring/report";

/**
 * Back-office trade account creation (Tom, 28 Aug): "this needs to be
 * created by us in the back end, with a username and password (they can
 * change the password)."
 *
 * Staff-only. Creates the auth login (email + staff-chosen starting
 * password, email pre-confirmed so the password works immediately), the
 * account (type=trade), and the owner membership in one go. The customer
 * changes the password any time in /account/profile; the emailed sign-in
 * link works for them too.
 *
 * On the 3a-1 "membership only from VERIFIED auth" ruling: that guards
 * against a stranger TYPING someone's email into a form. Here the OFFICE is
 * the authority — staff mint the credentials and hand them over, so the
 * membership is vouched for, not inferred. If the email already has a
 * login, the existing password is NEVER touched — the account is granted
 * trade and the person keeps signing in as before.
 */

const inputSchema = z.object({
  email: z.string().trim().toLowerCase().email().max(200),
  name: z.string().trim().max(120),
  phone: z.string().trim().max(40),
  password: z.string().min(8).max(100),
});

export type CreateTradeResult =
  | { status: "created"; email: string }
  | { status: "existing_login"; email: string }
  | { status: "error"; message: string };

export async function createTradeAccountAction(formData: FormData): Promise<CreateTradeResult> {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { status: "error", message: "Not signed in." };
  const { data: profile } = await supabase.from("profiles").select("role").eq("id", user.id).maybeSingle();
  if (profile?.role !== "staff") return { status: "error", message: "Staff only." };

  const parsed = inputSchema.safeParse({
    email: String(formData.get("email") ?? ""),
    name: String(formData.get("name") ?? ""),
    phone: String(formData.get("phone") ?? ""),
    password: String(formData.get("password") ?? ""),
  });
  if (!parsed.success) {
    const pwIssue = parsed.error.issues.some((i) => i.path[0] === "password");
    return { status: "error", message: pwIssue ? "The password needs at least 8 characters." : "Check the email address." };
  }
  const { email, name, phone, password } = parsed.data;

  const svc = createServiceClient();
  if (!svc) return { status: "error", message: "Service key not configured on this machine." };

  try {
    // 1. The login. email_confirm: the office IS the verification here — the
    // password must work the moment it's handed over, no click required.
    let created = true;
    let userId: string | null = null;
    const res = await svc.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
      user_metadata: name ? { name } : undefined,
    });
    if (res.error) {
      if (!/already been registered|already exists/i.test(res.error.message)) {
        throw new Error(res.error.message);
      }
      // Existing login: NEVER overwrite their password. Resolve their user id
      // via generateLink (admin-side, sends nothing) for the membership below.
      created = false;
      const link = await svc.auth.admin.generateLink({ type: "magiclink", email });
      userId = link.data?.user?.id ?? null;
    } else {
      userId = res.data.user?.id ?? null;
    }

    // 2. The account — find-or-create by email, then make it trade.
    const ensured = await ensureAccount(svc, { email, name, phone });
    if (!ensured.accountId) throw new Error("couldn't create the account row");
    const upd = await svc.from("accounts")
      .update({ account_type: "trade", ...(name ? { name } : {}), ...(phone ? { phone } : {}) })
      .eq("id", ensured.accountId);
    if (upd.error) throw new Error(upd.error.message);

    // 3. The membership — owner if first in. 23505 = already a member, fine.
    if (userId) {
      const { count } = await svc.from("account_users")
        .select("id", { count: "exact", head: true }).eq("account_id", ensured.accountId);
      const ins = await svc.from("account_users").insert({
        account_id: ensured.accountId,
        profile_id: userId,
        role: (count ?? 0) === 0 ? "owner" : "member",
      });
      if (ins.error && ins.error.code !== "23505") throw new Error(ins.error.message);
    }

    return created ? { status: "created", email } : { status: "existing_login", email };
  } catch (e) {
    reportError(e, { where: "settings.createTradeAccount" });
    return { status: "error", message: e instanceof Error ? e.message : "Something went wrong." };
  }
}
