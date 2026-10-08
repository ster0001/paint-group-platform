/**
 * "Your change is approved" — the customer's confirmation (Tom, 8 Oct 2026:
 * "When a customer approves a variation, please can we send a notification via
 * email to confirm it has been approved").
 *
 * SERVER ONLY — service client: the signer is an anonymous token session with
 * no read rights on estimates or wo_events.
 *
 * Sent once per OFFER (one token = one offer since 20270192, so five changes
 * signed together are one email listing five). Fixed wording built from the
 * changes themselves, like the signature request it answers. It goes through
 * sendEmail — the one send path — so the CRM keeps a `messages` row whatever
 * happens, and the customer's own "job" alert switch applies (kind
 * `variation_approved` maps to it in lib/notifications/prefs.ts).
 *
 * The job's record (wo_events) says what it CAME TO, not that it was tried:
 *   variation_approval_confirmed            { offer_token, to, channels }
 *   variation_approval_confirmation_skipped { offer_token, reason }
 * Either one is the once-guard, so re-opening the link never sends twice.
 *
 * Not on Settings → Automations yet: the registry and the wording settings
 * (lib/automations/registry.ts, lib/messaging/config.ts) are being changed on
 * another branch. Moving this onto the dispatcher with an off switch is a
 * follow-up once that lands.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import { buildEstimateEmailHtml, sendEmail } from "@/lib/messaging/send";
import { loadMessaging } from "@/lib/messaging/load";
import { emailLogoUrl } from "@/lib/messaging/logo";
import { siteUrl } from "@/lib/invoicing/pdf";
import { reportError } from "@/lib/monitoring/report";

export type ApprovedChange = { comment: string; priceCents: number; credit: boolean };

export type ApprovalConfirmationOutcome =
  | { outcome: "sent"; to: string }
  | { outcome: "skipped"; reason: string }
  | { outcome: "already" }
  | { outcome: "not_applicable" };

const money = (cents: number) =>
  "$" + (Math.abs(cents) / 100).toLocaleString("en-AU", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

const melbourneDate = (iso: string) =>
  new Intl.DateTimeFormat("en-AU", { timeZone: "Australia/Melbourne", day: "numeric", month: "short", year: "numeric" })
    .format(new Date(iso));

/** The email itself — pure, so the wording is pinned by a unit test. */
export function variationApprovedEmail(vars: {
  firstName: string;
  changes: ApprovedChange[];
  signedName: string;
  signedAt: string | null;
  jobLabel: string;
  link: string;
  company: string;
  companyPhone?: string;
  logoUrl?: string;
}): { subject: string; html: string; intro: string } {
  const n = vars.changes.length;
  const net = vars.changes.reduce((s, c) => s + (c.credit ? -c.priceCents : c.priceCents), 0);
  const lines = vars.changes.map((c) => {
    const what = c.comment.trim() || "A change to the scope";
    const amount = c.priceCents === 0 ? "no change to the price" : c.credit ? `takes ${money(c.priceCents)} off` : `adds ${money(c.priceCents)}`;
    return `• ${what} — ${amount}`;
  });
  const totalLine = net === 0
    ? "Your job total stays where it was."
    : net > 0 ? `Your job total goes up by ${money(net)} (inc GST).` : `Your job total comes down by ${money(net)} (inc GST).`;
  const signed = vars.signedName.trim()
    ? `Approved by ${vars.signedName.trim()}${vars.signedAt ? ` on ${melbourneDate(vars.signedAt)}` : ""}.`
    : vars.signedAt ? `Approved on ${melbourneDate(vars.signedAt)}.` : "";
  const hello = vars.firstName.trim() ? `Hi ${vars.firstName.trim()},` : "Hello,";
  const intro =
    `${hello}\n\n` +
    `Thank you — this confirms you have approved ${n === 1 ? "the change" : `${n} changes`} to your painting job${vars.jobLabel ? ` at ${vars.jobLabel}` : ""}:\n\n` +
    `${lines.join("\n")}\n\n` +
    `${totalLine} ${signed}`.trim() + "\n\n" +
    `You can see what you approved at any time from the link below. If anything here doesn't look right, just reply to this email` +
    `${vars.companyPhone ? ` or call us on ${vars.companyPhone}` : ""}.`;
  return {
    subject: `${n === 1 ? "Your change is" : "Your changes are"} approved — ${vars.company}`,
    intro,
    html: buildEstimateEmailHtml({
      intro,
      link: vars.link,
      companyName: vars.company,
      logoUrl: vars.logoUrl,
      companyPhone: vars.companyPhone,
      buttonLabel: n === 1 ? "View the approved change" : "View the approved changes",
    }),
  };
}

type OfferRow = {
  id: string; status: string; comment: string; price_cents: number | null; credit: boolean;
  signed_name: string | null; signed_at: string | null; customer_responded_at: string | null;
  work_order_id: string;
  work_orders: {
    estimate_id: string | null; wo_snapshot: { jobAddress?: string; company?: { name?: string } } | null;
  } | null;
};

