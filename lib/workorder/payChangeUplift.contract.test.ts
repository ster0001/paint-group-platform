/**
 * Tom, 14 Oct 2026 (73 Kerferd): a rate change sent to the painter uplifts
 * each hour once. Revision changes drafted at the NEW rate must not be
 * uplifted again on the figure the painter is asked to accept.
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const SQL = readFileSync(resolve(process.cwd(), "supabase/migrations/20270264000000_pay_change_no_double_uplift.sql"), "utf8");

/** The pay-change arithmetic the function runs, as plain numbers. */
function payChangeTo(o: {
  baseCents: number; variationsCents: number; baseHours: number; agreedRate: number; newRate: number;
  revisionRows: { hours: number; rateCents: number | null; deltaCents: number }[];
}): number {
  const uplifted = o.revisionRows
    .filter((r) => (r.rateCents ?? o.agreedRate) === o.agreedRate && r.deltaCents === Math.round(r.hours * o.agreedRate))
    .reduce((n, r) => n + r.hours, o.baseHours);
  return o.baseCents + o.variationsCents + Math.round(uplifted * (o.newRate - o.agreedRate));
}

describe("rate change sent to the painter", () => {
  it("counts only revision rows still priced at the agreed rate", () => {
    expect(SQL).toContain("and coalesce(contractor_rate_cents, v_agreed) = v_agreed");
    expect(SQL).toContain("and contractor_delta_cents = round(coalesce(est_hours, 0) * v_agreed)::integer;");
    expect(SQL).not.toContain("coalesce(contractor_rate_cents, v_agreed))::integer");
  });

  it("73 Kerferd: $5,040 base + $1,203 variations, $60 → $67 over 84 base hours = $6,831", () => {
    expect(payChangeTo({
      baseCents: 504000, variationsCents: 120300, baseHours: 84, agreedRate: 6000, newRate: 6700,
      revisionRows: [{ hours: 6, rateCents: 6700, deltaCents: 40200 }, { hours: 3, rateCents: 6700, deltaCents: 20100 }],
    })).toBe(683100);
  });

  it("a revision row still at the old rate IS uplifted", () => {
    expect(payChangeTo({
      baseCents: 504000, variationsCents: 36000, baseHours: 84, agreedRate: 6000, newRate: 6700,
      revisionRows: [{ hours: 6, rateCents: 6000, deltaCents: 36000 }],
    })).toBe(504000 + 36000 + 90 * 700);
  });

  it("registers itself and keeps the grants", () => {
    expect(SQL).toContain("grant execute on function public.wo_sync_contractor_pay(uuid, integer, integer, integer, numeric) to authenticated;");
    expect(SQL.trim().endsWith("on conflict (name) do nothing;")).toBe(true);
    expect(SQL).toContain("set lock_timeout = '15s';");
  });
});
