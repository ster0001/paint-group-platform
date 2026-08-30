"use server";

import { randomBytes } from "node:crypto";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { getPortalContext } from "@/lib/portal/data";
import { approvalStrip } from "@/lib/portal/approvals";
import {
  accountApprovalFields,
  acceptViaToken,
  getApprovalEstimate,
  recordOverLimitApproval,
  roleForAccount,
  settingsTermsDays,
  upsertPoReference,
} from "@/lib/portal/approvalData";
import { createServiceClient } from "@/lib/supabase/service";
import { isTestEmail } from "@/lib/accounts/identity";
import { sendEmail } from "@/lib/messaging/send";

export type ApproveResult =
  | { ok: true }
  | { ok: false; kind: "over_limit"; limitCents: number; totalCents: number }
  | { ok: false; kind: "refused" | "error"; message: string };

const approveInput = z.object({
  estimateId: z.string().uuid(),
  poNumber: z.string().trim().max(60).default(""),
  approveAnyway: z.boolean().default(false),
});

/**
 * In-portal approval (⚑1/⚑2/⚑5, 31 Aug). Every check re-runs SERVER-SIDE —
 * the strip the client saw is advice, not authority. Ends in the same
 * accept_estimate path as /e: WO + deposit-invoice draft, no new money code.
 */
export async function approveTradeEstimate(raw: unknown): Promise<ApproveResult> {
  const parsed = approveInput.safeParse(raw);
  if (!parsed.success) return { ok: false, kind: "error", message: "That didn't make sense — refresh and try again." };
  const ctx = await getPortalContext();
  if (!ctx) return { ok: false, kind: "refused", message: "Sign in first." };

  const estimate = await getApprovalEstimate(ctx, parsed.data.estimateId);
  if (!estimate || !estimate.shareToken) return { ok: false, kind: "error", message: "That estimate isn't available." };
  if (estimate.status !== "sent") return { ok: false, kind: "refused", message: "This estimate isn't open for a decision." };

  const membership = await roleForAccount(ctx.userId, estimate.accountId);
  if (!membership) return { ok: false, kind: "refused", message: "You're not set up on this account." };
  const strip = approvalStrip({
    role: membership.role,
    account: await accountApprovalFields(estimate.accountId),
    approvalLimitCents: membership.approvalLimitCents,
    totalCents: estimate.totalCents,
    settingsTermsDays: await settingsTermsDays(),
  });
  if (!strip.canApprove) {
    return {
      ok: false, kind: "refused",
      message: strip.referredToOwner
        ? "This one goes to the owner to approve — use the send button."
        : "Your access doesn't include approving estimates.",
    };
  }
  // ⚑2 advisory: the warning needs an explicit second tap, then it proceeds.
  if (strip.overLimit && !parsed.data.approveAnyway) {
    return { ok: false, kind: "over_limit", ...strip.overLimit };
  }

  const signerName = ctx.firstName?.trim() || ctx.email;
  const result = await acceptViaToken(estimate.shareToken, signerName);
  if (result !== "ok" && result !== "already") {
    return { ok: false, kind: "error", message: "Couldn't record the approval just now — try again." };
  }

  if (parsed.data.poNumber && estimate.propertyId) {
    await upsertPoReference(estimate.propertyId, parsed.data.poNumber);
  }
  if (strip.overLimit) {
    // ⚑2's record: on the job timeline, visible to the org's admins.
    await recordOverLimitApproval(estimate.id, {
      ...strip.overLimit, by: signerName, role: membership.role,
    }).catch(() => {});
  }
  revalidatePath("/account");
  return { ok: true };
}

export type SendExternalResult = { ok: true } | { ok: false; message: string };

const sendInput = z.object({
  estimateId: z.string().uuid(),
  approverName: z.string().trim().min(1).max(120),
  approverEmail: z.string().trim().email().max(200),
});

/** The external token link (⚑1/⚑6): owner / colleague / assessor. */
export async function sendExternalApproval(raw: unknown): Promise<SendExternalResult> {
  const parsed = sendInput.safeParse(raw);
  if (!parsed.success) return { ok: false, message: "Name and a valid email are needed." };
  const ctx = await getPortalContext();
  if (!ctx) return { ok: false, message: "Sign in first." };

  const estimate = await getApprovalEstimate(ctx, parsed.data.estimateId);
  if (!estimate) return { ok: false, message: "That estimate isn't available." };
  if (estimate.status !== "sent") return { ok: false, message: "This estimate isn't open for a decision." };
  const membership = await roleForAccount(ctx.userId, estimate.accountId);
  if (!membership || membership.role === "viewer" || membership.role === "finance") {
    return { ok: false, message: "Your access doesn't include sending approvals." };
  }

  const svc = createServiceClient();
  if (!svc) return { ok: false, message: "Try again shortly." };
  const token = randomBytes(24).toString("base64url");
  const { error } = await svc.from("external_approvals").insert({
    estimate_id: estimate.id,
    sent_by_profile_id: ctx.userId,
    approver_name: parsed.data.approverName,
    approver_email: parsed.data.approverEmail,
    token,
    expires_on: estimate.validUntil, // expiry = estimate validity (brief §5.5)
  });
  if (error) return { ok: false, message: "Couldn't send that just now." };

  if (!isTestEmail(parsed.data.approverEmail)) {
    const origin = process.env.NEXT_PUBLIC_SITE_URL ?? "http://localhost:3000";
    await sendEmail({
      to: parsed.data.approverEmail,
      subject: `An estimate for ${estimate.title} — your approval is needed`,
      html: [
        `<p>Hello ${parsed.data.approverName.split(/\s+/)[0]},</p>`,
        `<p>${signerLine(ctx.firstName, ctx.email)} has sent you a painting estimate to approve: <b>${escapeHtml(estimate.title)}</b>.</p>`,
        `<p><a href="${origin}/a/${token}">Review and decide here</a> — you can approve, decline, or ask a question. No account needed.</p>`,
        estimate.validUntil ? `<p>The estimate is valid until ${estimate.validUntil}.</p>` : "",
        `<p>Paint Group</p>`,
      ].join("\n"),
    }).catch(() => {});
  }
  revalidatePath("/account");
  return { ok: true };
}

function signerLine(firstName: string | null, email: string): string {
  return escapeHtml(firstName?.trim() || email);
}
function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}
