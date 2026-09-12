import { substrateKeyForRateCode } from "@/lib/estimate/substrates";
import { customerScopeRooms, type CustomerScopeRoom } from "./scope-editor";
import type { ScopeRule } from "@/lib/extract/scope";

/**
 * C15 — THE SPEC SHEET (walk A, screen A3; ⚑12, ⚑36, ⚑59).
 *
 * The same tree as a grid: areas down, surfaces across. This module only
 * READS the tree into rows and says which editor actions a cell tap means —
 * it never changes a block. Every tap posts the room card's own actions
 * (`toggle_surface`, `set_count`, `set_coats`) to the wizard-edit route, so
 * the sheet and the guided room-by-room flow cannot produce different trees
 * for the same input. The parity test in spec-sheet.test.ts asserts exactly
 * that: the sheet's cells agree with the room card's tiles on every room, and
 * the same taps through either surface leave the same tree.
 */

export const SHEET_COLUMNS = ["walls", "ceilings", "trims", "doors", "windows"] as const;
export type SheetColumn = (typeof SHEET_COLUMNS)[number];

/** The substrate keys each column stands for. Trims is the one composite:
 * skirting and architraves are one decision at a desk ("trims two coats"). */
export const COLUMN_KEYS: Record<SheetColumn, string[]> = {
  walls: ["walls"],
  ceilings: ["ceilings"],
  trims: ["skirting", "architraves"],
  doors: ["doors"],
  windows: ["windows"],
};

export type SheetCell =
  | { kind: "coats"; on: boolean; coats: 1 | 2 | 3 | null }
  | { kind: "count"; on: boolean; count: number };

export type SheetRow = {
  areaId: number;
  name: string;
  /** "3.5 × 3.2", or the m² when only the area is known, or "". */
  size: string;
  cells: Record<SheetColumn, SheetCell>;
};

type LooseBlock = Record<string, unknown> & {
  id?: number; kind?: string; name?: string; type?: string; L?: number; W?: number;
  surfaces?: Array<Record<string, unknown>>;
};

const fmt1 = (n: number) => (Math.round(n * 10) / 10).toString();

export function sheetSize(block: { L?: number; W?: number }): string {
  const L = Number(block.L) || 0;
  const W = Number(block.W) || 0;
  if (L > 0 && W > 0) return `${fmt1(L)} × ${fmt1(W)}`;
  return "";
}

/** The tree as sheet rows — inside rooms only; a facade never sits on a sheet (⚑53). */
export function sheetRows(blocks: LooseBlock[]): SheetRow[] {
  return blocks
    .filter((b) => b.kind === "area" && b.type !== "Exterior")
    .map((b) => {
      const surfaces = Array.isArray(b.surfaces) ? b.surfaces : [];
      const lines = (keys: string[]) => surfaces.filter((s) => keys.includes(substrateKeyForRateCode(String(s.code ?? "")) ?? ""));
      const coatsCell = (col: SheetColumn): SheetCell => {
        const ls = lines(COLUMN_KEYS[col]);
        if (!ls.length) return { kind: "coats", on: false, coats: null };
        const c = Number(ls[0].coats);
        return { kind: "coats", on: true, coats: c === 1 || c === 2 || c === 3 ? c : null };
      };
      const countCell = (col: SheetColumn): SheetCell => {
        const ls = lines(COLUMN_KEYS[col]);
        return { kind: "count", on: ls.length > 0, count: ls.reduce((n, s) => n + (Number(s.count) || 1), 0) };
      };
      return {
        areaId: Number(b.id) || 0,
        name: String(b.name ?? "Unnamed"),
        size: sheetSize(b),
        cells: {
          walls: coatsCell("walls"),
          ceilings: coatsCell("ceilings"),
          trims: coatsCell("trims"),
          doors: countCell("doors"),
          windows: countCell("windows"),
        },
      };
    });
}

/**
 * The same rows from the room card's own view — what the client rebuilds
 * after every tap, since the wizard-edit response carries `scopeRooms` and
 * not the tree. `sizes` are carried over from the server-rendered rows: a
 * tap never changes a room's dimensions.
 */
