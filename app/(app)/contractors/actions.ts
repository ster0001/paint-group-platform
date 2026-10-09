"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { loadMessaging } from "@/lib/messaging/load";
import { buildPlainEmailHtml, sendEmail } from "@/lib/messaging/send";
import { reportError } from "@/lib/monitoring/report";
import { createServiceClient } from "@/lib/supabase/service";
import { PASSWORD_MIN, sendPasswordResetLink, setPasswordForUser } from "@/lib/auth/adminPassword";
import { emailLogoUrl } from "@/lib/messaging/logo";
import { isAuMobile } from "@/lib/validation/contact";

/**
 * Tom, 18 Sep 2026: "send an invitation link to them when registering on the
 * platform — via email". The invite (`contractor_invites`, /join/<token>) has
 * existed since 30 Aug; the office copied the link and sent it by hand. This
 * emails it: one plain white-card email with the link, what it is for and
 * when it expires, through lib/messaging so it is recorded and delivery-
 * tracked like every other send. Staff only — the invites table is staff-RLS,
 * so a non-staff caller simply finds no invite.
 */
const uuid = z.string().uuid();

export type InviteEmailResult = { ok: boolean; message: string };

type InviteRow = {
  id: string; email: string; name: string; company_name: string; token: string;
  expires_at: string; accepted_at: string | null; revoked_at: string | null; emailed_count: number | null;
};

const siteUrl = () => (process.env.NEXT_PUBLIC_SITE_URL || "").replace(/\/$/, "");

export async function emailContractorInvite(inviteId: string): Promise<InviteEmailResult> {
  if (!uuid.safeParse(inviteId).success) return { ok: false, message: "That isn't an invite id." };
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { ok: false, message: "Sign in again." };

  const { data, error } = await supabase
    .from("contractor_invites")
    .select("id, email, name, company_name, token, expires_at, accepted_at, revoked_at, emailed_count")
    .eq("id", inviteId)
    .maybeSingle();
  if (error) {
    reportError(error, { where: "emailContractorInvite.read", extra: { inviteId } });
    return { ok: false, message: "Couldn't read that invite — try again." };
  }
  const inv = data as InviteRow | null;
  if (!inv) return { ok: false, message: "That invite isn't here — it may have been revoked." };
  if (inv.accepted_at) return { ok: false, message: "They've already joined with this link." };
  if (inv.revoked_at) return { ok: false, message: "This invite was revoked — create a new one." };
  if (new Date(inv.expires_at).getTime() < Date.now()) return { ok: false, message: "This invite has expired — create a new one." };
  const site = siteUrl();
  if (!site) return { ok: false, message: "The site address isn't configured on this server (NEXT_PUBLIC_SITE_URL)." };

  const { company } = await loadMessaging(supabase);
  const companyName = company.name || "Paint Group";
  const link = `${site}/join/${inv.token}`;
  const expires = new Intl.DateTimeFormat("en-AU", { timeZone: "Australia/Melbourne", weekday: "long", day: "numeric", month: "long" }).format(new Date(inv.expires_at));
  const first = (inv.name || "").trim().split(/\s+/)[0] || "there";
  const subject = `You're invited to join ${companyName}`;
  const message = [
    `Hi ${first},`,
    `${companyName} has invited you to join our painting platform${inv.company_name ? ` as ${inv.company_name}` : ""}. It's where you'll see job offers, work orders, your schedule and your invoices.`,
    `Open this private link to set up your login:`,
    link,
    `The link is yours alone and works until ${expires}. It takes a minute or two — have your insurance certificate handy so you can be offered work straight away.`,
    company.phone ? `Any questions, call us on ${company.phone}.` : `Any questions, just reply to this email.`,
  ].join("\n\n");
  const html = buildPlainEmailHtml({
    heading: subject, message, companyName,
    logoUrl: emailLogoUrl(company), companyPhone: company.phone,
  });

  const r = await sendEmail({
    to: inv.email, subject, html, replyTo: company.email,
    ctx: { kind: "contractor_invite", actorProfileId: user.id },
  });
  if (r.status !== "sent") {
    const message = r.status === "not_configured"
      ? "Email isn't configured on this server — the invite is recorded as not sent. Copy the link instead."
      : r.status === "error" ? r.message : "The email was not sent.";
    return { ok: false, message };
  }
  const { error: markErr } = await supabase
    .from("contractor_invites")
    .update({ emailed_at: new Date().toISOString(), emailed_count: (inv.emailed_count ?? 0) + 1 })
    .eq("id", inv.id);
  if (markErr) reportError(markErr, { where: "emailContractorInvite.mark", extra: { inviteId }, bestEffort: true });
  revalidatePath("/contractors");
  return { ok: true, message: `Invitation emailed to ${inv.email}.` };
}

