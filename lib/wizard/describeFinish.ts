import type { SupabaseClient } from "@supabase/supabase-js";
import { ensureAccountAndProperty } from "@/lib/accounts/link";
import { isTestEmail } from "@/lib/accounts/identity";
import { sendMagicLink } from "@/lib/portal/auth";
import { automationOn, renderTemplate } from "@/lib/messaging/config";
import { loadMessaging } from "@/lib/messaging/load";
import { reportError } from "@/lib/monitoring/report";

/**
 * The customer-side finish for a DESCRIBED estimate (Tom, 7 Sep 2026).
 *
 * The form path's submit route does all of this after it builds; the
 * describe path builds through the assistant instead, so the same steps
 * live here and run once the tree exists:
 *   · the estimate's name is the street line (never "Estimate in progress"),
 *     and the builder's Job Address / Contact cards are filled;
 *   · the account + property are found-or-created by email and the estimate
 *     joins the chain (membership still waits for the magic link — 3a-1);
 *   · a wizard_leads row, so the funnel and the visitor cap see the run;
 *   · the open wizard_drafts session is converted (it is no longer a drop-out);
 *   · the "Your estimate is saved" sign-in link, landing IN the editor.
 * Every step is best-effort: a hiccup here never costs a customer their estimate.
 */

export type DescribeContact = { name: string; email: string; phone: string };
export type DescribeAddress = { street: string; suburb: string; state: string; postcode: string; formatted: string } | null;

export async function finishDescribedEstimate(db: SupabaseClient, input: {
  estimateId: string;
  userId: string;
  verifiedEmail: string | null;
  contact: DescribeContact;
  address: DescribeAddress;
  suburb: string;
  postcode: string;
  ipHash: string | null;
}): Promise<void> {
  const { estimateId, userId, contact, address } = input;
  const email = (input.verifiedEmail ?? contact.email).trim().toLowerCase();

  // 1. Name + the builder's cards, merged into the built state.
  try {
    const { data: row } = await db.from("estimates").select("builder_state").eq("id", estimateId).maybeSingle();
    const state = ((row?.builder_state ?? {}) as Record<string, unknown>);
    const streetLine = address?.street.trim() || address?.formatted.split(",")[0]?.trim() || "";
    const title = streetLine || [input.suburb, input.postcode].filter(Boolean).join(" ") || "Customer enquiry";
    const next = {
      ...state,
      contact: { name: contact.name.trim(), email, phone: contact.phone.trim() },
      ...(address ? { jobAddress: { address: address.street, city: address.suburb, state: address.state, postal: address.postcode } } : {}),
    };
    const { error } = await db.from("estimates").update({ title, builder_state: next }).eq("id", estimateId);
    if (error) reportError(error, { where: "describe.finish.title", bestEffort: true });
  } catch (e) { reportError(e, { where: "describe.finish.title", bestEffort: true }); }

  // 2. The lead row.
  await db.from("wizard_leads").insert({
    user_id: userId, estimate_id: estimateId, email, ip_hash: input.ipHash,
    suburb: input.suburb || null, postcode: input.postcode || null,
    job_type: "interior", outcome: "walkthrough_only", reasons: ["described"],
  }).then((r) => { if (r.error) reportError(r.error, { where: "describe.finish.lead", bestEffort: true }); });

  // 3. Account + property, and the estimate joins the chain.
  let accountId: string | null = null;
  try {
    const linked = await ensureAccountAndProperty(db, {
      email,
      name: contact.name.trim() || null,
      phone: contact.phone.trim() || null,
      address: address ? { street: address.street, suburb: address.suburb, state: address.state, postcode: address.postcode } : undefined,
    });
    accountId = linked.accountId;
    if (linked.accountId) {
      const link = await db.from("estimates").update({ account_id: linked.accountId, property_id: linked.propertyId }).eq("id", estimateId);
      if (link.error) reportError(link.error, { where: "describe.finish.link", bestEffort: true });
    }
  } catch (e) { reportError(e, { where: "describe.finish.account", bestEffort: true }); }

  // 4. The wizard session is finished, not dropped.
  await db.from("wizard_drafts")
    .update({ converted_at: new Date().toISOString(), estimate_id: estimateId, ...(accountId ? { account_id: accountId } : {}), email, name: contact.name.trim() || null, phone: contact.phone.trim() || null })
    .eq("user_id", userId)
    .is("converted_at", null)
    .then((r) => { if (r.error) reportError(r.error, { where: "describe.finish.draftConvert", bestEffort: true }); });

  // 5. The way back in: the sign-in link lands in the editor.
  try {
    const { messaging, company } = await loadMessaging(db);
    if (!isTestEmail(email) && !input.verifiedEmail && automationOn(messaging, "wizard_saved_link")) {
      const vars = { company_name: company.name || "Paint Group", next_step: "Come back any time to look it over or pick things up where you left off." };
      await sendMagicLink({
        email,
        next: `/estimate/scope?id=${estimateId}`,
        subject: renderTemplate(messaging.wizardSavedSubject, vars),
        intro: renderTemplate(messaging.wizardSavedBody, vars),
        buttonLabel: "Open my estimate",
      });
    }
  } catch (e) { reportError(e, { where: "describe.finish.savedEmail", bestEffort: true }); }
}
