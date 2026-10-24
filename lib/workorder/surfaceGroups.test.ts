import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import {
  GROUP_OF_STANDARDS_KEY, SURFACE_GROUPS, bulkTargets, bulkToast, groupViews, hasGroups, paintBlocked,
  viewFromStorage,
} from "./surfaceGroups";
import { SURFACE_CODES } from "@/lib/standards/codes";
import type { SurfaceRow } from "./surfaces";

const MIGRATION = resolve(__dirname, "../../supabase/migrations/20270300000000_wo_surface_groups.sql");

const row = (id: string, heading: string, label: string, state: SurfaceRow["state"], group: string | null, extra: Partial<SurfaceRow> = {}): SurfaceRow =>
  ({ id, heading, label, state, group, ...extra });

describe("surface groups — mirror of 20270300 (one mapping, two readers)", () => {
  const sql = readFileSync(MIGRATION, "utf8");

  it("every group in SURFACE_GROUPS is seeded in the migration with the same wording and label, and nothing else is", () => {
    const seeded = [...sql.matchAll(/^\s*\('([a-z_]+)',\s*'([^']+)',\s*'([^']+)',\s*(\d+)\)/gm)]
      .map((m) => ({ code: m[1], wording: m[2], painterLabel: m[3], sort: Number(m[4]) }));
    expect(seeded).toHaveLength(8);
    expect(seeded).toEqual(SURFACE_GROUPS.map((g) => ({ code: g.code, wording: g.wording, painterLabel: g.painterLabel, sort: g.sort })));
  });

  it("every standards key → group pair is in the migration, and the migration has no pair the module lacks", () => {
    const block = sql.slice(sql.indexOf("insert into public.surface_group_keys"), sql.indexOf("on conflict (standards_key)"));
    const pairs = [...block.matchAll(/\('([a-z]+)',\s*'([a-z_]+)'\)/g)].map((m) => [m[1], m[2]] as const);
    expect(Object.fromEntries(pairs)).toEqual(GROUP_OF_STANDARDS_KEY);
  });

  it("every finish-standards surface has a group (the brief maps all 17)", () => {
    expect(Object.keys(GROUP_OF_STANDARDS_KEY).sort()).toEqual(Object.keys(SURFACE_CODES).sort());
  });

  it("interior keys land in interior groups and exterior keys in ext_ groups", () => {
    for (const [key, group] of Object.entries(GROUP_OF_STANDARDS_KEY)) {
      const side = SURFACE_CODES[key].side;
      expect(group.startsWith("ext_"), `${key} → ${group}`).toBe(side === "exterior");
    }
  });
});

describe("groupViews — one row per surface present on the job", () => {
  const rows: SurfaceRow[] = [
    row("c1", "Bed 1", "Ceilings", "done", "ceilings"),
    row("c2", "Bed 2", "Ceilings", "done", "ceilings"),
    row("w1", "Bed 1", "Walls", "done", "walls"),
    row("w2", "Bed 2", "Walls", "prepped", "walls"),
    row("w3", "Bed 3", "Walls", "prepped", "walls"),
    row("t1", "Bed 1", "Skirting Boards", "todo", "trims"),
    row("t2", "Bed 2", "Skirting Boards", "todo", "trims"),
    row("x1", "Hall", "Gutters", "todo", null),                          // no standard → By room only
    row("r1", "Bed 1", "Walls", "todo", null, { rectification: true }),  // rectification → By room only
    row("s1", "Bed 3", "Ceilings", "todo", "ceilings", { removed: true }), // struck → out of the working set
  ];

  it("folds rows by group in the brief's order, counting struck rows out", () => {
    const views = groupViews(rows);
    expect(views.map((v) => v.code)).toEqual(["ceilings", "walls", "trims"]);
    const [ceil, walls, trims] = views;
    expect(ceil).toMatchObject({ total: 2, prepped: 2, done: 2, summary: "2 of 2 painted", prepButton: "done", paintButton: "done" });
    expect(walls).toMatchObject({ total: 3, prepped: 3, done: 1, summary: "1 of 3 painted", prepButton: "done", paintButton: "next" });
    expect(trims).toMatchObject({ total: 2, prepped: 0, done: 0, summary: "0 of 2 prepped", prepButton: "next", paintButton: "disabled" });
  });

  it("the expanded line lists every room with its state, in document order", () => {
    const walls = groupViews(rows).find((v) => v.code === "walls")!;
    expect(walls.rooms.map((r) => `${r.heading} ${r.state}`)).toEqual(["Bed 1 done", "Bed 2 prepped", "Bed 3 prepped"]);
  });

  it("a half-prepped surface reads as prepped progress until the first room is painted", () => {
    const v = groupViews([row("a", "Bed 1", "Walls", "prepped", "walls"), row("b", "Bed 2", "Walls", "todo", "walls")]);
    expect(v[0]).toMatchObject({ summary: "1 of 2 prepped", prepButton: "next", paintButton: "disabled" });
  });

  it("R3 — Mark all painted is disabled while any room is todo, and paintBlocked says so", () => {
    expect(paintBlocked(rows, "trims")).toBe(true);
    expect(paintBlocked(rows, "walls")).toBe(false);
  });

  it("hasGroups is false when nothing on the job has a group (an old or rectification-only list)", () => {
    expect(hasGroups(rows)).toBe(true);
    expect(hasGroups([row("x", "Hall", "Gutters", "todo", null)])).toBe(false);
    expect(hasGroups([row("s", "Bed", "Walls", "todo", "walls", { removed: true })])).toBe(false);
  });

  it("R5 — bulkTargets are exactly the in-scope rows below the target", () => {
    expect(bulkTargets(rows, "walls", "done").map((r) => r.id)).toEqual(["w2", "w3"]);
    expect(bulkTargets(rows, "walls", "prepped").map((r) => r.id)).toEqual([]);
    expect(bulkTargets(rows, "trims", "prepped").map((r) => r.id)).toEqual(["t1", "t2"]);
    // the struck ceiling is never a target
    expect(bulkTargets(rows, "ceilings", "done")).toEqual([]);
  });

  it("the toast says what moved in the painter's words", () => {
    expect(bulkToast("Walls", 2, "done")).toBe("2 walls marked painted");
    expect(bulkToast("Doors, frames & skirting", 4, "prepped")).toBe("4 doors, frames & skirting marked prepped");
  });

  it("the remembered view defaults to By surface (R2)", () => {
    expect(viewFromStorage(null)).toBe("surface");
    expect(viewFromStorage("garbage")).toBe("surface");
    expect(viewFromStorage("room")).toBe("room");
  });
});
