/**
 * Trade portal v2 · Session 5 — the approval strip's decision logic (brief
 * §5.4 + Tom's rulings 31 Aug). Pure: the page fetches, this decides, the
 * component renders. Never role-inferred — the caller passes the viewer's
 * role and the account's fields explicitly.
 *
 *   ⚑1 real_estate approves on the owner's behalf unless the account says
 *      otherwise; above owner_referral_threshold_cents, sending to the
 *      owner is the ONLY path offered.
 *   ⚑2 limits are ADVISORY: over-limit shows a warning and needs an
 *      explicit "Approve anyway"; viewers have no approve action at all
 *      (finance neither — money-only role).
 *   ⚑5 facilities are prompted for a PO at approve (optional there;
 *      required at final-invoice issue, which is invoicing's gate).
 */

export type TradeRole = "owner" | "member" | "admin" | "approver" | "viewer" | "finance";

export type ApprovalAccount = {
  orgKind: string | null;
  canApproveForOwner: boolean | null; // NULL = derive from orgKind
  ownerReferralThresholdCents: number | null;
  paymentTermsDays: number | null; // NULL = settings default
};

export type ApprovalStrip = {
  /** The viewer may approve in-portal (before any limit warning). */
  canApprove: boolean;
  /** Why not, when canApprove is false and sending is still offered. */
  referredToOwner: boolean;
  approveLabel: string;
  /** Advisory (⚑2): present when the total exceeds the viewer's limit. */
  overLimit: { limitCents: number; totalCents: number } | null;
  sendLabel: string;
  /** Who the external link goes to, for copy ("owner" / "colleague" / "assessor"). */
  externalParty: string;
  showPoPrompt: boolean;
  termsDays: number;
};

export function effectiveCanApproveForOwner(a: ApprovalAccount): boolean {
  return a.canApproveForOwner ?? a.orgKind === "real_estate";
}

export function effectivePoRequiredToInvoice(orgKind: string | null, value: boolean | null): boolean {
  return value ?? orgKind === "facilities";
}

export function approvalStrip(input: {
  role: TradeRole;
  account: ApprovalAccount;
  approvalLimitCents: number | null;
  totalCents: number;
  settingsTermsDays: number;
}): ApprovalStrip {
  const { role, account, approvalLimitCents, totalCents } = input;
  const orgKind = account.orgKind;

  const externalParty = orgKind === "real_estate" ? "owner"
    : orgKind === "insurance" ? "assessor"
    : "colleague";
  const sendLabel = `Send to ${orgKind === "real_estate" ? "the owner" : orgKind === "insurance" ? "the assessor" : "a colleague"} to approve`;

  // ⚑2 hard rule: viewers never approve; finance is money-only.
  const roleMayApprove = role === "owner" || role === "admin" || role === "approver" || role === "member";

  // ⚑1: an agency that may not act for the owner — or a total above the
  // referral threshold — offers ONLY the send path.
  const threshold = account.ownerReferralThresholdCents;
  const referredToOwner = orgKind === "real_estate"
    && (!effectiveCanApproveForOwner(account) || (threshold != null && totalCents > threshold));

  const canApprove = roleMayApprove && !referredToOwner;

  const overLimit = canApprove && approvalLimitCents != null && totalCents > approvalLimitCents
    ? { limitCents: approvalLimitCents, totalCents }
    : null;

  const approveLabel = orgKind === "real_estate" ? "Approve on behalf of the owner"
    : orgKind === "insurance" ? "Approve against the claim"
    : orgKind === "facilities" ? "Approve with PO number"
    : "Approve this estimate";

  return {
    canApprove,
    referredToOwner,
    approveLabel,
    overLimit,
    sendLabel,
    externalParty,
    showPoPrompt: orgKind === "facilities",
    termsDays: account.paymentTermsDays ?? input.settingsTermsDays,
  };
}