type EstimateRow = {
  id: string; account_id: string | null; title: string | null;
  builder_state: { contact?: { first_name?: string; email?: string; secondary_email?: string } } | null;
  sent_snapshot: { contactEmail?: string; contactName?: string; jobAddress?: string } | null;
};

/**
 * Called after the customer's approval lands. Never throws — an approval must
 * not fail over an email — and always leaves the outcome on the job's record.
 */
export async function sendVariationApprovedConfirmation(
  db: SupabaseClient, token: string,
): Promise<ApprovalConfirmationOutcome> {
  let workOrderId: string | null = null;
  const skip = async (reason: string): Promise<ApprovalConfirmationOutcome> => {
    if (workOrderId) {
      const { error } = await db.from("wo_events").insert({
        work_order_id: workOrderId, type: "variation_approval_confirmation_skipped", actor_kind: "system",
        meta: { offer_token: token, reason },
      });
      if (error) reportError(error, { where: "variationApprovedEmail.recordSkip" });
    }
    return { outcome: "skipped", reason };
  };
  try {
    const { data: rowsRaw, error: rowsErr } = await db.from("wo_variations")
      .select("id, status, comment, price_cents, credit, signed_name, signed_at, customer_responded_at, work_order_id, work_orders(estimate_id, wo_snapshot)")
      .eq("customer_token", token)
      .order("created_at", { ascending: true });
    if (rowsErr) throw rowsErr;
    const approved = ((rowsRaw ?? []) as unknown as OfferRow[])
      .filter((v) => v.customer_responded_at && ["customer_approved", "contractor_accepted"].includes(v.status));
    if (approved.length === 0) return { outcome: "not_applicable" };
    workOrderId = approved[0].work_order_id;

    // Once per offer: either outcome stands as the guard.
    const { data: seen, error: seenErr } = await db.from("wo_events").select("id")
      .eq("work_order_id", workOrderId)
      .in("type", ["variation_approval_confirmed", "variation_approval_confirmation_skipped"])
      .eq("meta->>offer_token", token).limit(1);
    if (seenErr) throw seenErr;
    if ((seen ?? []).length > 0) return { outcome: "already" };

    const wo = approved[0].work_orders;
    const estimateId = wo?.estimate_id ?? null;
    let est: EstimateRow | null = null;
    if (estimateId) {
      const { data, error } = await db.from("estimates")
        .select("id, account_id, title, builder_state, sent_snapshot").eq("id", estimateId).maybeSingle();
      if (error) throw error;
      est = data as EstimateRow | null;
    }
    // The builder's contact first, the sent snapshot's after — an office-entered
    // or imported job carries the address only on the snapshot.
    const contact = est?.builder_state?.contact;
    const email = (contact?.email || est?.sent_snapshot?.contactEmail || "").trim();
    if (!email) return await skip("No email address on the estimate's contact.");
    const second = (contact?.secondary_email ?? "").trim();
    const firstName = contact?.first_name || (est?.sent_snapshot?.contactName ?? "").trim().split(/\s+/)[0] || "";

    const { company } = await loadMessaging(db);
    const companyName = company.name || wo?.wo_snapshot?.company?.name || "Paint Group";
    const signer = approved.find((v) => v.signed_name)?.signed_name ?? "";
    const msg = variationApprovedEmail({
      firstName,
      changes: approved.map((v) => ({ comment: v.comment, priceCents: v.price_cents ?? 0, credit: v.credit })),
      signedName: signer,
      signedAt: approved[0].signed_at ?? approved[0].customer_responded_at,
      jobLabel: wo?.wo_snapshot?.jobAddress || est?.sent_snapshot?.jobAddress || "",
      link: `${siteUrl()}/v/${token}`,
      company: companyName,
      companyPhone: company.phone,
      logoUrl: emailLogoUrl(company),
    });

    const result = await sendEmail({
      to: second && second.toLowerCase() !== email.toLowerCase() ? [email, second] : email,
      subject: msg.subject,
      html: msg.html,
      replyTo: company.email || undefined,
      ctx: { accountId: est?.account_id ?? null, estimateId, workOrderId, kind: "variation_approved" },
    });
    if (result.status === "sent") {
      const { error } = await db.from("wo_events").insert({
        work_order_id: workOrderId, type: "variation_approval_confirmed", actor_kind: "system",
        meta: { offer_token: token, to: email, channels: ["email"], variation_ids: approved.map((v) => v.id) },
      });
      if (error) reportError(error, { where: "variationApprovedEmail.recordSent" });
      return { outcome: "sent", to: email };
    }
    if (result.status === "error") reportError(new Error(result.message), { where: "variationApprovedEmail.send" });
    return await skip(
      result.status === "not_configured" ? "Email isn't set up on this server — nothing went out."
        : result.status === "suppressed" ? result.message
        : `The email failed: ${result.message}`,
    );
  } catch (e) {
    reportError(e, { where: "variationApprovedEmail", extra: { workOrderId } });
    return await skip("Something went wrong sending it — the error monitor has it.");
  }
}
