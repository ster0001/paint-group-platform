import type { SupabaseClient } from "@supabase/supabase-js";
import { realOnly } from "@/lib/demo/scope";
import { loadEstimateStages, STAGE_DRAFT_COLUMNS, STAGE_ESTIMATE_COLUMNS, type StageDraftRow, type StageEstimateRow, type StageSubject } from "@/lib/crm/estimateStageLoad";
import { buildPipeline, type Pipeline, type PipelineCard } from "./pipeline";

/**
 * Estimates tab session 4: gather what the Pipeline needs — the open
 * estimates, the wizard sessions behind them and the priced sessions with no
 * estimate yet, the accounts' temperature and snooze — and stage them all
 * through the ONE stage loader. Bounded reads: open estimates from the last
 * 180 days (older ones are Cold by the 90-day rule), sessions seen in the last
 * 90. Every error is kept and returned.
 */
const ESTIMATE_WINDOW_DAYS = 180;
const SESSION_WINDOW_DAYS = 90;
const MAX_ESTIMATES = 400;
const MAX_SESSIONS = 300;
const CHUNK = 80;

type EstimateRead = StageEstimateRow & {
  brand: string | null; total_cents: number | null;
  wizard_job: string | null; contact_first: string | null; contact_last: string | null; job_street: string | null; job_city: string | null;
  views: Array<{ id: string }> | null;
};
type DraftRead = StageDraftRow & {
  name: string | null; address: string | null; suburb: string | null; job_type: string | null; brand: string | null;
  visits: number | null; est_value_cents: number | null;
};

const ESTIMATE_SELECT = `${STAGE_ESTIMATE_COLUMNS}, brand, total_cents, `
  + "wizard_job:builder_state->wizard->state->>jobType, "
  + "contact_first:builder_state->contact->>first_name, contact_last:builder_state->contact->>last_name, "
  + "job_street:builder_state->jobAddress->>address, job_city:builder_state->jobAddress->>city, views:estimate_views(id)";
const DRAFT_SELECT = `${STAGE_DRAFT_COLUMNS}, name, address, suburb, job_type, brand, visits, est_value_cents`;

const daysAgo = (now: Date, d: number) => new Date(now.getTime() - d * 86_400_000).toISOString();
const chunk = <T,>(xs: readonly T[]) => Array.from({ length: Math.ceil(xs.length / CHUNK) }, (_, i) => xs.slice(i * CHUNK, i * CHUNK + CHUNK));
const TEMPS = new Set(["hot", "warm", "cold"]);

export async function loadPipeline(supabase: SupabaseClient, now: Date = new Date()): Promise<{ ok: true; pipeline: Pipeline } | { ok: false; error: string }> {
  const [estRes, openRes] = await Promise.all([
    realOnly(supabase.from("estimates").select(ESTIMATE_SELECT)).in("status", ["draft", "sent"])
      .gte("created_at", daysAgo(now, ESTIMATE_WINDOW_DAYS)).order("created_at", { ascending: false }).limit(MAX_ESTIMATES),
    supabase.from("wizard_drafts").select(DRAFT_SELECT).is("estimate_id", null).is("converted_at", null)
      .not("gate_completed_at", "is", null).gte("last_seen_at", daysAgo(now, SESSION_WINDOW_DAYS))
      .order("last_seen_at", { ascending: false }).limit(MAX_SESSIONS),
  ]);
  if (estRes.error) return { ok: false, error: `estimates: ${estRes.error.message}` };
  if (openRes.error) return { ok: false, error: `wizard sessions: ${openRes.error.message}` };
  const estimates = (estRes.data ?? []) as unknown as EstimateRead[];
  const openDrafts = (openRes.data ?? []) as unknown as DraftRead[];

  // The session behind each estimate: newest seen wins.
  const linked = await Promise.all(chunk(estimates.map((e) => e.id)).map((ids) =>
    supabase.from("wizard_drafts").select(DRAFT_SELECT).in("estimate_id", ids).order("last_seen_at", { ascending: false })));
  const draftOf = new Map<string, DraftRead>();
  for (const r of linked) {
    if (r.error) return { ok: false, error: `wizard sessions: ${r.error.message}` };
    for (const d of (r.data ?? []) as unknown as DraftRead[]) if (d.estimate_id && !draftOf.has(d.estimate_id)) draftOf.set(d.estimate_id, d);
  }

  const accountIds = [...new Set([...estimates.map((e) => e.account_id), ...openDrafts.map((d) => d.account_id)].filter((x): x is string => Boolean(x)))];
  const accRes = await Promise.all(chunk(accountIds).map((ids) => supabase.from("accounts").select("id, name, temperature, snoozed_until").in("id", ids)));
  const accountOf = new Map<string, { name: string | null; temperature: string | null; snoozed_until: string | null }>();
  for (const r of accRes) {
    if (r.error) return { ok: false, error: `customers: ${r.error.message}` };
    for (const a of (r.data ?? []) as Array<{ id: string; name: string | null; temperature: string | null; snoozed_until: string | null }>) accountOf.set(a.id, a);
  }

  const subjects: StageSubject[] = [
    ...estimates.map((e) => ({ estimate: e, draft: draftOf.get(e.id) ?? null })),
    ...openDrafts.map((d) => ({ estimate: null, draft: d })),
  ];
  const staged = await loadEstimateStages(supabase, subjects, now);
  if (!staged.ok) return staged;

  const cards: PipelineCard[] = [];
  const push = (key: string, base: Omit<PipelineCard, "stage" | "key" | "temperature" | "snoozedUntil">) => {
    const st = staged.stages.get(key)?.result;
    if (!st) return;
    const acc = base.accountId ? accountOf.get(base.accountId) : undefined;
    const t = acc?.temperature ?? null;
    cards.push({ ...base, key, stage: st, temperature: t && TEMPS.has(t) ? (t as PipelineCard["temperature"]) : null, snoozedUntil: acc?.snoozed_until ?? null });
  };
  for (const e of estimates) {
    const d = draftOf.get(e.id) ?? null;
    const person = [e.contact_first, e.contact_last].map((x) => (x ?? "").trim()).filter(Boolean).join(" ");
    const priced = (e.total_cents ?? 0) > 0;
    push(e.id, {
      href: `/quote?id=${e.id}`,
      name: person || d?.name?.trim() || (e.account_id ? accountOf.get(e.account_id)?.name : null) || e.title || "Untitled estimate",
      address: [e.job_street, e.job_city].map((x) => (x ?? "").trim()).filter(Boolean).join(", ") || d?.address || d?.suburb || null,
      brand: e.brand, jobType: e.wizard_job ?? d?.job_type ?? null,
      valueCents: priced ? e.total_cents : d?.est_value_cents ?? null, valueIsGuess: !priced,
      viewCount: (e.views ?? []).length, cameBack: Math.max(0, (d?.visits ?? 1) - 1), accountId: e.account_id,
    });
  }
  for (const d of openDrafts) {
    push(`draft:${d.id}`, {
      href: `/estimates?status=wizard&open=${d.id}`,
      name: d.name?.trim() || (d.account_id ? accountOf.get(d.account_id)?.name : null) || d.suburb || "Unknown",
      address: d.address || d.suburb, brand: d.brand, jobType: d.job_type,
      valueCents: d.est_value_cents, valueIsGuess: true, viewCount: 0, cameBack: Math.max(0, (d.visits ?? 1) - 1), accountId: d.account_id,
    });
  }
  return { ok: true, pipeline: buildPipeline(cards, now) };
}
