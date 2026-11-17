import "server-only";
import { randomBytes } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import { parseLeadSnapshot, type LeadSnapshot } from "./leadSnapshot";

/**
 * The lead page's writer (A‑F): keep the range the customer was just shown on
 * their draft estimate, and make sure it has a share token so `/e/[token]`
 * can open it. SERVICE CLIENT ONLY — called by the wizard's submit route.
 *
 * An unsent estimate only: once the office has sent it, the customer's page
 * is the sent estimate and the lead snapshot is left as it was. A token that
 * already exists (a first chat message, a visit request) is kept, so every
 * link the customer already holds still opens the same page.
 * CLAUDE.md: ≥ 24 chars from crypto.randomBytes, base64url.
 */
export async function recordLeadSnapshot(svc: SupabaseClient, estimateId: string, snapshot: LeadSnapshot): Promise<{ token: string | null; error: string | null }> {
  const { data, error } = await svc.from("estimates").select("share_token, sent_at").eq("id", estimateId).maybeSingle();
  if (error) return { token: null, error: error.message };
  const row = data as { share_token: string | null; sent_at: string | null } | null;
  if (!row) return { token: null, error: "no such estimate" };
  if (row.sent_at) return { token: row.share_token, error: null };
  const token = row.share_token || randomBytes(42).toString("base64url");
  const { error: upErr } = await svc.from("estimates")
    .update({ lead_snapshot: snapshot, ...(row.share_token ? {} : { share_token: token }) })
    .eq("id", estimateId).is("sent_at", null);
  if (upErr) return { token: null, error: upErr.message };
  return { token, error: null };
}

/**
 * Tightening re-prices (Tom, 17 Nov 2026 — L7 texts "your closer range"):
 * the wizard-edit route calls this with the customer range IT has just worked
 * out, so the lead page and L7 carry the last range the customer was shown.
 * Only a draft that already has a lead page, only while unsent, only when the
 * range moved. A "both" job's halves are dropped: the edit path prices the
 * whole, and two stale halves under a fresh total would disagree.
 */
export async function refreshLeadRange(svc: SupabaseClient, estimateId: string, loCents: number, hiCents: number, now: Date): Promise<string | null> {
  if (!Number.isFinite(loCents) || !Number.isFinite(hiCents) || hiCents <= 0 || hiCents < loCents) return null;
  const { data, error } = await svc.from("estimates").select("lead_snapshot, sent_at").eq("id", estimateId).maybeSingle();
  if (error) return error.message;
  const row = data as { lead_snapshot: unknown; sent_at: string | null } | null;
  const snap = row && !row.sent_at ? parseLeadSnapshot(row.lead_snapshot) : null;
  if (!snap) return null;
  const lo = Math.round(loCents), hi = Math.round(hiCents);
  if (snap.rangeLoCents === lo && snap.rangeHiCents === hi) return null;
  const next: LeadSnapshot = { ...snap, rangeLoCents: lo, rangeHiCents: hi, parts: null, pricedAt: now.toISOString() };
  const { error: upErr } = await svc.from("estimates").update({ lead_snapshot: next }).eq("id", estimateId).is("sent_at", null);
  return upErr ? upErr.message : null;
}
