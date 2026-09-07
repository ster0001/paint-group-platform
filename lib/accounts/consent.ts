// SERVER ONLY — what a customer agreed to, and where (Tom, 7 Sep 2026, items 4 + 5).
//
// Two consents, both provenance written once per account per source:
//   project   — "you agree to receive communications relating to your project"
//               (the wizard request, the describe path, a portal estimate).
//   marketing — the accept small print: "we may send marketing communications;
//               every one has an opt-out". Also flips permit_email / permit_sms
//               to `allowed` — but ONLY from `unknown`: a customer who declined
//               earlier (unsubscribe link, STOP, the portal tick) stays declined.
//
// Always best-effort: a consent write must never cost a customer their
// estimate or their acceptance. Every write leaves a CRM event behind.

import type { SupabaseClient } from "@supabase/supabase-js";
import { reportError } from "@/lib/monitoring/report";

export type ConsentKind = "project" | "marketing";
export type ConsentHow = "wizard_request" | "wizard_describe" | "portal_estimate" | "estimate_accepted" | "staff";

export type ConsentRecord = { at: string; how: ConsentHow; note?: string };
export type Consents = Partial<Record<ConsentKind, ConsentRecord>>;

export const CONSENT_LABEL: Record<ConsentKind, string> = { project: "Messages about their project", marketing: "Marketing messages" };
export const CONSENT_HOW_LABEL: Record<ConsentHow, string> = {
  wizard_request: "requested an estimate online", wizard_describe: "described their job online", portal_estimate: "asked from their account",
  estimate_accepted: "accepted an estimate", staff: "recorded by the office",
};

export function parseConsents(raw: unknown): Consents {
  const out: Consents = {};
  if (!raw || typeof raw !== "object") return out;
  for (const k of ["project", "marketing"] as ConsentKind[]) {
    const v = (raw as Record<string, unknown>)[k];
    if (v && typeof v === "object" && typeof (v as { at?: unknown }).at === "string") {
      const r = v as { at: string; how?: string; note?: string };
      out[k] = { at: r.at, how: (r.how as ConsentHow) ?? "staff", ...(r.note ? { note: r.note } : {}) };
    }
  }
  return out;
}

/**
 * Record a consent on an account. `service` must be the service client (the
 * customer is anonymous or a token holder — never a staff session). A repeat
 * from the same source is a no-op; a different source is added to the note.
 */
export async function recordConsent(service: SupabaseClient, accountId: string, kind: ConsentKind, how: ConsentHow, opts?: { estimateId?: string | null }): Promise<"recorded" | "already" | "skipped"> {
  try {
    const { data } = await service.from("accounts").select("consents, permit_email, permit_sms").eq("id", accountId).maybeSingle();
    if (!data) return "skipped";
    const consents = parseConsents((data as { consents?: unknown }).consents);
    if (consents[kind]) return "already";
    const at = new Date().toISOString();
    const next: Consents = { ...consents, [kind]: { at, how } };
    const { error } = await service.from("accounts").update({ consents: next }).eq("id", accountId);
    if (error) { reportError(error, { where: "consent.write", bestEffort: true, extra: { accountId, kind } }); return "skipped"; }

    await service.rpc("crm_log_event", {
      p_type: "consent_recorded", p_account_id: accountId, p_source: "customer",
      p_payload: { kind, how }, p_estimate_id: opts?.estimateId ?? null,
      p_dedupe_key: `consent:${accountId}:${kind}`,
    }).then((r) => { if (r.error) reportError(r.error, { where: "consent.event", bestEffort: true }); });

    // Marketing consent is the one that moves a permission — from unknown only.
    if (kind === "marketing") {
      const row = data as { permit_email?: string | null; permit_sms?: string | null };
      for (const channel of ["email", "sms"] as const) {
        const current = channel === "email" ? row.permit_email : row.permit_sms;
        if (current && current !== "unknown") continue;
        const r = await service.rpc("crm_set_permission", { p_account_id: accountId, p_channel: channel, p_value: "allowed", p_how: how });
        if (r.error) reportError(r.error, { where: "consent.permit", bestEffort: true, extra: { accountId, channel } });
      }
    }
    return "recorded";
  } catch (e) {
    reportError(e, { where: "recordConsent", bestEffort: true, extra: { accountId, kind } });
    return "skipped";
  }
}
