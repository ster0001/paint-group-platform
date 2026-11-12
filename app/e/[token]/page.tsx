import type React from "react";
import { companyForBrand } from "@/lib/messaging/brand";
import { estimateBrandByToken } from "@/lib/estimate/brandByToken";
import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import type { BankDetails, CustomerSnapshot } from "@/lib/customer/snapshot";
import { createServiceClient } from "@/lib/supabase/service";
import CustomerEstimate, { type CustomerChanges, type EstimateRow } from "./CustomerEstimate";
import ProgressSection from "./ProgressSection";
import LeadRange from "./LeadRange";
import { parseLeadSnapshot } from "@/lib/estimate/leadSnapshot";
import { loadProgressContext } from "@/lib/progress-preview/context";
import { toEstimateSignature, type EstimateSignature } from "@/lib/estimate/signature";
import { reportError } from "@/lib/monitoring/report";

export const dynamic = "force-dynamic";

// Public, token-only. Fetches the SENT snapshot via a security-definer RPC —
// the anon key never gets a `select * from estimates` path, and only the
// customer-safe snapshot is ever returned.
export default async function Page({
  params,
  searchParams,
}: {
  params: Promise<{ token: string }>;
  searchParams: Promise<{ portal?: string }>;
}) {
  const { token } = await params;
  const { portal } = await searchParams;
  const supabase = await createClient();

  const { data, error } = await supabase.rpc("get_estimate_by_token", { p_token: token });
  const row = (Array.isArray(data) ? data[0] : data) as EstimateRow | undefined;

  // Automations A‑F: no SENT estimate on this token — a lead's page, when the
  // wizard kept their range as a snapshot. Anything else is still a 404.
  if (!error && !row) return renderLead(supabase, token);
  if (error || !row || !row.snapshot) notFound();
  // extra guard: never render anything that isn't a valid customer snapshot
  const snap0 = row.snapshot as Partial<CustomerSnapshot>;
  if (!snap0 || snap0.version !== 1) notFound();
  // Paint Home brief §5 (⚑ P8): a Paint Home estimate shows Paint Home's name, mark and number in
  // the document chrome. The snapshot is the sent record and is not rewritten; the brand is laid
  // over its company block at render, from the estimate's own column (one service read by token).
  const estimateBrand = await estimateBrandByToken(token);
  const brandCo = companyForBrand({ name: snap0.company?.name ?? "", phone: snap0.company?.phone ?? "", logoUrl: snap0.company?.logoUrl ?? "", logoUrlLight: snap0.company?.logoUrlLight ?? "" }, estimateBrand);
  // Tom, 25 Oct 2026: the card prefers `logoUrlLight` (EstimateHeader), so the overlay must replace THAT too —
  // otherwise the snapshot's Paint Group light logo won over the Paint Home mark.
  const snap: Partial<CustomerSnapshot> = estimateBrand === "painthome" && snap0.company
    ? { ...snap0, company: { ...snap0.company, name: brandCo.name ?? snap0.company.name, phone: brandCo.phone ?? snap0.company.phone, logoUrl: brandCo.logoUrl ?? snap0.company.logoUrl, logoUrlLight: brandCo.logoUrlLight ?? snap0.company.logoUrlLight } }
    : snap0;

  // Signed changes + adjusted total (accepted jobs; null before the 20261120
  // migration or when there's nothing to show — the page degrades quietly).
  let changes: CustomerChanges | null = null;
  // Tom, 11 Nov 2026: the signed estimate prints the customer's signature. A
  // failed read prints the estimate with blank lines (and is reported), never a 500.
  let signature: EstimateSignature | null = null;
  if (row.status === "accepted") {
    const { data: sig, error: sigError } = await supabase.rpc("estimate_signature_by_token", { p_token: token });
    if (sigError) reportError(sigError, { where: "estimate.signature.read", bestEffort: true });
    else signature = toEstimateSignature(sig as { signature?: unknown; name?: unknown; at?: unknown } | null);
    const { data: ch } = await supabase.rpc("estimate_changes_by_token", { p_token: token });
    if (ch && typeof ch === "object" && Array.isArray((ch as CustomerChanges).variations)) {
      changes = ch as CustomerChanges;
    }
  }

  // Trade portal v2 §5.4: the property's references print on the document.
  const { referencesLineForEstimateToken } = await import("@/lib/portal/approvalData");
  const referencesLine = await referencesLineForEstimateToken(token).catch(() => null);

  // Tom, 18 Sep: the company's bank details print on the PDF with the ABN.
  // `settings` is staff-only under RLS, so the server reads this ONE row
  // through the service client — the same row every issued invoice shows the
  // customer. A failed read prints the quote without the block, never a 500.
  const bank = await loadBankDetails();

  // Live-progress phone (brief v4): decided HERE, server-side — an estimate
  // with no presentation attached gets no section, no markup, no script.
  // Tom's F9: staff-sent estimates only — a wizard self-built one never shows it.
  const hasPresentation = (snap.presentation?.blocks?.length ?? 0) > 0;
  let progressPreview: React.ReactNode = null;
  let progressSet: "residential" | "commercial" | null = null;
  if (hasPresentation) {
    const ctx = await loadProgressContext(token);
    if (ctx.eligible) progressSet = ctx.set;
    if (ctx.eligible) progressPreview = <ProgressSection token={token} snapshot={row.snapshot} set={ctx.set} demoPainter={ctx.demoPainter} organisationName={ctx.organisationName} references={ctx.references} />;
  }

  return (
    <CustomerEstimate
      snapshot={snap as CustomerSnapshot}
      estimateNumber={row.number ?? null}
      bank={bank}
      token={token}
      status={row.status}
      acceptedName={row.accepted_name}
      validUntil={row.valid_until}
      sentAt={row.sent_at}
      selectedOptionsInit={row.selected_options}
      changes={changes}
      fromPortal={portal === "1"}
      referencesLine={referencesLine}
      progressPreview={progressPreview}
      progressPreviewSet={progressSet}
      signature={signature}
    />
  );
}

