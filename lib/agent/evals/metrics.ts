/**
 * S8 metrics, as pure functions over what the platform already records —
 * the dashboard and the eval report both read these, so a number means the
 * same thing in both places.
 */

import type { AgentSettings } from "../settings";

export type SpendRow = { model_id: string | null; tokens_in: number; tokens_out: number; created_at: string };

/** Estimated model cost in cents for a set of messages. */
export function costCents(rows: SpendRow[], prices: AgentSettings["modelPrices"]): number {
  let usd = 0;
  for (const r of rows) {
    const p = r.model_id ? prices[r.model_id] : undefined;
    if (!p) continue;
    usd += (r.tokens_in / 1_000_000) * p.inUsd + (r.tokens_out / 1_000_000) * p.outUsd;
  }
  return Math.round(usd * 100);
}

export const median = (xs: number[]): number => {
  if (xs.length === 0) return 0;
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : Math.round((s[m - 1] + s[m]) / 2);
};

/** Drop-off by gap key: the last question each unfinished conversation was asked. */
export function dropOffByGap(lastGaps: Array<{ conversationId: string; gapKey: string | null; completed: boolean }>): Array<{ gapKey: string; count: number }> {
  const counts = new Map<string, number>();
  for (const g of lastGaps) {
    if (g.completed) continue;
    const k = g.gapKey ?? "(no question yet)";
    counts.set(k, (counts.get(k) ?? 0) + 1);
  }
  return [...counts.entries()].map(([gapKey, count]) => ({ gapKey, count })).sort((a, b) => b.count - a.count);
}

export function handoffRate(conversations: number, handoffs: number): number {
  return conversations === 0 ? 0 : Math.round((handoffs / conversations) * 1000) / 10;
}
