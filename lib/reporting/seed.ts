/**
 * The golden dataset (brief, session 1): 60 estimates across 3 categories and
 * 2 salespeople, 20 work orders, 30 payments — generated deterministically so
 * every metric's tests recount the same rows by hand. No database, no
 * randomness: a seeded LCG and fixed anchors.
 *
 * Dates are instants in Melbourne in Aug–Sep 2026 so the
 * Melbourne-day bucketing is exercised across a month boundary and the
 * 10 am trap (an early-morning instant is "yesterday" in UTC).
 */
import type { EstimateRow } from "./core";
import { melbourneInstant } from "@/lib/time/businessHours";

export const SEED_NOW = melbourneInstant(2026, 9, 19, 14);
export const SEED_SALESPEOPLE = ["11111111-1111-4111-8111-111111111111", "22222222-2222-4222-8222-222222222222"] as const;
export const SEED_CATEGORIES = ["Interior", "Exterior", "Commercial"] as const;
export const SEED_SOURCES = ["referral", "paid_google", "organic_search", "social", "unknown"] as const;

function lcg(seed: number) {
  let s = seed >>> 0;
  return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 0x100000000; };
}

/** An instant at `hour` on a Melbourne calendar day — the zone decides the offset, never a written one. */
const at = (day: string, hour: number) => { const [y, m, d] = day.split("-").map(Number); return melbourneInstant(y, m, d, hour).toISOString(); };
const dayN = (n: number) => { const d = new Date(Date.UTC(2026, 7, 1) + n * 86_400_000); return d.toISOString().slice(0, 10); };

export type SeedWorkOrder = { id: string; estimate_id: string; stage: string; start_date: string | null; end_date: string | null; contractor_id: string };
export type SeedPayment = { id: string; invoice_id: string; estimate_id: string; amount_cents: number; method: string; received_at: string };

export function goldenSeed(): { estimates: EstimateRow[]; workOrders: SeedWorkOrder[]; payments: SeedPayment[] } {
  const rnd = lcg(20260919);
  const estimates: EstimateRow[] = [];
  for (let i = 0; i < 60; i++) {
    const id = `e${String(i + 1).padStart(3, "0")}0000-0000-4000-8000-000000000000`;
    const sentDay = dayN(Math.floor(rnd() * 50));          // 1 Aug – 19 Sep
    const sentHour = rnd() < 0.3 ? 8 : 15;                  // 8 am Melbourne is 22:00 UTC the day before
    const category = SEED_CATEGORIES[i % 3];
    const salesperson = SEED_SALESPEOPLE[i % 2];
    const total = 400_000 + Math.floor(rnd() * 3_000_000);  // $4k – $34k
    const roll = rnd();
    const accepted = roll < 0.4;
    const declined = !accepted && roll < 0.55;
    const acceptDay = accepted ? dayN(Math.min(49, Math.floor(rnd() * 12) + dayIndex(sentDay))) : null;
    estimates.push({
      id, title: `${category} job ${i + 1}`,
      status: accepted ? "accepted" : declined ? "declined" : "sent",
      sent_at: at(sentDay, sentHour),
      accepted_at: acceptDay ? at(acceptDay, 11) : null,
      declined_at: declined ? at(dayN(Math.min(49, dayIndex(sentDay) + 3)), 11) : null,
      total_cents: total,
      accepted_total_cents: accepted ? total - Math.floor(rnd() * 50_000) : null,
      sent_by_user_id: salesperson,
      lead_source: SEED_SOURCES[Math.floor(rnd() * SEED_SOURCES.length)],
      presentation_id: `p${category.toLowerCase()}-0000-4000-8000-000000000000`,
      account_id: `a${String(i % 25).padStart(3, "0")}0000-0000-4000-8000-000000000000`,
      created_at: at(sentDay, 7),
    });
  }
  // Drafts never sent — they must never count.
  for (let i = 60; i < 69; i++) {
    estimates.push({
      id: `e${String(i + 1).padStart(3, "0")}0000-0000-4000-8000-000000000000`, title: `Draft ${i + 1}`, status: "draft",
      sent_at: null, accepted_at: null, declined_at: null, total_cents: 500_000, accepted_total_cents: null,
      sent_by_user_id: null, lead_source: null, presentation_id: null, account_id: null, created_at: at(dayN(40), 9),
    });
  }
  const accepted = estimates.filter((e) => e.status === "accepted").slice(0, 20);
  const workOrders: SeedWorkOrder[] = accepted.map((e, i) => ({
    id: `w${String(i + 1).padStart(3, "0")}0000-0000-4000-8000-000000000000`, estimate_id: e.id,
    stage: ["in_progress", "closed", "pre_start", "walkthrough"][i % 4],
    start_date: dayN(30 + (i % 15)), end_date: dayN(33 + (i % 15)),
    contractor_id: `c${String(i % 5).padStart(3, "0")}0000-0000-4000-8000-000000000000`,
  }));
  const payments: SeedPayment[] = [];
  for (let i = 0; i < 30; i++) {
    const e = accepted[i % accepted.length];
    payments.push({
      id: `y${String(i + 1).padStart(3, "0")}0000-0000-4000-8000-000000000000`, invoice_id: `i${i}`, estimate_id: e.id,
      amount_cents: Math.floor((e.accepted_total_cents ?? e.total_cents) * (i % 3 === 0 ? 0.1 : 0.45)),
      method: i % 4 === 0 ? "bank_transfer" : "stripe_card", received_at: at(dayN(20 + (i % 29)), 10),
    });
  }
  return { estimates, workOrders, payments };
}

function dayIndex(day: string): number {
  return Math.round((Date.parse(`${day}T00:00:00Z`) - Date.UTC(2026, 7, 1)) / 86_400_000);
}
