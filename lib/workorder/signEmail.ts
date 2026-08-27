/**
 * The signed-report email — ⚑10, default ON.
 *
 * Sent the moment a sign-off lands (any kind but deemed — a deemed sign-off's
 * comms belong to the nudge ladder and its legal wording, not this note).
 * The email carries no report body: it links to the customer's own signed
 * walkthrough page, which IS the record and needs no second copy to drift.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import { buildEstimateEmailHtml, sendEmail } from "@/lib/messaging/send";
import { reportError } from "@/lib/monitoring/report";

export function signedReportEmail(vars: {
  firstName: string; jobTitle: string; signedName: string; link: string; company: string;
  /** The LIGHT-background logo — email renders on white (the standing rule). */
  logoUrl?: string;
  companyPhone?: string;
}): { subject: string; html: string } {
  const hi = vars.firstName ? `Hi ${vars.firstName},` : "Hello,";
  const intro = [
    hi,
    `Thanks — the work at ${vars.jobTitle} has been signed off${vars.signedName ? ` by ${vars.signedName}` : ""}.`,
    "Your completion report and warranty details are yours to keep — open them any time from the button below. They also live under Documents in your account.",
    "Anything you notice later is covered by your two-year warranty — just reply to this email.",
  ].join("\n\n");
  return {
    subject: `Your completion report — ${vars.jobTitle}`,
    html: buildEstimateEmailHtml({
      intro,
      link: vars.link,
      companyName: vars.company,
      logoUrl: vars.logoUrl,
      companyPhone: vars.companyPhone,
      buttonLabel: "Open my completion report",
    }),
  };
}

/** True when ⚑10 says send. Reads wo_loop.walkthrough.signEmailImmediate. */
export function shouldSendSignEmail(woLoopValue: unknown, signedKind: string): boolean {
  if (signedKind === "deemed") return false;
  const v = woLoopValue as { walkthrough?: { signEmailImmediate?: unknown } } | null;
  // Default ON: absence of the setting is the shipped default, not an off.
  return (v?.walkthrough?.signEmailImmediate ?? true) === true;
}

/**
 * Fire-and-account-for: called after a successful sign. Uses the SERVICE
 * client because the signer is an anonymous token session with no read rights
 * on estimates — and never throws; a sign-off must not fail over an email.
 */
export async function sendSignedReportEmail(db: SupabaseClient, customerToken: string, origin: string) {
  try {
    const { data: s } = await db.from("wo_signoff")
      .select("work_order_id, signed_name, signed_kind")
      .eq("customer_token", customerToken).maybeSingle();
    if (!s?.work_order_id) return;

    const { data: setting } = await db.from("settings").select("value").eq("key", "wo_loop").maybeSingle();
    if (!shouldSendSignEmail(setting?.value, String(s.signed_kind ?? ""))) return;

    const { data: wo } = await db.from("work_orders")
      .select("wo_snapshot, estimates(builder_state, accepted_name)")
      .eq("id", s.work_order_id).maybeSingle();
    const est = (wo as { estimates?: { builder_state?: unknown; accepted_name?: string | null } } | null)?.estimates;
    const contact = (est?.builder_state as { contact?: { email?: string; first_name?: string } } | null)?.contact;
    const email = contact?.email?.trim();
    if (!email) return;   // no address on file — nothing to send, not an error

    const snap = (wo as { wo_snapshot?: { jobTitle?: string; company?: { name?: string } } } | null)?.wo_snapshot;
    const { data: companyRow } = await db
      .from("settings").select("value").eq("key", "company_profile").maybeSingle();
    const company = (companyRow?.value ?? {}) as { phone?: string; logoUrl?: string; logoUrlLight?: string };
    const msg = signedReportEmail({
      firstName: contact?.first_name ?? (est?.accepted_name ?? "").trim().split(/\s+/)[0] ?? "",
      jobTitle: snap?.jobTitle || "your painting job",
      signedName: String(s.signed_name ?? ""),
      link: `${origin}/s/${customerToken}`,
      company: snap?.company?.name || "Paint Group",
      logoUrl: company.logoUrlLight || company.logoUrl,
      companyPhone: company.phone,
    });
    const result = await sendEmail({ to: email, subject: msg.subject, html: msg.html });
    if (result.status === "error") reportError(new Error(result.message), { where: "signEmail.send" });
  } catch (e) {
    reportError(e, { where: "signEmail" });
  }
}
