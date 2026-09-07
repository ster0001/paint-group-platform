import type { SupabaseClient } from "@supabase/supabase-js";
import { reportError } from "@/lib/monitoring/report";

// SERVER ONLY — reads and writes wizard_drafts through the service client.
/**
 * Tom, 7 Sep (evening): "allow the customer to sign back in at any time into
 * the wizard". A drop-out's draft is keyed on the ANONYMOUS auth user that
 * started it; the magic link signs them in as a different user. The way back
 * is the account door: the draft's account_id (written by the autosave once
 * an email was typed) is one the signed-in member belongs to — or the
 * draft's email IS the member's verified email. Membership rows only ever
 * come from verified sign-ins (3a-1), so a typed email never opens anyone
 * else's draft.
 *
 * Opening the wizard ADOPTS the row (user_id ← the signed-in user) so every
 * later autosave and heartbeat lands on the same session. Nothing else on the
 * row changes: bucket, dropped_at and outcome are the funnel's, and the
 * portal never writes any of them.
 */
export const ACCOUNT_DRAFT_MAX_AGE_MS = 30 * 24 * 60 * 60_000;

export type OpenDraftRow = {
  id: string; user_id: string | null; account_id: string | null; email: string | null;
  state: unknown; job_type: string | null; address: string | null; suburb: string | null;
  current_page: number | null; furthest_page: number | null; pages_total: number | null;
  last_seen_at: string | null; converted_at: string | null; bucket?: string | null;
};
const COLS = "id, user_id, account_id, email, state, job_type, address, suburb, current_page, furthest_page, pages_total, last_seen_at, converted_at, bucket";

export async function findOpenDraft(
  db: SupabaseClient,
  who: { userId: string; verifiedEmail: string | null },
  now = new Date(),
): Promise<{ row: OpenDraftRow; own: boolean } | null> {
  const { data: own } = await db.from("wizard_drafts").select(COLS)
    .eq("user_id", who.userId).is("converted_at", null)
    .order("last_seen_at", { ascending: false }).limit(1).maybeSingle();
  if (own) return { row: own as OpenDraftRow, own: true };
  const email = who.verifiedEmail?.trim().toLowerCase() ?? "";
  if (!email.includes("@")) return null;
  const { data: memberships } = await db.from("account_users").select("account_id").eq("profile_id", who.userId);
  const accountIds = ((memberships ?? []) as Array<{ account_id: string }>).map((m) => m.account_id).filter(Boolean);
  const cutoff = new Date(now.getTime() - ACCOUNT_DRAFT_MAX_AGE_MS).toISOString();
  let q = db.from("wizard_drafts").select(COLS).is("converted_at", null).gte("last_seen_at", cutoff)
    .order("last_seen_at", { ascending: false }).limit(1);
  // PostgREST's or= filter is comma-delimited; an address with a comma or
  // bracket in it (never seen, always possible) falls back to the account door.
  const safeEmail = /^[^,()]+$/.test(email) ? email : null;
  if (accountIds.length && safeEmail) q = q.or(`account_id.in.(${accountIds.join(",")}),email.eq.${safeEmail}`);
  else if (accountIds.length) q = q.in("account_id", accountIds);
  else if (safeEmail) q = q.eq("email", safeEmail);
  else return null;
  const { data } = await q.maybeSingle();
  return data ? { row: data as OpenDraftRow, own: false } : null;
}

/** The signed-in user takes over the session (see above). Best-effort. */
export async function adoptDraft(db: SupabaseClient, draftId: string, userId: string): Promise<void> {
  const { error } = await db.from("wizard_drafts").update({ user_id: userId }).eq("id", draftId).is("converted_at", null);
  if (error) reportError(error, { where: "wizard.draft.adopt", bestEffort: true, extra: { draftId } });
}
