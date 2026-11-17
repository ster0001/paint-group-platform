import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { parseLeadSnapshot, type LeadSnapshot } from "./leadSnapshot";

/**
 * The lead page's door (Tom, 17 Nov 2026 — the links in L5, L6 and L7). A
 * lead taps Carry on or Book a visit on `/e/[token]`; in the browser that
 * built the draft it simply opens. In any other browser the door route texts
 * a code to the mobile ON FILE (never one the visitor types), and the right
 * code writes an `estimate_draft_doors` row so `customerOwnsDraft` opens this
 * one draft for that login. SERVICE CLIENT ONLY — the route is the caller.
 *
 * The phone code proves the mobile, not the email: it never signs anyone into
 * an account, and a door only ever opens an unsent wizard draft.
 */
export type LeadDoorEstimate = {
  id: string; status: string; source: string | null; created_by: string | null; account_id: string | null;
  brand: string | null; snapshot: LeadSnapshot; mobile: string | null;
};

/** The unsent lead behind a token, or null (unknown token, sent estimate, staff draft, no snapshot). */
export async function leadByToken(svc: SupabaseClient, token: string): Promise<{ lead: LeadDoorEstimate | null; error: string | null }> {
  const { data, error } = await svc.from("estimates")
    .select("id, status, source, created_by, account_id, brand, lead_snapshot, mobile:builder_state->contact->>phone")
    .eq("share_token", token).is("sent_at", null).not("lead_snapshot", "is", null)
    .maybeSingle();
  if (error) return { lead: null, error: error.message };
  const row = data as { id: string; status: string; source: string | null; created_by: string | null; account_id: string | null; brand: string | null; lead_snapshot: unknown; mobile: string | null } | null;
  const snapshot = row ? parseLeadSnapshot(row.lead_snapshot) : null;
  if (!row || !snapshot) return { lead: null, error: null };
  return { lead: { id: row.id, status: row.status, source: row.source, created_by: row.created_by, account_id: row.account_id, brand: row.brand, snapshot, mobile: row.mobile }, error: null };
}

/** Open this draft for this login. Idempotent: a second right code keeps the first row. */
export async function grantDraftDoor(svc: SupabaseClient, estimateId: string, userId: string): Promise<string | null> {
  const { error } = await svc.from("estimate_draft_doors")
    .upsert({ estimate_id: estimateId, user_id: userId, via: "lead_code" }, { onConflict: "estimate_id,user_id", ignoreDuplicates: true });
  return error ? error.message : null;
}
