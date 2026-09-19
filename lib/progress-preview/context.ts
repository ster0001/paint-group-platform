/**
 * What the live-progress phone needs beyond the sent snapshot, read
 * server-side by share token (brief v4 §4, F1, F5):
 *
 *   · the messaging set — trade account → commercial, everything else residential
 *   · the account's name (the commercial header's organisation)
 *   · the property's references (PO, Owner…) — the same rows the document prints
 *   · the Demo painter from Settings → Website
 *
 * None of these are in the customer snapshot and `settings` / `accounts` are
 * staff-only under RLS, so this reads through the service client the way
 * page.tsx already reads the bank details. Every read reports its error;
 * a failed read degrades the phone (residential, no painter, no references)
 * rather than the page.
 */
import "server-only";
import { createServiceClient } from "@/lib/supabase/service";
import { reportIfError } from "@/lib/monitoring/report";
import { WEBSITE_CONTENT_KEY, demoPainterFor, parseWebsiteContent } from "@/lib/marketing/siteContent";
import { messagingSetFor, type DemoPainter, type MessagingSet } from "./build";

export type ProgressContext = {
  /** F9: wizard self-built estimates never show the phone, presentation or not. */
  eligible: boolean;
  set: MessagingSet;
  organisationName: string | null;
  references: Array<{ label: string; value: string }> | null;
  demoPainter: DemoPainter;
};

export const EMPTY_CONTEXT: ProgressContext = { eligible: false, set: "residential", organisationName: null, references: null, demoPainter: null };

type EstimateRow = { source: string | null; account_id: string | null; property_id: string | null; accounts: { name: string | null; account_type: string | null } | null };

/** Pure: rows → context. Unit-tested; the loader below only fetches. */
export function contextFromRows(
  est: EstimateRow | null,
  references: Array<{ label: string; value: string }> | null,
  websiteContent: unknown,
): ProgressContext {
  const acct = est?.accounts ?? null;
  return {
    eligible: !!est && est.source !== "wizard",
    set: messagingSetFor(acct?.account_type ?? null),
    organisationName: acct?.name?.trim() || null,
    references: references && references.length ? references : null,
    demoPainter: demoPainterFor(parseWebsiteContent(websiteContent)),
  };
}

export async function loadProgressContext(shareToken: string): Promise<ProgressContext> {
  const svc = createServiceClient();
  if (!svc) return EMPTY_CONTEXT;

  const estRes = await svc.from("estimates")
    .select("source, account_id, property_id, accounts(name, account_type)")
    .eq("share_token", shareToken).maybeSingle();
  reportIfError(estRes, { where: "progressPreview.context.estimate", bestEffort: true });
  const est = (estRes.data ?? null) as EstimateRow | null;

  const [refsRes, settingsRes] = await Promise.all([
    est?.property_id
      ? svc.from("property_references").select("label, value").eq("property_id", est.property_id).order("sort")
      : Promise.resolve({ data: null, error: null }),
    svc.from("settings").select("value").eq("key", WEBSITE_CONTENT_KEY).maybeSingle(),
  ]);
  reportIfError(refsRes, { where: "progressPreview.context.references", bestEffort: true });
  reportIfError(settingsRes, { where: "progressPreview.context.settings", bestEffort: true });

  return contextFromRows(
    est,
    (refsRes.data as Array<{ label: string; value: string }> | null) ?? null,
    (settingsRes.data as { value: unknown } | null)?.value ?? null,
  );
}
