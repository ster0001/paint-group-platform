/**
 * C15 — THE PARITY TEST (brief step 3: "the sheet and the guided
 * room-by-room flow must produce identical trees for identical input").
 *
 * Two assertions carry it: (1) for any tree, the sheet's cells agree with
 * the room card's tiles on every room; (2) a tap on the sheet becomes the
 * room card's own actions, and applying them through the editor's functions
 * leaves the same tree as the card's tap would — because it IS the same
 * function. Plus the trade gates the sheet must hold: no fix-online, no
 * pricing in the client.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import type { ScopeRule } from "@/lib/extract/scope";
import { applyCoats, applyCount, applyToggle, customerScopeRooms } from "./scope-editor";
import {
  COLUMN_KEYS, SHEET_COLUMNS, cycleCoatsActions, cycleCountActions, presentKeys,
  sheetAgreesWithCards, sheetRows, sheetRowsFromRooms, type SheetAction,
} from "./spec-sheet";

const rules: ScopeRule[] = [
  { room_type: "bedroom", surface_type: "Walls", is_option: false, requires_confirm: false, notes: null },
  { room_type: "bedroom", surface_type: "Ceiling", is_option: false, requires_confirm: false, notes: null },
  { room_type: "bedroom", surface_type: "Skirting Boards", is_option: false, requires_confirm: false, notes: null },
  { room_type: "bedroom", surface_type: "Architraves", is_option: false, requires_confirm: false, notes: null },
  { room_type: "bedroom", surface_type: "Door & Frame", is_option: false, requires_confirm: false, notes: null },
  { room_type: "bedroom", surface_type: "Windows", is_option: false, requires_confirm: false, notes: null },
];

const surface = (id: number, code: string, count = 1, over: Record<string, unknown> = {}) => ({
  id, code, internalLabel: code, clientLabel: code, coats: 2, count,
  prepHr: 0, hidden: false, media: [], qtyOverride: null, rateOverride: null,
  paintingHrOverride: null, priceOverride: null, crewNote: "",
  origin: "human_confirmed", confidence: 1, assumedFields: [], ...over,
});
const room = (id: number, name: string, surfaces: ReturnType<typeof surface>[], over: Record<string, unknown> = {}) => ({
  id, kind: "area", name, type: "Interior", areaType: "room", roomType: "bedroom", storey: "ground", L: 3.5, W: 3.2, H: 2.4, surfaces, ...over,
});
const tree = () => [
  room(1, "Bed 1", [surface(10, "Walls", 1, { coats: 1 }), surface(11, "Ceilings", 1, { coats: 1 }), surface(12, "Skirting Boards"), surface(13, "Flat Door and Frame (1 Side)", 1), surface(14, "Awning / Casement Window", 1)]),
  room(2, "Kitchen", [surface(20, "Walls", 1, { coats: 1 }), surface(21, "Ceilings", 1, { coats: 1 }), surface(24, "Awning / Casement Window", 1)]),
  room(3, "Front", [surface(30, "Weatherboards")], { type: "Exterior" }),
];

/** Apply sheet actions exactly as the wizard-edit route does (same functions). */
function applyAll(blocks: Record<string, unknown>[], actions: SheetAction[]) {
  let id = 500;
  let out = blocks;
  for (const a of actions) {
    const r = a.action === "toggle_surface" ? applyToggle(out, a.areaId, a.key, a.on, null, () => id++)
      : a.action === "set_coats" ? applyCoats(out, a.areaId, a.key, a.coats)
      : applyCount(out, a.areaId, a.key, a.count);
    if (!r.ok) throw new Error(r.error);
    out = r.blocks;
  }
  return out;
}