// ---- Remove a painter (Tom, 18 Sep 2026) -----------------------------------

export type DeleteContractorResult = { ok: true } | { ok: false; message: string };

const DELETE_WORDING: Record<string, string> = {
  not_staff: "You don't have permission to do that.",
  not_found: "That painter is already gone — refresh the list.",
  not_deleted: "Nothing was removed — the database refused it. Suspend them instead and tell whoever maintains the platform.",
};

/**
 * Thin translation over `delete_contractor` (20270170). Every rule lives in
 * the function: it refuses by name for anyone with history, because the
 * foreign keys would otherwise strip their jobs of a painter and cascade away
 * their certificates. Suspending is the reversible answer for a real painter.
 */
export async function deleteContractorAction(raw: unknown): Promise<DeleteContractorResult> {
  const parsed = z.object({ id: z.string().uuid() }).safeParse(raw);
  if (!parsed.success) return { ok: false, message: "Couldn't find that painter." };
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("delete_contractor", { p_id: parsed.data.id });
  if (error) return { ok: false, message: error.message };

  const s = String(data ?? "");
  if (s.startsWith("ok:")) {
    revalidatePath("/contractors");
    return { ok: true };
  }
  const [, what, detail] = s.split(":");
  const keep = "Suspend access instead — it keeps the record and stops them being offered work.";
  if (what === "jobs") return { ok: false, message: `They are on job ${detail}. Removing them would leave that job with no painter. ${keep}` };
  if (what === "assignments") return { ok: false, message: `They are assigned to ${detail}. Take them off that job first, or suspend them. ${keep}` };
  // Only an ACCEPTED offer blocks now (20270172). A declined or lapsed one no
  // longer locks a painter on the system for ever — Tom, 18 Sep.
  if (what === "offers") return { ok: false, message: `They accepted ${detail}, so that job is theirs on the record. ${keep}` };
  if (what === "invoice") return { ok: false, message: `They have invoice ${detail} on file. ${keep}` };
  if (what === "expenses") return { ok: false, message: `They have ${detail} expense claim${detail === "1" ? "" : "s"} on file. ${keep}` };
  if (what === "preapprovals") return { ok: false, message: `They have ${detail} spending request${detail === "1" ? "" : "s"} on file. ${keep}` };
  if (what === "timesheets") return { ok: false, message: `They have ${detail} clocked day${detail === "1" ? "" : "s"} on file, which payroll needs. ${keep}` };
  return { ok: false, message: DELETE_WORDING[s.replace("error:", "")] ?? "Couldn't remove them just now." };
}

// ---- Tom, 24 Sep: a painter's password, by hand or by reset link -----------

export type LoginToolResult = { ok: true; message: string } | { ok: false; message: string };

/**
 * The painter behind a contractors row, read through the CALLER's session:
 * the table is staff-RLS, so a non-staff caller simply finds no row and gets
 * the refusal. Only then does the service client touch auth.
 */
async function painterLogin(contractorId: string): Promise<{ ok: true; svc: NonNullable<ReturnType<typeof createServiceClient>>; userId: string; email: string; name: string } | { ok: false; message: string }> {
  if (!uuid.safeParse(contractorId).success) return { ok: false, message: "Couldn't find that painter." };
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { ok: false, message: "Sign in again." };
  const { data: me, error: meError } = await supabase.from("profiles").select("role").eq("id", user.id).maybeSingle();
  if (meError) return { ok: false, message: "Couldn't check who you are — try again." };
  if (me?.role !== "staff") return { ok: false, message: "You don't have permission to do that." };
  const { data: row, error } = await supabase.from("contractors").select("profile_id, profiles ( name )").eq("id", contractorId).maybeSingle();
  if (error) { reportError(error, { where: "painterLogin.read", extra: { contractorId } }); return { ok: false, message: "Couldn't read that painter — try again." }; }
  const c = row as { profile_id: string | null; profiles: { name: string | null } | null } | null;
  if (!c) return { ok: false, message: "Couldn't find that painter." };
  if (!c.profile_id) return { ok: false, message: "They haven't joined yet — there is no login to change. Send them the invite link instead." };
  const svc = createServiceClient();
  if (!svc) return { ok: false, message: "This server can't manage logins (no service key)." };
  const { data: u, error: uError } = await svc.auth.admin.getUserById(c.profile_id);
  if (uError || !u.user) return { ok: false, message: "Their login isn't on the system any more." };
  return { ok: true, svc, userId: c.profile_id, email: u.user.email ?? "", name: c.profiles?.name ?? "" };
}

