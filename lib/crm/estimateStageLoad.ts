import type { SupabaseClient } from "@supabase/supabase-js";
import { realOnly } from "@/lib/demo/scope";
import { estimateStageFor, type EstimateStageEvent, type EstimateStageFacts, type EstimateStageResult } from "./estimateStage";

/**
 * Estimates tab sessions 2 + 4: read estimates' (and wizard sessions') facts
 * for `estimateStageFor`. The pure function decides; this only gathers — the
 * estimate, its wizard session, the log for both, the chat, and the job it
 * became. ONE loader for one estimate (the dev route) and for a list (the
 * Pipeline): every read is by a chunk of ids, never once per estimate.
 *
 * Every read keeps its error: a refused read here is never "no events", it is
 * a stage we could not work out, and the caller says so.
 */

/** Visit and call events are often logged on the account alone; these are read by account too. */
const ACCOUNT_TYPES = ["visit_request_made", "visit_request_answered", "visit_booked", "visit_booked_from_wizard", "visit_completed",
  "visit_cancelled", "visit_no_show", "callback_requested", "call_connected", "message_out"];

/** Ids per `in()` read: 80 uuids keep the request line well under the proxy limit. */
const CHUNK = 80;

export const STAGE_ESTIMATE_COLUMNS = "id, title, status, created_at, sent_at, valid_until, accepted_at, declined_at, account_id";
export const STAGE_DRAFT_COLUMNS = "id, estimate_id, account_id, started_at, last_seen_at, gate_completed_at, range_shown_at";

export type StageEstimateRow = {
  id: string; title: string | null; status: string; created_at: string; sent_at: string | null; valid_until: string | null;
  accepted_at: string | null; declined_at: string | null; account_id: string | null;
};
export type StageDraftRow = {
  id: string; estimate_id: string | null; account_id: string | null; started_at: string; last_seen_at: string | null;
  gate_completed_at: string | null; range_shown_at: string | null;
};
/** One thing with a stage: an estimate (with the session behind it, if any), or a session with no estimate yet. */
export type StageSubject = { estimate: StageEstimateRow | null; draft: StageDraftRow | null };
export type StageOf = { facts: EstimateStageFacts; result: EstimateStageResult | null };

type Fail = { ok: false; error: string };
type EventRow = { type: string; occurred_at: string; payload: Record<string, unknown> | null; estimate_id?: string | null; wizard_draft_id?: string | null; account_id?: string | null };

function chunks<T>(xs: readonly T[]): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < xs.length; i += CHUNK) out.push(xs.slice(i, i + CHUNK));
  return out;
}

/** Run one read per chunk of ids; the first error wins. */
async function byChunk<R>(ids: readonly string[], where: string, read: (ids: string[]) => PromiseLike<{ data: unknown; error: { message: string } | null }>): Promise<{ ok: true; rows: R[] } | Fail> {
  const rows: R[] = [];
  const results = await Promise.all(chunks(ids).map((c) => read(c)));
  for (const r of results) {
    if (r.error) return { ok: false, error: `${where}: ${r.error.message}` };
    rows.push(...((r.data ?? []) as R[]));
  }
  return { ok: true, rows };
}

const keyOf = (s: StageSubject): string => s.estimate?.id ?? `draft:${s.draft?.id ?? ""}`;

/**
 * Stage every subject. Returns a map keyed by estimate id, or `draft:<id>`
 * for a session with no estimate.
 */