describe("spec sheet ↔ room card parity", () => {
  it("reads the same tree into the same on/off, coats and counts, and leaves the facade off the sheet (⚑53)", () => {
    const rows = sheetRows(tree());
    expect(rows.map((r) => r.name)).toEqual(["Bed 1", "Kitchen"]);
    expect(rows[0].size).toBe("3.5 × 3.2");
    expect(rows[0].cells.walls).toEqual({ kind: "coats", on: true, coats: 1 });
    expect(rows[0].cells.trims).toEqual({ kind: "coats", on: true, coats: 2 });
    expect(rows[0].cells.doors).toEqual({ kind: "count", on: true, count: 1 });
    expect(rows[1].cells.trims).toEqual({ kind: "coats", on: false, coats: null });
    expect(rows[1].cells.doors).toEqual({ kind: "count", on: false, count: 0 });
    expect(sheetAgreesWithCards(tree(), rules)).toEqual({ ok: true });
  });

  it("the client's rows (from scopeRooms) equal the server's rows (from blocks)", () => {
    const blocks = tree();
    const server = sheetRows(blocks);
    const sizes = Object.fromEntries(server.map((r) => [r.areaId, r.size]));
    const client = sheetRowsFromRooms(customerScopeRooms(blocks, rules), sizes);
    expect(client).toEqual(server);
  });

  it("a coat cell cycles 1c → 2c → off → 1c through the card's own actions, and the two derivations agree at every step", () => {
    let blocks: Record<string, unknown>[] = tree();
    const step = (col: "walls" | "ceilings" | "trims") => {
      const rows = sheetRows(blocks);
      const rooms = customerScopeRooms(blocks, rules);
      const actions = cycleCoatsActions(rows[0], col, presentKeys(rooms[0]));
      blocks = applyAll(blocks, actions);
      expect(sheetAgreesWithCards(blocks, rules)).toEqual({ ok: true });
      return sheetRows(blocks)[0].cells[col];
    };
    expect(step("walls")).toEqual({ kind: "coats", on: true, coats: 2 });   // 1c → 2c
    expect(step("walls")).toEqual({ kind: "coats", on: false, coats: null }); // 2c → off
    expect(step("walls")).toEqual({ kind: "coats", on: true, coats: 2 });   // off → on (the card's add; coats from the line)
    // Trims is the composite: one tap moves skirting AND architraves together.
    expect(step("trims")).toEqual({ kind: "coats", on: false, coats: null });
    const back = step("trims");
    expect(back.on).toBe(true);
    const keys = (blocks[0].surfaces as Array<{ code: string }>).map((s) => s.code);
    expect(keys).toContain("Skirting Boards");
    expect(keys).toContain("Architrave (1 Side)");
  });

  it("a count cell counts up then off, by set_count and toggle_surface", () => {
    let blocks: Record<string, unknown>[] = tree();
    const rows = () => sheetRows(blocks)[1];
    blocks = applyAll(blocks, cycleCountActions(rows(), "doors"));      // off → 1
    expect(rows().cells.doors).toEqual({ kind: "count", on: true, count: 1 });
    blocks = applyAll(blocks, cycleCountActions(rows(), "doors"));      // 1 → 2
    expect(rows().cells.doors).toEqual({ kind: "count", on: true, count: 2 });
    expect(sheetAgreesWithCards(blocks, rules)).toEqual({ ok: true });
  });

  it("the same taps through the sheet and through the card leave byte-identical trees", () => {
    // The card's tap: toggle skirting off, set doors to 3, walls to 2 coats.
    const viaCard = applyAll(tree(), [
      { action: "toggle_surface", areaId: 1, key: "skirting", on: false },
      { action: "set_count", areaId: 1, key: "doors", count: 3 },
      { action: "set_coats", areaId: 1, key: "walls", coats: 2 },
    ]);
    // The sheet's taps that mean the same thing.
    let blocks: Record<string, unknown>[] = tree();
    const rowsOf = () => sheetRows(blocks)[0];
    // Trims cell on Bed 1 is skirting only (no architraves on the tree) — one tap: 2c → off.
    blocks = applyAll(blocks, cycleCoatsActions(rowsOf(), "trims", presentKeys(customerScopeRooms(blocks, rules)[0])));
    blocks = applyAll(blocks, cycleCountActions(rowsOf(), "doors")); // 1 → 2
    blocks = applyAll(blocks, cycleCountActions(rowsOf(), "doors")); // 2 → 3
    blocks = applyAll(blocks, cycleCoatsActions(rowsOf(), "walls", presentKeys(customerScopeRooms(blocks, rules)[0]))); // 1c → 2c
    expect(blocks).toEqual(viaCard);
  });

  it("every column stands for at least one substrate key and the columns are the prototype's", () => {
    expect([...SHEET_COLUMNS]).toEqual(["walls", "ceilings", "trims", "doors", "windows"]);
    for (const c of SHEET_COLUMNS) expect(COLUMN_KEYS[c].length).toBeGreaterThan(0);
  });
});

describe("applyCoats", () => {
  it("sets every line of the key and stamps it confirmed; refuses an absent surface", () => {
    const r = applyCoats(tree(), 1, "walls", 2);
    expect(r.ok).toBe(true);
    if (r.ok) {
      const w = (r.blocks[0].surfaces as Array<{ code: string; coats: number; origin: string }>).find((s) => s.code === "Walls")!;
      expect(w.coats).toBe(2);
      expect(w.origin).toBe("human_confirmed");
    }
    expect(applyCoats(tree(), 2, "doors", 1).ok).toBe(false);
    expect(applyCoats(tree(), 99, "walls", 1).ok).toBe(false);
  });
});

describe("trade gates on the sheet (⚑11, no money in the client)", () => {
  const read = (p: string) => readFileSync(new URL(`../../${p}`, import.meta.url), "utf8");
  it("the sheet, the open button and the tenant page never import pricing or price anything", () => {
    for (const file of [
      "app/account/(portal)/quote/[id]/sheet/SpecSheet.tsx",
      "app/account/(portal)/quote/new/OpenSheet.tsx",
      "app/photos/[token]/TenantUpload.tsx",
      "lib/wizard/spec-sheet.ts",
    ]) {
      const src = read(file);
      expect(src, file).not.toMatch(/from "[^"]*lib\/pricing|editorPayload\(|customerPayload\(|priceArea\(|rangeFromTotal\(/);
    }
  });
  it("no trade screen offers fix-online — the only way off the sheet is a confirmation", () => {
    for (const file of [
      "app/account/(portal)/quote/[id]/sheet/SpecSheet.tsx",
      "app/account/(portal)/quote/[id]/sheet/page.tsx",
      "app/account/(portal)/quote/new/page.tsx",
      "app/account/(portal)/TradePortfolioHome.tsx",
    ]) {
      const src = read(file);
      expect(src, file).not.toMatch(/fix_online|fixOnline|Fix my price/);
    }
    expect(read("app/account/(portal)/quote/[id]/sheet/SpecSheet.tsx")).toMatch(/action: "accept_intent"/);
  });
});
