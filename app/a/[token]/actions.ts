"use server";

import { z } from "zod";
import { createServiceClient } from "@/lib/supabase/service";
import { acceptViaToken } from "@/lib/portal/approvalData";
import { isTestEmail } from "@/lib/accounts/identity";
import { sendEmail } from "@/lib/messaging/send";
import { melbourneTodayYmd } from "@/lib/portal/data";

export type DecideResult = { ok: true; decision: "approved" | "declined" } | { ok: false; message: string };

type ApprovalRow = {
  id: string;
  estimate_id: string;
  sent_by_profile_id: string;
  approver_name: string;
  decided_at: string | null;
  expires_on: string | null;
  estimates: { id: string; title: string | null; status: string; share_token: string | null } | null;
};

async function loadApproval(token: string) {
  const svc = createServiceClient();
  if (!svc) return null;
  const { data } = await svc.from("external_approvals")
    .select("id, estimate_id, sent_by_profile_id, approver_name, decided_at, expires_on, estimates(id, title, status, share_token)")
    .eq("token", token).maybeSingle();
  if (!data) return null;
  const row = data as unknown as Omit<ApprovalRow, "estimates"> & { estimates: ApprovalRow["estimates"] | ApprovalRow["estimates"][] };
  return { svc, row: { ...row, estimates: Array.isArray(row.estimates) ? row.estimates[0] ?? null : row.estimates } as ApprovalRow };
}

const decideInput = z.object({
  token: z.string().min(24).max(200),
  decision: z.enum(["approved", "declined"]),
  signerName: z.string().trim().min(1).max(120),
  note: z.string().trim().max(2000).default(""),
});

/**
 * The external approver's decision (brief §5.5). Approve runs the SAME
 * accept_estimate path as every other acceptance; the decision lands on
 * external_approvals (the timeline reads it), and the sender is notified.
 */
export async function decideExternalApproval(raw: unknown): Promise<DecideResult> {
  const parsed = decideInput.safeParse(raw);
  if (!parsed.success) return { ok: false, message: "Type your full name to sign." };
  const loaded = await loadApproval(parsed.data.token);
  if (!loaded) return { ok: false, message: "This link isn't valid." };
  const { svc, row } = loaded;
  const estimate = row.estimates;
  if (!estimate) return { ok: false, message: "This link isn't valid." };
  if (row.decided_at) return { ok: false, message: "A decision has already been recorded on this link." };
  if (row.expires_on && row.expires_on < melbourneTodayYmd()) {
    return { ok: false, message: "This link has expired — ask for a fresh one." };
  }

  if (parsed.data.decision === "approved") {
    if (!estimate.share_token) return { ok: false, message: "This estimate can't be approved right now." };
    const result = await acceptViaToken(estimate.share_token, parsed.data.signerName);
    if (result !== "ok" && result !== "already") {
      return { ok: false, message: result === "not_sent" ? "This estimate isn't open for a decision any more." : "Couldn't record that just now — try again." };
    }
  }

  const { error } = await svc.from("external_approvals").update({
    decided_at: new Date().toISOString(),
    decision: parsed.data.decision,
    signer_name: parsed.data.signerName,
    decision_note: parsed.data.note,
  }).eq("id", row.id).is("decided_at", null);
  if (error) return { ok: false, message: "Couldn't record that just now — try again." };

  // Notify the sender — best-effort, never blocking the decision.
  try {
    const { data: sender } = await svc.auth.admin.getUserById(row.sent_by_profile_id);
    const to = sender?.user?.email;
    if (to && !isTestEmail(to)) {
      const title = estimate.title?.trim() || "the estimate";
      await sendEmail({
        to,
        subject: parsed.data.decision === "approved"
          ? `${row.approver_name} approved ${title}`
          : `${row.approver_name} declined ${title}`,
        html: [
          `<p>${escapeHtml(row.approver_name)} has ${parsed.data.decision} <b>${escapeHtml(title)}</b>${parsed.data.decision === "approved" ? ` — signed ${escapeHtml(parsed.data.signerName)}` : ""}.</p>`,
          parsed.data.note ? `<p>Their note: ${escapeHtml(parsed.data.note)}</p>` : "",
          `<p>It's on the property's timeline in your Paint Group workspace.</p>`,
        ].join("\n"),
      });
    }
  } catch { /* deliberate — the decision stands */ }
  return { ok: true, decision: parsed.data.decision };
}

const askInput = z.object({
  token: z.string().min(24).max(200),
  body: z.string().trim().min(1).max(2000),
});

/** "Ask a question" — lands on the estimate's own message thread. */
export async function askExternalQuestion(raw: unknown): Promise<{ ok: boolean; message?: string }> {
  const parsed = askInput.safeParse(raw);
  if (!parsed.success) return { ok: false, message: "Type your question first." };
  const loaded = await loadApproval(parsed.data.token);
  if (!loaded || !loaded.row.estimates) return { ok: false, message: "This link isn't valid." };
  const { svc, row } = loaded;
  const { error } = await svc.from("estimate_messages").insert({
    estimate_id: row.estimate_id, direction: "customer",
    body: `${row.approver_name} (approver): ${parsed.data.body}`,
  });
  if (error) return { ok: false, message: "Couldn't send that just now." };
  return { ok: true };
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}
