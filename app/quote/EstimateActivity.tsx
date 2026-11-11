"use client";

import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { timelineStamp } from "@/lib/crm/timeline";
import {
  ACTIVITY_COLLAPSED, ACTIVITY_FILTER_LABEL, ACTIVITY_FILTERS, buildEstimateActivity, filterActivity,
  type ActivityEventRow, type ActivityFilter, type ActivityRow, type ActivityViewRow, type LegacyEventRow, type OlderRow,
} from "@/lib/crm/estimateActivity";

/**
 * Estimates tab session 6 (brief §4.6, R16): the Activity panel on /quote.
 * Every `crm_events` row for this estimate and its wizard session, newest
 * first, the newest ten until "show all", with All · Messages · Wizard ·
 * Staff. The opens carry how long they lasted; pre-log rows sit in Older
 * activity (`lib/crm/estimateActivity.ts` says why each source is read).
 */
type Loaded = { ok: true; value: { rows: ActivityRow[]; older: OlderRow[] } } | { ok: false; error: string };

async function fetchActivity(estimateId: string): Promise<Loaded> {
  const supabase = createClient();
  const { data: drafts, error: dErr } = await supabase.from("wizard_drafts").select("id").eq("estimate_id", estimateId).limit(5);
  if (dErr) return { ok: false, error: dErr.message };
  const draftIds = (drafts ?? []).map((d) => d.id as string);
  const cols = "id, type, payload, occurred_at, source";
  const [byEst, byDraft, views, legacy] = await Promise.all([
    supabase.from("crm_events").select(cols).eq("estimate_id", estimateId).order("occurred_at", { ascending: false }).limit(1000),
    draftIds.length ? supabase.from("crm_events").select(cols).in("wizard_draft_id", draftIds).order("occurred_at", { ascending: false }).limit(1000) : Promise.resolve({ data: [], error: null }),
    supabase.from("estimate_views").select("created_at, dwell_ms").eq("estimate_id", estimateId).limit(500),
    supabase.from("estimate_events").select("type, created_at").eq("estimate_id", estimateId).limit(500),
  ]);
  const failed = [byEst, byDraft, views, legacy].find((r) => r.error);
  if (failed?.error) return { ok: false, error: failed.error.message };
  // An event on both the estimate and its session is one event.
  const byId = new Map<string, ActivityEventRow>();
  for (const e of [...(byEst.data ?? []), ...(byDraft.data ?? [])] as ActivityEventRow[]) byId.set(e.id, e);
  return { ok: true, value: buildEstimateActivity({ events: [...byId.values()], views: (views.data ?? []) as ActivityViewRow[], legacy: (legacy.data ?? []) as LegacyEventRow[] }) };
}

export default function EstimateActivity({ estimateId }: { estimateId: string }) {
  const [state, setState] = useState<{ rows: ActivityRow[]; older: OlderRow[] } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState<ActivityFilter>("all");
  const [all, setAll] = useState(false);

  useEffect(() => {
    let off = false;
    fetchActivity(estimateId).then((r) => {
      if (off) return;
      if (r.ok) { setError(null); setState(r.value); } else setError(r.error);
    }, (e: unknown) => { if (!off) setError(e instanceof Error ? e.message : String(e)); });
    return () => { off = true; };
  }, [estimateId]);

  if (error) return <p className="text-xs text-red-700" data-testid="activity-error">The activity could not be loaded: {error}. Close and reopen this tab.</p>;
  if (!state) return <p className="text-xs text-gray-400">Loading…</p>;
  const shown = filterActivity(state.rows, filter);
  const visible = all ? shown : shown.slice(0, ACTIVITY_COLLAPSED);
  return (
    <div data-testid="estimate-activity" data-count={state.rows.length}>
      <div className="mb-2 flex flex-wrap gap-1" role="group" aria-label="Show">
        {ACTIVITY_FILTERS.map((f) => (
          <button key={f} type="button" onClick={() => { setFilter(f); setAll(false); }} aria-pressed={filter === f} data-testid={`activity-filter-${f}`}
            className={`rounded-full border px-2 py-0.5 text-[11px] ${filter === f ? "border-gray-900 bg-gray-900 text-white" : "border-gray-300 text-gray-600 hover:bg-gray-50"}`}>
            {ACTIVITY_FILTER_LABEL[f]}
          </button>
        ))}
      </div>
      {shown.length === 0 ? <p className="text-xs text-gray-500">{filter === "all" ? "No activity yet." : "Nothing of this kind yet."}</p> : (
        <ul className="space-y-2">
          {visible.map((r) => (
            <li key={r.id} className="flex items-start justify-between gap-2" data-testid="activity-row" data-type={r.type}>
              <span className="text-gray-700">
                {r.label}
                {r.detail && <span className="block text-[11px] text-gray-400">{r.detail}</span>}
              </span>
              <span className="shrink-0 text-[11px] tabular-nums text-gray-400">{timelineStamp(r.occurredAt)}</span>
            </li>
          ))}
        </ul>
      )}
      {shown.length > ACTIVITY_COLLAPSED && (
        <button type="button" onClick={() => setAll((a) => !a)} className="mt-2 text-xs text-cyan-700 hover:underline" data-testid="activity-show-all">
          {all ? "Show the newest ten" : `Show all ${shown.length}`}
        </button>
      )}
      {state.older.length > 0 && (
        <details className="mt-3 border-t border-gray-100 pt-2" data-testid="activity-older">
          <summary className="cursor-pointer text-xs text-gray-500">Older activity ({state.older.length})</summary>
          <ul className="mt-2 space-y-2">
            {state.older.map((o, i) => (
              <li key={`${o.at}-${i}`} className="flex items-start justify-between gap-2">
                <span className="text-gray-600">{o.label}{o.detail && <span className="block text-[11px] text-gray-400">{o.detail}</span>}</span>
                <span className="shrink-0 text-[11px] tabular-nums text-gray-400">{timelineStamp(o.at)}</span>
              </li>
            ))}
          </ul>
        </details>
      )}
    </div>
  );
}