/** The office types a new password for a painter and tells them by phone. */
export async function setContractorPasswordAction(raw: unknown): Promise<LoginToolResult> {
  const parsed = z.object({ id: z.string().uuid(), password: z.string().min(PASSWORD_MIN).max(200) }).safeParse(raw);
  if (!parsed.success) return { ok: false, message: `The password needs at least ${PASSWORD_MIN} characters.` };
  const t = await painterLogin(parsed.data.id);
  if (!t.ok) return t;
  const r = await setPasswordForUser(t.svc, t.userId, parsed.data.password);
  if (!r.ok) return r;
  return { ok: true, message: `Password changed${t.email ? ` for ${t.email}` : ""}. They sign in at /login with it — tell them by phone, not by text.` };
}

/** Email the painter a link that lands on /reset-password. */
export async function sendContractorResetLinkAction(raw: unknown): Promise<LoginToolResult> {
  const parsed = z.object({ id: z.string().uuid() }).safeParse(raw);
  if (!parsed.success) return { ok: false, message: "Couldn't find that painter." };
  const t = await painterLogin(parsed.data.id);
  if (!t.ok) return t;
  return sendPasswordResetLink({ email: t.email, firstName: t.name });
}

/**
 * Tom, 7 Oct 2026: nine jobs' "update your work order" texts went nowhere
 * because three painters had no mobile on file and only the painter could
 * add one. The office now types it on the painter's page. A full Australian
 * mobile or nothing — a half number is what makes a text vanish silently —
 * and the contractors_staff_all policy is the gate (a non-staff session
 * updates no row, which the action reports as not found).
 */
export type SetMobileResult = { ok: boolean; message: string; phone?: string | null };

export async function setContractorMobileAction(raw: unknown): Promise<SetMobileResult> {
  const parsed = z.object({ id: uuid, phone: z.string().max(40) }).safeParse(raw);
  if (!parsed.success) return { ok: false, message: "Couldn't read that — try again." };
  const phone = parsed.data.phone.trim();
  if (phone && !isAuMobile(phone)) {
    return { ok: false, message: "That doesn't look like a full Australian mobile (04xx xxx xxx) — texts can't reach it." };
  }
  const supabase = await createClient();
  const { data, error } = await supabase.from("contractors")
    .update({ phone: phone || null }).eq("id", parsed.data.id).select("id, phone").maybeSingle();
  if (error) { reportError(error, { where: "contractors.setMobile" }); return { ok: false, message: "Couldn't save the mobile — it has been reported." }; }
  if (!data) return { ok: false, message: "Couldn't find that painter." };
  revalidatePath(`/contractors/${parsed.data.id}`);
  revalidatePath("/contractors");
  const saved = (data as { phone: string | null }).phone;
  return { ok: true, phone: saved, message: saved ? `Saved. Job offers, variations and work-order reminders now text ${saved}.` : "Mobile cleared — they will get no texts until one is added." };
}

/**
 * Tom, 7 Oct 2026: "no way to see their bank details". The account number is
 * encrypted at rest and shown masked; this is the click that reveals it, through
 * `contractor_get_bank` (definer: is_staff() or self, logs a `bank_viewed`
 * event for staff — 20270223). Nothing is cached: the number lives in the
 * client's state only until they hide it or leave the page.
 */
export type RevealBankResult = { ok: true; bsb: string; account: string } | { ok: false; message: string };

export async function revealContractorBankAction(raw: unknown): Promise<RevealBankResult> {
  const parsed = z.object({ id: uuid }).safeParse(raw);
  if (!parsed.success) return { ok: false, message: "Couldn't find that painter." };
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("contractor_get_bank", { p_contractor_id: parsed.data.id });
  if (error) {
    reportError(error, { where: "contractors.revealBank" });
    if (error.code === "42501") return { ok: false, message: "Revealing bank details needs migration 20270223 on this database." };
    return { ok: false, message: /not authorised/.test(error.message) ? "Only staff can see a painter's bank details." : "Couldn't read the bank details — it has been reported." };
  }
  const row = (Array.isArray(data) ? data[0] : data) as { bsb: string | null; account: string | null } | undefined;
  if (!row) return { ok: false, message: "Couldn't find that painter." };
  return { ok: true, bsb: row.bsb ?? "", account: row.account ?? "" };
}

