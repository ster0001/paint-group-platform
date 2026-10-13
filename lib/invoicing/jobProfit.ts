/**
 * The job panel's "Money out and profit" (payments-merge brief §4.7, R19,
 * Step 7). Pure. Gross profit from ACTUAL recorded costs, every line tracing
 * to the rows it adds up (the acceptance: "every line traces to a cost row").
 *
 *   job value ex GST   = the job row's contract (inc GST) less its GST (gst.ts)
 *   contractor         = the offer on the work order + accepted variation
 *                        deltas (contractorPay.ts) — EXCLUDING GST (⚑P14)
 *   own painters       = labour job costs, approved or paid
 *   materials          = materials job costs (lib/invoicing/materials.ts's
 *                        rule) + material_costs on the job (not overhead),
 *                        ex GST
 *   other trades       = every other job cost (scaffold, render…), ex GST
 *   contractor expenses= approved/paid expense claims, ex GST
 *
 * A voided (deleted) cost counts nowhere.
 */
import { gstFromIncCents } from "./gst";

export type ProfitCost = { id: string; category: string; status: string; amountExCents: number; label: string };
export type ProfitMaterial = { id: string; amountIncCents: number; overhead: boolean | null; label: string };
export type ProfitExpense = { id: string; amountExCents: number; status: string; label: string };

export type ProfitInput = {
  contractIncCents: number;
  gstRatePct?: number;
  /** The contractor's offer on the work order (ex GST) and the accepted variation deltas. */
  offerCents: number;
  contractorVariationCents: number;
  costs: readonly ProfitCost[];
  /** The ids of job costs the Materials rule counts as materials (lib/invoicing/materials.ts). */
  materialsCostIds: ReadonlySet<string>;
  materialCosts: readonly ProfitMaterial[];
  expenses: readonly ProfitExpense[];
  /** The job has started (In progress or later) — "no materials yet" is then a warning. */
  started: boolean;
};

export type ProfitLine = { key: "contractor" | "own_painters" | "materials" | "other" | "expenses"; label: string; cents: number; sources: { id: string; label: string; cents: number }[] };

export type JobProfit = {
  valueExCents: number;
  lines: ProfitLine[];
  totalCostsCents: number;
  grossProfitCents: number;
  /** One decimal place, as the panel shows it: 23.4. Null when there is no job value. */
  marginPct: number | null;
  /** The bar: each line, then profit, as a share of the job value (0–100, never negative). */
  bar: { key: ProfitLine["key"] | "profit"; pct: number }[];
  /** R19 note: a started job with no materials recorded — the profit reads too high. */
  noMaterialsWarning: boolean;
};

const COUNTED = new Set(["recorded", "approved", "paid"]);

export function jobProfit(input: ProfitInput): JobProfit {
  const rate = input.gstRatePct ?? 10;
  const valueExCents = input.contractIncCents - gstFromIncCents(input.contractIncCents, rate);
  const live = input.costs.filter((c) => COUNTED.has(c.status));
  const labour = live.filter((c) => c.category === "labour" && (c.status === "approved" || c.status === "paid"));
  const materials = live.filter((c) => input.materialsCostIds.has(c.id));
  const other = live.filter((c) => c.category !== "labour" && !input.materialsCostIds.has(c.id));
  const matCosts = input.materialCosts.filter((m) => m.overhead !== true);
  const expenses = input.expenses.filter((e) => e.status === "approved" || e.status === "paid");

  const line = (key: ProfitLine["key"], label: string, sources: ProfitLine["sources"]): ProfitLine =>
    ({ key, label, sources, cents: sources.reduce((s, x) => s + x.cents, 0) });
  const lines: ProfitLine[] = [
    line("contractor", input.contractorVariationCents ? "Contractor: offer plus variations" : "Contractor: offer", [
      { id: "offer", label: "Offer on the work order", cents: input.offerCents },
      ...(input.contractorVariationCents ? [{ id: "variations", label: "Accepted variations", cents: input.contractorVariationCents }] : []),
    ]),
    line("own_painters", "Own painters", labour.map((c) => ({ id: c.id, label: c.label, cents: c.amountExCents }))),
    line("materials", "Materials", [
      ...materials.map((c) => ({ id: c.id, label: c.label, cents: c.amountExCents })),
      ...matCosts.map((m) => ({ id: m.id, label: m.label, cents: m.amountIncCents - gstFromIncCents(m.amountIncCents, rate) })),
    ]),
    line("other", "Other trades and costs", other.map((c) => ({ id: c.id, label: c.label, cents: c.amountExCents }))),
    line("expenses", "Contractor expenses", expenses.map((e) => ({ id: e.id, label: e.label, cents: e.amountExCents }))),
  ];
  const totalCostsCents = lines.reduce((s, l) => s + l.cents, 0);
  const grossProfitCents = valueExCents - totalCostsCents;
  const share = (c: number) => (valueExCents > 0 ? Math.max(0, Math.round((c * 1000) / valueExCents) / 10) : 0);
  return {
    valueExCents, lines, totalCostsCents, grossProfitCents,
    marginPct: valueExCents > 0 ? Math.round((grossProfitCents * 1000) / valueExCents) / 10 : null,
    bar: [...lines.filter((l) => l.cents > 0).map((l) => ({ key: l.key, pct: share(l.cents) })), { key: "profit" as const, pct: share(grossProfitCents) }],
    noMaterialsWarning: input.started && lines.find((l) => l.key === "materials")!.cents === 0,
  };
}
