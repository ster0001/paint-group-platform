"use server";

import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { createServiceClient } from "@/lib/supabase/service";
import { reportError } from "@/lib/monitoring/report";
import { STAFF_AREA_KEYS, parseStaffAccess, type StaffAccess } from "@/lib/staff/access";
import { STAFF_EVENT_KEYS, parseStaffNotify, type StaffNotifyMap } from "@/lib/staff/notifyEvents";
import { normalisePhoneAU } from "@/lib/messaging/config";

/**
 * Settings → Company → Staff logins (Tom, 5 Sep 2026).
 *
 * Who may act: the master user (profiles.is_owner). While no master exists
 * yet, any staff login may create the first one — that is how the first
 * master is made. Writes go through the service client; the profiles
 * trigger (migration 20270106) refuses the same edits over plain REST.
 */

export type StaffRow = {
  id: string;
  email: string;
  name: string;
  /** Tom, 10 Sep: a mobile for staff text alerts. */
  phone: string;
  isOwner: boolean;
  access: StaffAccess;
  /** Tom, 10 Sep: which staff alerts reach this person, by channel. */
  notify: StaffNotifyMap;
  self: boolean;
};

type Caller = { id: string; isOwner: boolean; ownerExists: boolean; canManage: boolean };

async function caller(): Promise<Caller | null> {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return null;
  const { data: me } = await supabase.from("profiles").select("role, is_owner").eq("id", user.id).maybeSingle();
  if (me?.role !== "staff") return null;
  const svc = createServiceClient();
  if (!svc) return null;
  const { count } = await svc.from("profiles").select("id", { count: "exact", head: true }).eq("role", "staff").eq("is_owner", true);
  const ownerExists = (count ?? 0) > 0;
  const isOwner = me.is_owner === true;
  return { id: user.id, isOwner, ownerExists, canManage: isOwner || !ownerExists };
}

/**
 * Email lives on auth.users. One admin lookup per staff id — paging the whole
 * user list stopped finding anyone once the wizard's anon sessions pushed
 * the test project past the page cap (10 Sep), and staff are a handful.
 */
async function emailsById(svc: NonNullable<ReturnType<typeof createServiceClient>>, ids: Set<string>): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  await Promise.all([...ids].map(async (id) => {
    const { data } = await svc.auth.admin.getUserById(id);
    if (data?.user) out.set(id, data.user.email ?? "");
  }));
  return out;
}

export type StaffListResult =
  | { status: "ok"; rows: StaffRow[]; canManage: boolean; isOwner: boolean; ownerExists: boolean }
  | { status: "error"; message: string };

export async function listStaffAction(): Promise<StaffListResult> {
  const c = await caller();
  if (!c) return { status: "error", message: "Staff only." };
  const svc = createServiceClient()!;
  const full = await svc.from("profiles").select("id, name, is_owner, staff_access, phone, staff_notify").eq("role", "staff").order("created_at");
  // Pre-20270134 the phone / staff_notify columns 42703 the select — retry without them.
  const { data, error } = full.error
    ? await svc.from("profiles").select("id, name, is_owner, staff_access").eq("role", "staff").order("created_at")
    : full;
  if (error) return { status: "error", message: error.message };
  const ids = new Set((data ?? []).map((r) => r.id as string));
  const emails = await emailsById(svc, ids);
  const rows: StaffRow[] = (data ?? []).map((r) => ({
    id: r.id as string,
    email: emails.get(r.id as string) ?? "",
    name: (r.name as string | null) ?? "",
    phone: ((r as { phone?: string | null }).phone ?? "") || "",
    isOwner: r.is_owner === true,
    access: parseStaffAccess(r.staff_access),
    notify: parseStaffNotify((r as { staff_notify?: unknown }).staff_notify),
    self: r.id === c.id,
  }));
  return { status: "ok", rows, canManage: c.canManage, isOwner: c.isOwner, ownerExists: c.ownerExists };
}

const accessSchema = z.record(z.string(), z.boolean()).transform((m) => {
  const out: StaffAccess = {};
  for (const k of STAFF_AREA_KEYS) if (m[k] === false) out[k] = false;
  return out;
});

/** A mobile as typed → E.164, "" to clear; anything else is refused with a message. */
const phoneSchema = z.string().trim().max(30).transform((v, ctx) => {
  if (!v) return "";
  const n = normalisePhoneAU(v);
  if (!n) { ctx.addIssue({ code: "custom", message: "phone" }); return z.NEVER; }
  return n;
});

const createSchema = z.object({
  email: z.string().trim().toLowerCase().email().max(200),
  name: z.string().trim().max(120),
  phone: phoneSchema.optional(),
  password: z.string().min(8).max(200),
  isOwner: z.boolean(),
  access: accessSchema,
});

export type StaffWriteResult = { status: "ok"; message: string } | { status: "error"; message: string };

