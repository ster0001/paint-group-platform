"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { getPortalContext } from "@/lib/portal/data";
import { viewerTradeRole } from "@/lib/portal/approvalData";
import { createServiceClient } from "@/lib/supabase/service";
import { isTestEmail, normaliseEmail } from "@/lib/accounts/identity";
import { sendMagicLink } from "@/lib/portal/auth";

export type TeamResult = { ok: true } | { ok: false; message: string };

async function adminContext() {
  const ctx = await getPortalContext();
  if (!ctx) return null;
  const trade = ctx.accounts.find((a) => a.account_type === "trade");
  if (!trade) return null;
  const role = await viewerTradeRole(ctx);
  if (role !== "admin" && role !== "owner") return null;
  return { ctx, accountId: trade.id };
}

const inviteInput = z.object({
  email: z.string().trim().email().max(200),
  role: z.enum(["admin", "approver", "viewer", "finance"]),
  propertyIds: z.array(z.string().uuid()).max(200).default([]),
  approvalLimitDollars: z.number().int().min(0).max(10_000_000).nullable().default(null),
});

/**
 * Session 6 · Invite (§5.7): creates the login if none exists, the
 * membership with role / scope / limit, and emails a sign-in link. Admin
 * only — memberships are vouched by the org's admin, the office-grant
 * threat model (28 Aug) extended one hop.
 */
export async function inviteTeamMember(raw: unknown): Promise<TeamResult> {
  const parsed = inviteInput.safeParse(raw);
  if (!parsed.success) return { ok: false, message: "A valid email and role are needed." };
  const admin = await adminContext();
  if (!admin) return { ok: false, message: "Only your organisation's admin can invite people." };
  const svc = createServiceClient();
  if (!svc) return { ok: false, message: "Try again shortly." };

  const email = normaliseEmail(parsed.data.email);
  // Find or create the login. createUser refuses duplicates, so fall back
  // to the (small) user listing — the seed-script pattern.
  let userId: string | null = null;
  const created = await svc.auth.admin.createUser({
    email, email_confirm: true,
    password: `pg-${Math.random().toString(36).slice(2)}${Date.now()}`,
  });
  if (created.data.user) userId = created.data.user.id;
  else {
    const { data: users } = await svc.auth.admin.listUsers({ perPage: 1000 });
    userId = users?.users?.find((u) => u.email === email)?.id ?? null;
  }
  if (!userId) return { ok: false, message: "Couldn't set up that login just now." };

  const membership = {
    account_id: admin.accountId,
    profile_id: userId,
    role: parsed.data.role,
    property_scope: parsed.data.propertyIds.length ? parsed.data.propertyIds : null,
    approval_limit_cents: parsed.data.approvalLimitDollars != null ? parsed.data.approvalLimitDollars * 100 : null,
  };
  const ins = await svc.from("account_users").insert(membership);
  if (ins.error) {
    // Already a member → the invite updates their seat instead.
    const upd = await svc.from("account_users").update({
      role: membership.role, property_scope: membership.property_scope,
      approval_limit_cents: membership.approval_limit_cents,
    }).eq("account_id", admin.accountId).eq("profile_id", userId);
    if (upd.error) return { ok: false, message: "Couldn't save that seat." };
  }

  if (!isTestEmail(email)) {
    await sendMagicLink({
      email,
      subject: "You've been added to your team's Paint Group workspace",
      intro: "Your organisation set you up with access — properties, colours and progress, all in one place.",
      buttonLabel: "Open your workspace",
    }).catch(() => {});
  }
  revalidatePath("/account/team");
  return { ok: true };
}

const prefsInput = z.object({
  accountUserId: z.string().uuid(),
  digest: z.enum(["default", "on", "off"]),
  digestTime: z.string().regex(/^([01]\d|2[0-3]):00$/).default("17:00"),
  approvalsChannel: z.enum(["email", "sms", "both"]),
  invoicesEmail: z.string().trim().email().max(200).or(z.literal("")).default(""),
});

/** Notification routing per person (⚑11: all of it editable under Team). */
export async function updateNotificationPrefs(raw: unknown): Promise<TeamResult> {
  const parsed = prefsInput.safeParse(raw);
  if (!parsed.success) return { ok: false, message: "That didn't make sense — check the fields." };
  const ctx = await getPortalContext();
  if (!ctx) return { ok: false, message: "Sign in first." };
  const svc = createServiceClient();
  if (!svc) return { ok: false, message: "Try again shortly." };

  const { data: member } = await svc.from("account_users")
    .select("id, account_id, profile_id").eq("id", parsed.data.accountUserId).maybeSingle();
  if (!member) return { ok: false, message: "That seat no longer exists." };
  const role = await viewerTradeRole(ctx);
  const isSelf = member.profile_id === ctx.userId;
  const isAdmin = (role === "admin" || role === "owner")
    && ctx.accounts.some((a) => a.id === member.account_id);
  if (!isSelf && !isAdmin) return { ok: false, message: "Only your admin can change someone else's routing." };

  const { error } = await svc.from("notification_prefs").upsert({
    account_user_id: member.id,
    digest_enabled: parsed.data.digest === "default" ? null : parsed.data.digest === "on",
    digest_time: `${parsed.data.digestTime}:00`,
    approvals_channel: parsed.data.approvalsChannel,
    invoices_email: parsed.data.invoicesEmail || null,
  }, { onConflict: "account_user_id" });
  if (error) return { ok: false, message: "Couldn't save that routing." };
  revalidatePath("/account/team");
  return { ok: true };
}