export function sheetRowsFromRooms(rooms: CustomerScopeRoom[], sizes: Record<number, string> = {}): SheetRow[] {
  return rooms.map((room) => {
    const tilesFor = (col: SheetColumn) => room.tiles.filter((t) => t.on && COLUMN_KEYS[col].includes(String(t.key)));
    const coatsCell = (col: SheetColumn): SheetCell => {
      const ts = tilesFor(col);
      if (!ts.length) return { kind: "coats", on: false, coats: null };
      const c = ts[0].coats;
      return { kind: "coats", on: true, coats: c === 1 || c === 2 || c === 3 ? c : null };
    };
    const countCell = (col: SheetColumn): SheetCell => {
      const ts = tilesFor(col);
      return { kind: "count", on: ts.length > 0, count: ts.reduce((n, t) => n + (t.count ?? 1), 0) };
    };
    return {
      areaId: room.areaId,
      name: room.name,
      size: sizes[room.areaId] ?? "",
      cells: {
        walls: coatsCell("walls"), ceilings: coatsCell("ceilings"), trims: coatsCell("trims"),
        doors: countCell("doors"), windows: countCell("windows"),
      },
    };
  });
}

/** One wizard-edit action, in the route's own vocabulary. */
export type SheetAction =
  | { action: "toggle_surface"; areaId: number; key: string; on: boolean }
  | { action: "set_coats"; areaId: number; key: string; coats: 1 | 2 | 3 }
  | { action: "set_count"; areaId: number; key: string; count: number };

/**
 * A tap on a coat cell cycles 1c → 2c → not painted → 1c (the prototype's
 * order). `present` is which of the column's keys the room card currently
 * offers ON — a composite column toggles every key it stands for, so the
 * sheet and the card stay one decision.
 */
export function cycleCoatsActions(row: SheetRow, col: "walls" | "ceilings" | "trims", present: string[]): SheetAction[] {
  const cell = row.cells[col];
  if (cell.kind !== "coats") return [];
  const keys = COLUMN_KEYS[col];
  if (!cell.on) return keys.map((key) => ({ action: "toggle_surface", areaId: row.areaId, key, on: true }));
  if (cell.coats === 1) return present.filter((k) => keys.includes(k)).map((key) => ({ action: "set_coats", areaId: row.areaId, key, coats: 2 }));
  return present.filter((k) => keys.includes(k)).map((key) => ({ action: "toggle_surface", areaId: row.areaId, key, on: false }));
}

/** A tap on a count cell: off → 1, n → n+1 up to 6, then off. */
export function cycleCountActions(row: SheetRow, col: "doors" | "windows"): SheetAction[] {
  const cell = row.cells[col];
  if (cell.kind !== "count") return [];
  const key = COLUMN_KEYS[col][0];
  if (!cell.on) return [{ action: "toggle_surface", areaId: row.areaId, key, on: true }];
  if (cell.count >= 6) return [{ action: "toggle_surface", areaId: row.areaId, key, on: false }];
  return [{ action: "set_count", areaId: row.areaId, key, count: cell.count + 1 }];
}

/** The keys the room card shows ON for a row — what a composite cell acts on. */
export function presentKeys(room: CustomerScopeRoom | undefined): string[] {
  return (room?.tiles ?? []).filter((t) => t.on).map((t) => String(t.key));
}

/**
 * The parity check itself, usable by the page in dev and by the test: every
 * sheet cell agrees with the room card's tiles for the same tree.
 */
export function sheetAgreesWithCards(blocks: LooseBlock[], rules: ScopeRule[]): { ok: true } | { ok: false; why: string } {
  const rows = sheetRows(blocks);
  const cards = customerScopeRooms(blocks, rules);
  for (const row of rows) {
    const card = cards.find((c) => c.areaId === row.areaId);
    if (!card) return { ok: false, why: `room ${row.areaId} is on the sheet but not on a card` };
    for (const col of SHEET_COLUMNS) {
      const on = card.tiles.some((t) => t.on && COLUMN_KEYS[col].includes(String(t.key)));
      if (on !== row.cells[col].on) return { ok: false, why: `${row.name}/${col}: sheet ${row.cells[col].on} vs card ${on}` };
      const cell = row.cells[col];
      if (cell.kind === "count" && cell.on) {
        const count = card.tiles.filter((t) => t.on && COLUMN_KEYS[col].includes(String(t.key))).reduce((n, t) => n + (t.count ?? 1), 0);
        if (count !== cell.count) return { ok: false, why: `${row.name}/${col}: sheet ${cell.count} vs card ${count}` };
      }
    }
  }
  return { ok: true };
}
