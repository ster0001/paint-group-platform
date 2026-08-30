/**
 * Trade portal v2 · Session 5 — server data + shared execution for the
 * approval flows. Two callers: the in-portal action strip and the external
 * token link. Both end in the SAME accept_estimate RPC the /e page uses —
 * acceptance → WO → deposit-invoice draft, no new money code (brief rule).
 */
import { createServiceClient } from "@/lib/supabase/service";
import { approvalStrip, type ApprovalAccount, type ApprovalStrip, type TradeRole } from "./approvals";
import type { PortalContext } from "./data";

export type ApprovalEstimate = {
  id: string;
  title: string;
  status: string;
  totalCents: number;
  shareToken: string | null;
  accountId: string;
  propertyId: string | null;
  validUntil: string | null;
};

export type ApprovalScreen = {
  estimate: ApprovalEstimate;
  address: string | null;
  references: Array<{ label: string; value: string }>;
  role: TradeRole;
  strip: ApprovalStrip;
  hasAppliedColours: boolean;
  /** An undecided external approval already out with someone. */
  pendingExternal: { approverName: string; sentAt: string } | null;
};

export async function settingsTermsDays(): Promise<number> {
  const svc = createServiceClient();
  if (!svc) return 14;
  const { data } = await svc.from("settings").select("value").eq("key", "trade_terms").maybeSingle();
  const days = (data?.value as { days?: number } | null)?.days;
  return typeof days === "number" && days > 0 ? days : 14;
}

/** The viewer's role + limit on the estimate's account — explicit, never inferred. */
export async function roleForAccount(userId: string, accountId: string): Promise<{ role: TradeRole; approvalLimitCents: number | null } | null> {
  const svc = createServiceClient();
  if (!svc) return null;
  const { data } = await svc.from("account_users")
    .select("role, approval_limit_cents").eq("account_id", accountId).eq("profile_id", userId).maybeSingle();
  if (!data) return null;
  return {
    role: (data.role as TradeRole) ?? "member",
    approvalLimitCents: (data.approval_limit_cents as number | null) ?? null,
  };
}

export async function getApprovalEstimate(ctx: PortalContext, estimateId: string): Promise<ApprovalEstimate | null> {
  const svc = createServiceClient();
  if (!svc) return null;
  const { data } = await svc.from("estimates")
    .select("id, title, status, total_cents, share_token, account_id, property_id, valid_until")
    .eq("id", estimateId).maybeSingle();
  if (!data) return null;
  const accountIds = new Set(ctx.accounts.map((a) => a.id));
  if (!accountIds.has(data.account_id as string)) return null; // scope: 404 upstream
  return {
    id: data.id as string,
    title: (data.title as string | null)?.trim() || "Painting works",
    status: data.status as string,
    totalCents: (data.total_cents as number | null) ?? 0,
    shareToken: (data.share_token as string | null) ?? null,
    accountId: data.account_id as string,
    propertyId: (data.property_id as string | null) ?? null,
    validUntil: (data.valid_until as string | null) ?? null,
  };
}

export async function accountApprovalFields(accountId: string): Promise<ApprovalAccount & { poRequiredToInvoice: boolean | null }> {
  const svc = createServiceClient();
  const fallback = { orgKind: null, canApproveForOwner: null, ownerReferralThresholdCents: null, paymentTermsDays: null, poRequiredToInvoice: null };
  if (!svc) return fallback;
  const { data } = await svc.from("accounts")
    .select("org_kind, can_approve_for_owner, owner_referral_threshold_cents, payment_terms_days, po_required_to_invoice")
    .eq("id", accountId).maybeSingle();
  if (!data) return fallback;
  return {
    orgKind: (data.org_kind as string | null) ?? null,
    canApproveForOwner: (data.can_approve_for_owner as boolean | null) ?? null,
    ownerReferralThresholdCents: (data.owner_referral_threshold_cents as number | null) ?? null,
    paymentTermsDays: (data.payment_terms_days as number | null) ?? null,
    poRequiredToInvoice: (data.po_required_to_invoice as boolean | null) ?? null,
  };
}