// ---- Finish standards (brief Step 2) -----------------------------------------
import { loadStandardsStatuses } from "@/lib/standards/status";
import { sendStandardsInvite, sendStandardsReminder } from "@/lib/standards/notify";
import { notifyBonusApproved } from "@/lib/painterStatus/notify";

export type StandardsActionResult = { ok: true; message: string } | { ok: false; message: string };

/**
 * Invite one existing painter to confirm the standards (message 1): the RPC
 * records the invite and starts the grace period (the gate), then the message
 * goes through the dispatcher and leaves an outcome on the record. Staff only
 * (the RPC refuses anyone else).
 */
export async function inviteStandardsAction(raw: unknown): Promise<StandardsActionResult> {
  const parsed = z.object({ id: uuid }).safeParse(raw);
  if (!parsed.success) return { ok: false, message: "Couldn't read that — try again." };
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("standards_invite", { p_contractor_id: parsed.data.id });
  if (error) { reportError(error, { where: "standards.invite" }); return { ok: false, message: "Couldn't record the invite — it has been reported." }; }
  const r = String(data ?? "");
  if (r === "error:already_confirmed") return { ok: false, message: "They have already confirmed the standards." };
  if (!r.startsWith("ok:")) return { ok: false, message: `Couldn't invite them (${r}).` };
  const service = createServiceClient();
  const outcome = service ? await sendStandardsInvite(service, parsed.data.id) : "no service client";
  revalidatePath("/contractors"); revalidatePath(`/contractors/${parsed.data.id}`);
  return { ok: true, message: outcome === "sent" ? "Invited. The text and email have gone; their grace period has started."
    : outcome === "held" ? "Invited and their grace period has started. It is after hours, so the text and email are queued for the morning sending window."
    : `Invited and the grace period has started, but the message was not sent (${outcome}) — check their mobile and email.` };
}

/** Invite every active painter who has not been invited yet, in one press (launch day). */
export async function inviteAllStandardsAction(): Promise<StandardsActionResult> {
  const supabase = await createClient();
  const { rows, error } = await loadStandardsStatuses(supabase);
  if (error) return { ok: false, message: `Couldn't read who has signed (${error}).` };
  const { data: active, error: aErr } = await supabase.from("contractors").select("id").eq("active", true);
  if (aErr) return { ok: false, message: "Couldn't read the painters." };
  const activeIds = new Set(((active ?? []) as { id: string }[]).map((c) => c.id));
  const due = rows.filter((r) => activeIds.has(r.contractorId) && (r.status === "not_invited" || (r.status === "employee_unsigned" && !r.invitedAt)));
  let sent = 0, failed = 0;
  for (const r of due) {
    const res = await inviteStandardsAction({ id: r.contractorId });
    if (res.ok) sent += 1; else failed += 1;
  }
  return { ok: true, message: `Invited ${sent} painter${sent === 1 ? "" : "s"}${failed ? `, ${failed} failed` : ""}.` };
}

/** Send the reminder text now (message 2) — the PC queue card's action and the detail page's button. */
export async function remindStandardsAction(raw: unknown): Promise<StandardsActionResult> {
  const parsed = z.object({ id: uuid }).safeParse(raw);
  if (!parsed.success) return { ok: false, message: "Couldn't read that — try again." };
  const supabase = await createClient();
  const { data: status, error } = await supabase.rpc("standards_status", { p_contractor_id: parsed.data.id });
  if (error) return { ok: false, message: "Couldn't read their status." };
  if (status === "confirmed") return { ok: false, message: "They have already confirmed the standards." };
  const service = createServiceClient();
  if (!service) return { ok: false, message: "No service client." };
  const outcome = await sendStandardsReminder(service, parsed.data.id, "office");
  revalidatePath("/pc"); revalidatePath(`/contractors/${parsed.data.id}`);
  if (outcome === "sent") return { ok: true, message: "Reminder text sent." };
  if (outcome === "held") return { ok: true, message: "It is after hours — the reminder is queued for the morning sending window. Pressing again queues another." };
  return { ok: false, message: `Reminder not sent (${outcome}) — do they have a mobile on file?` };
}

// ---- Painter status Step 7: the Red clearance and the bonus review ----------

export type StatusActionResult = { ok: boolean; message: string };

