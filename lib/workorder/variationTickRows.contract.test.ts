/**
 * 20270193 as a contract: an approved variation with site work becomes tick
 * rows, on every approval path, and a re-issue keeps them (Tom, 23 Sep 2026).
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { diffRevision, type RevisionState } from "../revision/diff";
import type { PricingContext } from "../pricing/estimate";

const SQL = readFileSync(
  resolve(process.cwd(), "supabase/migrations/20270193000000_variation_tick_rows.sql"),
  "utf8",
);
const fn = (name: string) => {
  const start = SQL.indexOf(`function public.${name}(`);
  expect(start, `${name} is defined in 20270193`).toBeGreaterThan(-1);
  return SQL.slice(start, SQL.indexOf("$$;", start));
};

describe("approved variations become tick rows", () => {
  const apply = fn("wo_apply_variation_surfaces");

  it("a credit never adds; no site hours never adds; only approved rows add", () => {
    expect(apply).toMatch(/if coalesce\(v_v\.credit, false\) then return 0/);
    expect(apply).toMatch(/if coalesce\(v_v\.est_hours, 0\) <= 0 then return 0/);
    expect(apply).toContain("if v_v.status not in ('customer_approved', 'contractor_accepted') then return 0");
  });

  it("keyed rows come from priced_inputs.surfaces; a keyless variation is one row in the painter's words", () => {
    expect(apply).toContain("v_v.priced_inputs -> 'surfaces'");
    expect(apply).toContain("'variation:' || v_v.id::text");
    expect(apply).toContain("'heading', 'Variations'");
  });

  it("an added-back row is un-struck, never duplicated, and nobody's tick is reset", () => {
    expect(apply).toMatch(/on conflict \(work_order_id, surface_key\) where surface_key is not null\s+do update set removed_from_scope = false/);
    expect(apply).toContain("state deliberately untouched");
    expect(apply).not.toMatch(/do update set[\s\S]{0,400}state = /);
  });

  it("one trigger covers update AND insert approval paths; the apply function is internal", () => {
    expect(SQL).toMatch(/create trigger wo_variations_tick_rows\s+after update of status on public\.wo_variations/);
    expect(SQL).toMatch(/create trigger wo_variations_tick_rows_insert\s+after insert on public\.wo_variations/);
    expect(SQL).toContain("revoke all on function public.wo_apply_variation_surfaces(uuid) from public, anon, authenticated");
  });

  it("a re-issue keeps rows a variation added", () => {
    const seed = fn("wo_seed_surfaces");
    expect(seed).toMatch(/delete from public\.wo_surfaces s[\s\S]{0,400}and s\.added_by_variation is null/);
  });

  it("the backfill touches only open jobs, with hours, with no rows yet", () => {
    expect(SQL).toMatch(/w\.stage <> 'closed'[\s\S]{0,200}not exists \(select 1 from public\.wo_surfaces s where s\.added_by_variation = x\.id\)/);
  });
});

describe("the revision diff carries the rows an addition brings", () => {
  const wall = (id: number, label: string) => ({
    id, code: "WALL", coats: 2, count: 0, prepHr: 1, internalLabel: label, clientLabel: label,
  });
  const area = (id: number, name: string, surfaces: ReturnType<typeof wall>[]) => ({
    kind: "area", id, name, type: "Interior", areaType: "room", L: 4, W: 4, H: 2.4, surfaces,
  });
  // A minimal context: one rate item the engine can price WALL with.
  const ctx = {
    rateItems: [{ id: "r1", rate_card_id: "c", code: "WALL", name: "Walls", unit: "m2", rate_cents: 2500, labour_pct: 60, active: true }],
    products: [], modifiers: [], settings: [],
  } as unknown as PricingContext;

  it("a new area lists every surface with the area's heading; a changed area only the new ones; a removal none", () => {
    const accepted = { blocks: [area(1, "Lounge", [wall(11, "Walls")]), area(2, "Pergola", [wall(21, "Posts")])] } as RevisionState;
    const working = {
      blocks: [area(1, "Lounge", [wall(11, "Walls"), wall(12, "Ceiling")]), area(3, "Garage", [wall(31, "Walls"), wall(32, "Door")])],
    } as RevisionState;
    const diff = diffRevision(accepted, working, ctx);
    const byRef = new Map(diff.changes.map((c) => [c.blockRef, c]));
    expect(byRef.get("block:3")?.addedSurfaces).toEqual([
      { key: "3:31", heading: "Garage", label: "Walls" },
      { key: "3:32", heading: "Garage", label: "Door" },
    ]);
    expect(byRef.get("block:1")?.addedSurfaces).toEqual([{ key: "1:12", heading: "Lounge", label: "Ceiling" }]);
    expect(byRef.get("block:2")?.addedSurfaces).toEqual([]);
    expect(byRef.get("block:2")?.surfaceKeys).toEqual(["2:21"]);
  });
});