export async function getApprovalScreen(ctx: PortalContext, estimateId: string): Promise<ApprovalScreen | null> {
  const svc = createServiceClient();
  if (!svc) return null;
  const estimate = await getApprovalEstimate(ctx, estimateId);
  if (!estimate) return null;
  const membership = await roleForAccount(ctx.userId, estimate.accountId);
  if (!membership) return null;

  const [account, terms, refsRes, coloursRes, pendingRes] = await Promise.all([
    accountApprovalFields(estimate.accountId),
    settingsTermsDays(),
    estimate.propertyId
      ? svc.from("property_references").select("label, value").eq("property_id", estimate.propertyId).order("sort")
      : Promise.resolve({ data: [] }),
    estimate.propertyId
      ? svc.from("colour_records").select("id").eq("property_id", estimate.propertyId).eq("status", "applied").limit(1)
      : Promise.resolve({ data: [] }),
    svc.from("external_approvals").select("approver_name, sent_at")
      .eq("estimate_id", estimateId).is("decided_at", null)
      .order("sent_at", { ascending: false }).limit(1),
  ]);

  const property = ctx.properties.find((p) => p.id === estimate.propertyId);
  const pending = ((pendingRes.data ?? []) as Array<{ approver_name: string; sent_at: string }>)[0];
  return {
    estimate,
    address: property ? [property.address, property.suburb].filter(Boolean).join(", ") : null,
    references: (refsRes.data ?? []) as Array<{ label: string; value: string }>,
    role: membership.role,
    strip: approvalStrip({
      role: membership.role,
      account,
      approvalLimitCents: membership.approvalLimitCents,
      totalCents: estimate.totalCents,
      settingsTermsDays: terms,
    }),
    hasAppliedColours: ((coloursRes.data ?? []) as unknown[]).length > 0,
    pendingExternal: pending ? { approverName: pending.approver_name, sentAt: pending.sent_at } : null,
  };
}

/**
 * The one acceptance path (both approve flows end here): the same RPC the
 * customer page calls — server-derived totals, WO + deposit draft inside.
 */
export async function acceptViaToken(shareToken: string, signerName: string): Promise<"ok" | "already" | string> {
  const svc = createServiceClient();
  if (!svc) return "error:no_service";
  const { data, error } = await svc.rpc("accept_estimate", {
    p_token: shareToken, p_name: signerName, p_options: [], p_total_cents: 0, p_deposit_cents: 0,
  });
  if (error) return `error:${error.message}`;
  const s = String(data ?? "");
  return s === "accepted" ? "ok" : s; // 'already' | 'not_sent' | 'not_found' pass through
}

/** Store the PO as the property's reference — it prints wherever references print (⚑5). */
export async function upsertPoReference(propertyId: string, po: string): Promise<void> {
  const svc = createServiceClient();
  if (!svc) return;
  const { data } = await svc.from("property_references")
    .select("id").eq("property_id", propertyId).eq("label", "PO").maybeSingle();
  if (data) await svc.from("property_references").update({ value: po, updated_at: new Date().toISOString() }).eq("id", data.id);
  else await svc.from("property_references").insert({ property_id: propertyId, label: "PO", value: po, sort: 10 });
}

/** "Owner · T. & M. Nguyen · PO · BAC-0712" — for any document renderer. */
export async function referencesLineForEstimateToken(shareToken: string): Promise<string | null> {
  const svc = createServiceClient();
  if (!svc) return null;
  const { data: est } = await svc.from("estimates").select("property_id").eq("share_token", shareToken).maybeSingle();
  const propertyId = (est?.property_id as string | null) ?? null;
  if (!propertyId) return null;
  const { data } = await svc.from("property_references")
    .select("label, value").eq("property_id", propertyId).order("sort");
  const refs = (data ?? []) as Array<{ label: string; value: string }>;
  return refs.length ? refs.map((r) => `${r.label} · ${r.value}`).join("  ·  ") : null;
}

/** ⚑2's record: the advisory over-limit approval lands on the job timeline. */
export async function recordOverLimitApproval(estimateId: string, meta: {
  limitCents: number; totalCents: number; by: string; role: string;
}): Promise<void> {
  const svc = createServiceClient();
  if (!svc) return;
  const { data: wo } = await svc.from("work_orders")
    .select("id").eq("estimate_id", estimateId).order("issued_at", { ascending: false }).limit(1).maybeSingle();
  if (!wo) return;
  await svc.from("wo_events").insert({
    work_order_id: wo.id, type: "approved_over_limit", actor: null, actor_kind: "customer", meta,
  });
}