export async function createStaffAction(input: { email: string; name: string; phone?: string; password: string; isOwner: boolean; access: Record<string, boolean> }): Promise<StaffWriteResult> {
  const c = await caller();
  if (!c) return { status: "error", message: "Staff only." };
  if (!c.canManage) return { status: "error", message: "Only the master user can create staff logins." };
  const parsed = createSchema.safeParse(input);
  if (!parsed.success) {
    const pw = parsed.error.issues.some((i) => i.path[0] === "password");
    const ph = parsed.error.issues.some((i) => i.path[0] === "phone");
    return { status: "error", message: pw ? "The password needs at least 8 characters." : ph ? "That mobile doesn't look right — 04xx xxx xxx." : "Check the email address." };
  }
  const { email, name, phone, password, isOwner, access } = parsed.data;
  const svc = createServiceClient()!;
  try {
    const res = await svc.auth.admin.createUser({ email, password, email_confirm: true, user_metadata: name ? { name } : undefined });
    if (res.error) {
      if (/already been registered|already exists/i.test(res.error.message)) {
        return { status: "error", message: `${email} already has a login. Remove it first, or use a different address.` };
      }
      throw new Error(res.error.message);
    }
    const userId = res.data.user?.id;
    if (!userId) throw new Error("no user id back from auth");
    // handle_new_user made a customer profile on insert; make it staff.
    const upd = await svc.from("profiles").upsert({ id: userId, role: "staff", name: name || null, is_owner: isOwner, staff_access: isOwner ? {} : access, ...(phone !== undefined ? { phone: phone || null } : {}) }, { onConflict: "id" });
    if (upd.error) throw new Error(upd.error.message);
    return { status: "ok", message: `${email} can sign in at /login with that password.${isOwner ? " They are a master user." : ""}` };
  } catch (e) {
    reportError(e, { where: "settings.createStaff" });
    return { status: "error", message: e instanceof Error ? e.message : "Something went wrong." };
  }
}

const updateSchema = z.object({ id: z.string().uuid(), isOwner: z.boolean(), access: accessSchema, name: z.string().trim().max(120).optional(), phone: phoneSchema.optional() });

export async function updateStaffAction(input: { id: string; isOwner: boolean; access: Record<string, boolean>; name?: string; phone?: string }): Promise<StaffWriteResult> {
  const c = await caller();
  if (!c) return { status: "error", message: "Staff only." };
  if (!c.isOwner) return { status: "error", message: "Only the master user can change what a staff login sees." };
  const parsed = updateSchema.safeParse(input);
  if (!parsed.success) {
    const ph = parsed.error.issues.some((i) => i.path[0] === "phone");
    return { status: "error", message: ph ? "That mobile doesn't look right — 04xx xxx xxx." : "Check the details." };
  }
  const { id, isOwner, access, name, phone } = parsed.data;
  const svc = createServiceClient()!;
  if (id === c.id && !isOwner) {
    const { count } = await svc.from("profiles").select("id", { count: "exact", head: true }).eq("role", "staff").eq("is_owner", true);
    if ((count ?? 0) <= 1) return { status: "error", message: "You are the only master user — make someone else master first." };
  }
  const upd = await svc.from("profiles").update({ is_owner: isOwner, staff_access: isOwner ? {} : access, ...(name !== undefined ? { name: name || null } : {}), ...(phone !== undefined ? { phone: phone || null } : {}) }).eq("id", id).eq("role", "staff");
  if (upd.error) return { status: "error", message: upd.error.message };
  return { status: "ok", message: "Saved." };
}

// ---- Tom, 10 Sep: staff alerts routing -------------------------------------

const notifySchema = z.object({
  id: z.string().uuid(),
  notify: z.record(z.string(), z.array(z.enum(["email", "sms"]))).transform((m) => {
    const out: Record<string, string[]> = {};
    for (const k of STAFF_EVENT_KEYS) if (Array.isArray(m[k]) && m[k].length) out[k] = [...new Set(m[k])];
    return out;
  }),
});

/**
 * Which staff alerts reach a person, by channel — the routing table on
 * Settings → Automations. The master user sets anyone's; each person may set
 * their own (the profiles trigger, 20270134, refuses anyone else over REST).
 */
export async function updateStaffNotifyAction(input: { id: string; notify: Record<string, string[]> }): Promise<StaffWriteResult> {
  const c = await caller();
  if (!c) return { status: "error", message: "Staff only." };
  const parsed = notifySchema.safeParse(input);
  if (!parsed.success) return { status: "error", message: "Check the details." };
  if (!c.isOwner && parsed.data.id !== c.id) return { status: "error", message: "Only the master user can change someone else's alerts." };
  const svc = createServiceClient()!;
  const upd = await svc.from("profiles").update({ staff_notify: parsed.data.notify }).eq("id", parsed.data.id).eq("role", "staff");
  if (upd.error) return { status: "error", message: upd.error.message };
  return { status: "ok", message: "Saved." };
}

export async function removeStaffAction(input: { id: string }): Promise<StaffWriteResult> {
  const c = await caller();
  if (!c) return { status: "error", message: "Staff only." };
  if (!c.isOwner) return { status: "error", message: "Only the master user can remove a staff login." };
  if (input.id === c.id) return { status: "error", message: "You cannot remove your own login." };
  const svc = createServiceClient()!;
  const { data: target } = await svc.from("profiles").select("role").eq("id", input.id).maybeSingle();
  if (target?.role !== "staff") return { status: "error", message: "That is not a staff login." };
  // Delete the login outright. Rows they created (estimates.created_by is
  // NO ACTION) can refuse that — then the login is locked out instead, and
  // their staff role is taken away, so nothing they touched is lost.
  const del = await svc.auth.admin.deleteUser(input.id);
  if (!del.error) return { status: "ok", message: "Login removed." };
  const ban = await svc.auth.admin.updateUserById(input.id, { ban_duration: "876000h" });
  const demote = await svc.from("profiles").update({ role: "customer", is_owner: false, staff_access: {} }).eq("id", input.id);
  if (ban.error || demote.error) return { status: "error", message: ban.error?.message ?? demote.error?.message ?? del.error.message };
  return { status: "ok", message: "Login locked out and its staff access removed (their records stay on file)." };
}
