"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { loadMessaging } from "@/lib/messaging/load";
import { buildPlainEmailHtml, sendEmail } from "@/lib/messaging/send";
import { reportError } from "@/lib/monitoring/report";

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
    logoUrl: company.logoUrlLight || company.logoUrl, companyPhone: company.phone,
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
