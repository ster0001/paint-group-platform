import type React from "react";
import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import type { BankDetails, CustomerSnapshot } from "@/lib/customer/snapshot";
import { createServiceClient } from "@/lib/supabase/service";
import CustomerEstimate, { type CustomerChanges, type EstimateRow } from "./CustomerEstimate";
import ProgressSection from "./ProgressSection";
import { loadProgressContext } from "@/lib/progress-preview/context";

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

  if (error || !row || !row.snapshot) notFound();
  // extra guard: never render anything that isn't a valid customer snapshot
  const snap = row.snapshot as Partial<CustomerSnapshot>;
  if (!snap || snap.version !== 1) notFound();

  // Signed changes + adjusted total (accepted jobs; null before the 20261120
  // migration or when there's nothing to show — the page degrades quietly).
  let changes: CustomerChanges | null = null;
  if (row.status === "accepted") {
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
  if (hasPresentation) {
    const ctx = await loadProgressContext(token);
    if (ctx.eligible) progressPreview = <ProgressSection snapshot={row.snapshot} set={ctx.set} demoPainter={ctx.demoPainter} organisationName={ctx.organisationName} references={ctx.references} />;
  }

  return (
    <CustomerEstimate
      snapshot={row.snapshot}
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
    />
  );
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