async function renderLead(supabase: Awaited<ReturnType<typeof createClient>>, token: string) {
  const { data, error } = await supabase.rpc("get_lead_by_token", { p_token: token });
  if (error) reportError(error, { where: "lead.byToken" });
  const lead = (Array.isArray(data) ? data[0] : data) as { snapshot?: unknown } | undefined;
  const snapshot = parseLeadSnapshot(lead?.snapshot);
  if (error || !snapshot) notFound();
  const brand = await estimateBrandByToken(token);
  const co = companyForBrand(await loadLeadCompany(), brand);
  return <LeadRange snapshot={snapshot} token={token} company={{ name: co.name, phone: co.phone, logoUrl: co.logoUrlLight || co.logoUrl }} />;
}

/** The company block for a lead's page (`settings` is staff-only: one service read of the one row). Falls back to the name alone. */
async function loadLeadCompany(): Promise<{ name: string; phone: string; logoUrl: string; logoUrlLight: string }> {
  const fallback = { name: "Paint Group", phone: "", logoUrl: "", logoUrlLight: "" };
  const service = createServiceClient();
  if (!service) return fallback;
  const { data, error } = await service.from("settings").select("value").eq("key", "company_profile").maybeSingle();
  if (error) { reportError(error, { where: "lead.company", bestEffort: true }); return fallback; }
  const v = ((data as { value?: Record<string, unknown> } | null)?.value ?? {}) as Record<string, unknown>;
  const str = (k: string) => (typeof v[k] === "string" ? (v[k] as string).trim() : "");
  return { name: str("name") || fallback.name, phone: str("phone"), logoUrl: str("logoUrl"), logoUrlLight: str("logoUrlLight") };
}

async function loadBankDetails(): Promise<BankDetails | null> {
  const service = createServiceClient();
  if (!service) return null;
  const { data, error } = await service.from("settings").select("value").eq("key", "invoicing_bank").maybeSingle();
  if (error || !data) return null;
  const v = (data as { value: Record<string, unknown> }).value ?? {};
  const str = (k: string) => (typeof v[k] === "string" ? (v[k] as string).trim() : "");
  const bank = { accountName: str("accountName"), bank: str("bank"), bsb: str("bsb"), acc: str("acc") };
  return bank.accountName || bank.bsb || bank.acc ? bank : null;
}
