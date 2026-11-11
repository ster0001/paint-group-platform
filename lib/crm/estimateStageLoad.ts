import type { SupabaseClient } from "@supabase/supabase-js";
import { estimateStageFor, type EstimateStageEvent, type EstimateStageFacts, type EstimateStageResult } from "./estimateStage";

/**
 * Estimates tab session 2: read ONE estimate's facts for `estimateStageFor`.
 * The pure function decides; this only gathers — the estimate, its wizard
 * session, the log for both, the chat, and the job it became. Every read
 * keeps its error: a refused read here is never "no events", it is a stage
 * we could not work out, and the caller says so.
 */
export type EstimateStageLoad =
  | { ok: true; facts: EstimateStageFacts; result: EstimateStageResult | null; title: string | null; draftId: string | null }
  | { ok: false; error: string };

/** Visit and call events are often logged on the account alone; these are read by account too. */
const ACCOUNT_TYPES = ["visit_request_made", "visit_request_answered", "visit_booked", "visit_booked_from_wizard", "visit_completed",
  "visit_cancelled", "visit_no_show", "callback_requested", "call_connected", "message_out"];

export async function loadEstimateStage(supabase: SupabaseClient, estimateId: string, now: Date = new Date()): Promise<EstimateStageLoad> {
  const fail = (where: string, e: { message: string }): EstimateStageLoad => ({ ok: false, error: `${where}: ${e.message}` });

  const { data: est, error: estErr } = await supabase.from("estimates")
    .select("id, title, status, created_at, sent_at, valid_until, accepted_at, declined_at, account_id").eq("id", estimateId).maybeSingle();
  if (estErr) return fail("estimate", estErr);
  if (!est) return { ok: false, error: "No estimate with that id." };

  const { data: draft, error: draftErr } = await supabase.from("wizard_drafts")
    .select("id, started_at, last_seen_at, gate_completed_at, range_shown_at").eq("estimate_id", estimateId)
    .order("last_seen_at", { ascending: false }).limit(1).maybeSingle();
  if (draftErr) return fail("wizard session", draftErr);

  const since = (draft?.started_at as string | undefined) ?? (est.created_at as string);
  const [byEstimate, byDraft, byAccount, chat, wos, finals] = await Promise.all([
    supabase.from("crm_events").select("type, occurred_at, payload").eq("estimate_id", estimateId).order("occurred_at").limit(500),
    draft ? supabase.from("crm_events").select("type, occurred_at, payload").eq("wizard_draft_id", draft.id).order("occurred_at").limit(500) : null,
    est.account_id ? supabase.from("crm_events").select("type, occurred_at, payload").eq("account_id", est.account_id)
      .in("type", ACCOUNT_TYPES).gte("occurred_at", since).order("occurred_at").limit(200) : null,
    supabase.from("estimate_messages").select("direction, created_at").eq("estimate_id", estimateId).order("created_at").limit(500),
    supabase.from("work_orders").select("id").eq("estimate_id", estimateId).limit(5),
    supabase.from("invoices").select("paid_at").eq("estimate_id", estimateId).eq("kind", "final").eq("status", "paid").limit(1),
  ]);
  if (byEstimate.error) return fail("events", byEstimate.error);
  if (byDraft?.error) return fail("wizard events", byDraft.error);
  if (byAccount?.error) return fail("visit events", byAccount.error);
  if (chat.error) return fail("chat", chat.error);
  if (wos.error) return fail("work order", wos.error);
  if (finals.error) return fail("final invoice", finals.error);

  const woIds = (wos.data ?? []).map((w) => w.id as string);
  let offerAcceptedAt: string | null = null;
  if (woIds.length) {
    const { data: offers, error: offerErr } = await supabase.from("booking_offers").select("responded_at")
      .in("work_order_id", woIds).eq("state", "accepted").order("responded_at").limit(1);
    if (offerErr) return fail("booking offer", offerErr);
    offerAcceptedAt = (offers?.[0]?.responded_at as string | null | undefined) ?? null;
  }

  // One event can arrive by two doors (the estimate and its session); keep it once.
  const seen = new Set<string>();
  const events: EstimateStageEvent[] = [];
  for (const e of [...(byEstimate.data ?? []), ...(byDraft?.data ?? []), ...(byAccount?.data ?? [])]) {
    const k = `${e.type}|${e.occurred_at}`;
    if (seen.has(k)) continue;
    seen.add(k);
    events.push({ type: e.type as string, occurred_at: e.occurred_at as string, payload: (e.payload as Record<string, unknown> | null) ?? null });
  }
  const finalPaidAt = (finals.data?.[0]?.paid_at as string | null | undefined) ?? null;
  const facts: EstimateStageFacts = {
    draft: draft ? {
      started_at: draft.started_at as string, last_seen_at: (draft.last_seen_at as string | null) ?? null,
      gate_completed_at: (draft.gate_completed_at as string | null) ?? null, range_shown_at: (draft.range_shown_at as string | null) ?? null,
    } : null,
    estimate: {
      status: est.status as string, created_at: est.created_at as string, sent_at: (est.sent_at as string | null) ?? null,
      valid_until: (est.valid_until as string | null) ?? null, accepted_at: (est.accepted_at as string | null) ?? null, declined_at: (est.declined_at as string | null) ?? null,
    },
    job: woIds.length || finalPaidAt ? { offerAcceptedAt, startedAt: null, signedOffAt: null, finalPaidAt } : null,
    events,
    chat: (chat.data ?? []).map((m) => ({ from: m.direction === "staff" ? "staff" as const : "customer" as const, at: m.created_at as string })),
  };
  return { ok: true, facts, result: estimateStageFor(facts, now), title: (est.title as string | null) ?? null, draftId: (draft?.id as string | undefined) ?? null };
}