export async function loadEstimateStages(
  supabase: SupabaseClient, subjects: readonly StageSubject[], now: Date = new Date(),
): Promise<{ ok: true; stages: Map<string, StageOf> } | Fail> {
  const estIds = [...new Set(subjects.map((s) => s.estimate?.id).filter((x): x is string => Boolean(x)))];
  const draftIds = [...new Set(subjects.map((s) => s.draft?.id).filter((x): x is string => Boolean(x)))];
  const accountIds = [...new Set(subjects.map((s) => s.estimate?.account_id ?? s.draft?.account_id).filter((x): x is string => Boolean(x)))];
  const earliest = subjects.map((s) => s.draft?.started_at ?? s.estimate?.created_at).filter((x): x is string => Boolean(x)).sort()[0] ?? now.toISOString();

  const [byEstimate, byDraft, byAccount, chat, wos, finals] = await Promise.all([
    byChunk<EventRow>(estIds, "events", (ids) => realOnly(supabase.from("crm_events").select("type, occurred_at, payload, estimate_id")).in("estimate_id", ids).order("occurred_at").limit(5000)),
    byChunk<EventRow>(draftIds, "wizard events", (ids) => realOnly(supabase.from("crm_events").select("type, occurred_at, payload, wizard_draft_id")).in("wizard_draft_id", ids).order("occurred_at").limit(5000)),
    byChunk<EventRow>(accountIds, "visit events", (ids) => realOnly(supabase.from("crm_events").select("type, occurred_at, payload, account_id")).in("account_id", ids)
      .in("type", ACCOUNT_TYPES).gte("occurred_at", earliest).order("occurred_at").limit(5000)),
    byChunk<{ estimate_id: string; direction: string; created_at: string }>(estIds, "chat", (ids) => supabase.from("estimate_messages").select("estimate_id, direction, created_at").in("estimate_id", ids).order("created_at").limit(5000)),
    byChunk<{ id: string; estimate_id: string }>(estIds, "work order", (ids) => realOnly(supabase.from("work_orders").select("id, estimate_id")).in("estimate_id", ids)),
    byChunk<{ estimate_id: string; paid_at: string | null }>(estIds, "final invoice", (ids) => realOnly(supabase.from("invoices").select("estimate_id, paid_at")).in("estimate_id", ids).eq("kind", "final").eq("status", "paid")),
  ]);
  if (!byEstimate.ok) return byEstimate;
  if (!byDraft.ok) return byDraft;
  if (!byAccount.ok) return byAccount;
  if (!chat.ok) return chat;
  if (!wos.ok) return wos;
  if (!finals.ok) return finals;

  const woOf = new Map<string, string[]>();
  for (const w of wos.rows) woOf.set(w.estimate_id, [...(woOf.get(w.estimate_id) ?? []), w.id]);
  const offers = await byChunk<{ work_order_id: string; responded_at: string | null }>(wos.rows.map((w) => w.id), "booking offer",
    (ids) => realOnly(supabase.from("booking_offers").select("work_order_id, responded_at")).in("work_order_id", ids).eq("state", "accepted").order("responded_at"));
  if (!offers.ok) return offers;
  const offerOfWo = new Map<string, string | null>();
  for (const o of offers.rows) if (!offerOfWo.has(o.work_order_id)) offerOfWo.set(o.work_order_id, o.responded_at);

  const group = <T, K extends string>(rows: T[], key: (r: T) => K | null | undefined) => {
    const m = new Map<string, T[]>();
    for (const r of rows) { const k = key(r); if (k) m.set(k, [...(m.get(k) ?? []), r]); }
    return m;
  };
  const evByEst = group(byEstimate.rows, (r) => r.estimate_id);
  const evByDraft = group(byDraft.rows, (r) => r.wizard_draft_id);
  const evByAcc = group(byAccount.rows, (r) => r.account_id);
  const chatByEst = group(chat.rows, (r) => r.estimate_id);
  const paidByEst = new Map(finals.rows.map((f) => [f.estimate_id, f.paid_at]));

  const stages = new Map<string, StageOf>();
  for (const s of subjects) {
    const est = s.estimate; const draft = s.draft;
    const accountId = est?.account_id ?? draft?.account_id ?? null;
    const since = draft?.started_at ?? est?.created_at ?? earliest;
    // One event can arrive by two doors (the estimate and its session); keep it once.
    const seen = new Set<string>();
    const events: EstimateStageEvent[] = [];
    const accountEvents = (accountId ? evByAcc.get(accountId) ?? [] : []).filter((e) => e.occurred_at >= since);
    for (const e of [...(est ? evByEst.get(est.id) ?? [] : []), ...(draft ? evByDraft.get(draft.id) ?? [] : []), ...accountEvents]) {
      const k = `${e.type}|${e.occurred_at}`;
      if (seen.has(k)) continue;
      seen.add(k);
      events.push({ type: e.type, occurred_at: e.occurred_at, payload: e.payload ?? null });
    }
    events.sort((a, b) => a.occurred_at.localeCompare(b.occurred_at));
    const woIds = est ? woOf.get(est.id) ?? [] : [];
    const offerAcceptedAt = woIds.map((w) => offerOfWo.get(w) ?? null).filter((x): x is string => Boolean(x)).sort()[0] ?? null;
    const finalPaidAt = est ? paidByEst.get(est.id) ?? null : null;
    const facts: EstimateStageFacts = {
      draft: draft ? { started_at: draft.started_at, last_seen_at: draft.last_seen_at, gate_completed_at: draft.gate_completed_at, range_shown_at: draft.range_shown_at } : null,
      estimate: est ? {
        status: est.status, created_at: est.created_at, sent_at: est.sent_at, valid_until: est.valid_until,
        accepted_at: est.accepted_at, declined_at: est.declined_at,
      } : null,
      job: woIds.length || finalPaidAt ? { offerAcceptedAt, startedAt: null, signedOffAt: null, finalPaidAt } : null,
      events,
      chat: (est ? chatByEst.get(est.id) ?? [] : []).map((m) => ({ from: m.direction === "staff" ? "staff" as const : "customer" as const, at: m.created_at })),
    };
    stages.set(keyOf(s), { facts, result: estimateStageFor(facts, now) });
  }
  return { ok: true, stages };
}

export type EstimateStageLoad =
  | { ok: true; facts: EstimateStageFacts; result: EstimateStageResult | null; title: string | null; draftId: string | null }
  | Fail;

/** One estimate's stage — the dev route. The same loader as the Pipeline, with a list of one. */
export async function loadEstimateStage(supabase: SupabaseClient, estimateId: string, now: Date = new Date()): Promise<EstimateStageLoad> {
  const { data: est, error: estErr } = await supabase.from("estimates").select(STAGE_ESTIMATE_COLUMNS).eq("id", estimateId).maybeSingle();
  if (estErr) return { ok: false, error: `estimate: ${estErr.message}` };
  if (!est) return { ok: false, error: "No estimate with that id." };
  const { data: draft, error: draftErr } = await supabase.from("wizard_drafts").select(STAGE_DRAFT_COLUMNS).eq("estimate_id", estimateId)
    .order("last_seen_at", { ascending: false }).limit(1).maybeSingle();
  if (draftErr) return { ok: false, error: `wizard session: ${draftErr.message}` };
  const subject: StageSubject = { estimate: est as StageEstimateRow, draft: (draft as StageDraftRow | null) ?? null };
  const load = await loadEstimateStages(supabase, [subject], now);
  if (!load.ok) return load;
  const one = load.stages.get(estimateId)!;
  return { ok: true, facts: one.facts, result: one.result, title: (est.title as string | null) ?? null, draftId: (draft?.id as string | undefined) ?? null };
}