/** ⚑8: the owner records "Spoken with, offers allowed" with a reason. Lasts until the colour next changes. */
export async function clearRedAction(raw: unknown): Promise<StatusActionResult> {
  const parsed = z.object({ id: uuid, reason: z.string().trim().min(3).max(500) }).safeParse(raw);
  if (!parsed.success) return { ok: false, message: "Write a short reason first (what was agreed)." };
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("painter_clear_red", { p_painter_id: parsed.data.id, p_reason: parsed.data.reason });
  if (error) { reportError(error, { where: "status.clearRed" }); return { ok: false, message: "Couldn't record it — it has been reported." }; }
  const r = String(data ?? "");
  if (r === "error:not_owner") return { ok: false, message: "Only the owner can clear a Red painter for offers." };
  if (r === "error:not_red") return { ok: false, message: "They are not on Red — nothing to clear." };
  if (!r.startsWith("ok:")) return { ok: false, message: `Couldn't record it (${r}).` };
  revalidatePath(`/contractors/${parsed.data.id}`); revalidatePath("/pc"); revalidatePath("/pc/schedule");
  return { ok: true, message: "Recorded. Offers to them are allowed again until their colour next changes." };
}

/** "Tell Tom": the PC hands a due review to the owner. */
export async function bonusHandOverAction(raw: unknown): Promise<StatusActionResult> {
  const parsed = z.object({ bonusId: uuid, painterId: uuid.optional() }).safeParse(raw);
  if (!parsed.success) return { ok: false, message: "Couldn't read that — try again." };
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("bonus_hand_over", { p_id: parsed.data.bonusId });
  if (error) { reportError(error, { where: "bonus.handOver" }); return { ok: false, message: "Couldn't hand it over — it has been reported." }; }
  const r = String(data ?? "");
  if (r === "error:not_due") return { ok: false, message: "This review is already with the owner or decided." };
  if (!r.startsWith("ok:")) return { ok: false, message: `Couldn't hand it over (${r}).` };
  revalidatePath("/pc"); if (parsed.data.painterId) revalidatePath(`/contractors/${parsed.data.painterId}`);
  return { ok: true, message: "Handed to Tom. It stays on the painter's page until he decides." };
}

/** The owner approves (with the amount, dollars in) or declines. Approve is refused while the Settings switch is off. */
export async function bonusDecideAction(raw: unknown): Promise<StatusActionResult> {
  const parsed = z.object({
    bonusId: uuid, painterId: uuid, approve: z.boolean(),
    amount: z.coerce.number().min(0).max(100_000).optional(), note: z.string().trim().max(500).default(""),
  }).safeParse(raw);
  if (!parsed.success) return { ok: false, message: "Check the amount and try again." };
  const v = parsed.data;
  const cents = v.approve ? Math.round((v.amount ?? 0) * 100) : null;
  if (v.approve && (!cents || cents <= 0)) return { ok: false, message: "Enter the bonus amount in dollars." };
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("bonus_decide", { p_id: v.bonusId, p_approve: v.approve, p_amount_cents: cents, p_note: v.note });
  if (error) { reportError(error, { where: "bonus.decide" }); return { ok: false, message: "Couldn't record the decision — it has been reported." }; }
  const r = String(data ?? "");
  if (r === "error:not_owner") return { ok: false, message: "Only the owner decides a bonus." };
  if (r === "error:approvals_off") return { ok: false, message: "Bonus approvals are switched off until the GST and payroll questions are settled (Settings → painter_status_rules.bonusApprovalsEnabled). Declining still works." };
  if (!r.startsWith("ok:")) return { ok: false, message: `Couldn't record it (${r}).` };
  let told = "";
  if (v.approve && cents) {
    const service = createServiceClient();
    if (service) {
      const { data: c, error: cErr } = await service.from("contractors").select("employment_type").eq("id", v.painterId).maybeSingle();
      if (cErr) reportError(cErr, { where: "bonus.decide.painter", bestEffort: true });
      const employee = (c as { employment_type?: string } | null)?.employment_type === "employee";
      const outcome = await notifyBonusApproved(service, v.painterId, v.bonusId, cents, employee);
      told = outcome === "sent" ? (employee ? " They have been told it goes on their next pay run." : " They have been told and can claim it in the app.")
        : outcome === "held" ? " The text is queued for the morning sending window." : ` The text was not sent (${outcome}).`;
    }
  }
  revalidatePath(`/contractors/${v.painterId}`); revalidatePath("/pc"); revalidatePath("/portal/money");
  return { ok: true, message: v.approve ? `Approved.${told}` : "Declined and recorded." };
}
