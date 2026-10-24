/**
 * The By surface view (work order UX brief §4.1, 24 Oct 2026) — PURE.
 *
 * A painter ticks each surface in each room. On a three-bedroom job that is
 * 24 taps, so this view turns the same rows round: one row per SURFACE GROUP
 * present on the job (all the ceilings, all the walls…), with "n of N" and two
 * buttons — Mark all prepped / Mark all painted — that write the same per-room
 * tick rows a loop of single taps would (ruling R4), through ONE RPC
 * (`wo_tick_surface_group`, 20270300).
 *
 * Nothing here decides which group a row is in. That is resolved once, in
 * Postgres (`wo_surface_groups_assign`), from the job sheet through the finish
 * standards mapping, and stored as `wo_surfaces.group_code`. This module READS
 * that column and holds the labels; `surfaceGroups.test.ts` pins the labels and
 * the key map to the migration file so the two can never drift.
 */
import type { SurfaceRow, SurfaceState } from "./surfaces";

export type SurfaceGroupCode =
  | "ceilings" | "walls" | "trims" | "windows"
  | "ext_body" | "ext_trim" | "ext_openings" | "ext_fence";

export type SurfaceGroupDef = {
  code: SurfaceGroupCode;
  /** The row on the By surface view. */
  painterLabel: string;
  /** What a customer message says (Step 2 reads this). */
  wording: string;
  sort: number;
};

/** Mirror of `surface_groups` in 20270300 — test-pinned. */
export const SURFACE_GROUPS: readonly SurfaceGroupDef[] = [
  { code: "ceilings",     painterLabel: "Ceilings",                 wording: "ceilings",                          sort: 1 },
  { code: "walls",        painterLabel: "Walls",                    wording: "walls",                             sort: 2 },
  { code: "trims",        painterLabel: "Doors, frames & skirting", wording: "doors, frames and skirting boards", sort: 3 },
  { code: "windows",      painterLabel: "Windows",                  wording: "windows",                           sort: 4 },
  { code: "ext_body",     painterLabel: "Weatherboards & render",   wording: "weatherboards and render",          sort: 5 },
  { code: "ext_trim",     painterLabel: "Trims, fascias & eaves",   wording: "trims, fascias and eaves",          sort: 6 },
  { code: "ext_openings", painterLabel: "Doors & windows",          wording: "doors and windows",                 sort: 7 },
  { code: "ext_fence",    painterLabel: "Fences & gates",           wording: "fences and gates",                  sort: 8 },
];

/** Mirror of `surface_group_keys` in 20270300 (standards surface key → group) — test-pinned. */
export const GROUP_OF_STANDARDS_KEY: Readonly<Record<string, SurfaceGroupCode>> = {
  ceilings: "ceilings", cornices: "ceilings",
  walls: "walls",
  skirting: "trims", architraves: "trims", doors: "trims",
  windowframes: "windows",
  weatherboards: "ext_body", brick: "ext_body", render: "ext_body",
  fascias: "ext_trim", eaves: "ext_trim", strapping: "ext_trim", fretwork: "ext_trim",
  extdoors: "ext_openings", extwindows: "ext_openings",
  picket: "ext_fence",
};

export function groupDef(code: string): SurfaceGroupDef | null {
  return SURFACE_GROUPS.find((g) => g.code === code) ?? null;
}

export function isSurfaceGroupCode(v: unknown): v is SurfaceGroupCode {
  return typeof v === "string" && SURFACE_GROUPS.some((g) => g.code === v);
}

const ORDER: readonly SurfaceState[] = ["todo", "prepped", "done"];
const rank = (s: SurfaceState) => ORDER.indexOf(s);

export type GroupRoom = { id: string; heading: string; label: string; state: SurfaceState };

export type GroupView = {
  code: SurfaceGroupCode;
  label: string;
  /** Every in-scope room/row of this surface, document order. */
  rooms: GroupRoom[];
  total: number;
  /** Rows at prepped OR done — "prepped" on the bar means "at least prepped". */
  prepped: number;
  done: number;
  /** The "3 of 3 painted" / "1 of 3 prepped" line. */
  summary: string;
  /** Mark all prepped: something is still todo. Done once every row is at least prepped. */
  prepButton: "next" | "done";
  /** Mark all painted: disabled until every row is prepped (R3), done once every row is done. */
  paintButton: "disabled" | "next" | "done";
};

/**
 * The rows that have a group, folded into one view per group in the brief's
 * order. Struck rows are out (they neither count nor block); rows with no group
 * — rectification, variation additions, lines no standard covers — are not
 * here at all: they are ticked By room, and never trigger a customer message.
 */
export function groupViews(rows: readonly SurfaceRow[]): GroupView[] {
  const byCode = new Map<SurfaceGroupCode, GroupRoom[]>();
  for (const r of rows) {
    if (r.removed || !isSurfaceGroupCode(r.group)) continue;
    const list = byCode.get(r.group) ?? [];
    list.push({ id: r.id, heading: r.heading, label: r.label, state: r.state });
    byCode.set(r.group, list);
  }
  const out: GroupView[] = [];
  for (const g of SURFACE_GROUPS) {
    const rooms = byCode.get(g.code);
    if (!rooms || rooms.length === 0) continue;
    const total = rooms.length;
    const prepped = rooms.filter((r) => rank(r.state) >= 1).length;
    const done = rooms.filter((r) => r.state === "done").length;
    const allPrepped = prepped === total;
    out.push({
      code: g.code,
      label: g.painterLabel,
      rooms,
      total,
      prepped,
      done,
      summary: done > 0 || allPrepped ? `${done} of ${total} painted` : `${prepped} of ${total} prepped`,
      prepButton: allPrepped ? "done" : "next",
      paintButton: done === total ? "done" : allPrepped ? "next" : "disabled",
    });
  }
  return out;
}

/** True when the By surface view has anything to show (else the list opens By room with no toggle). */
export function hasGroups(rows: readonly SurfaceRow[]): boolean {
  return rows.some((r) => !r.removed && isSurfaceGroupCode(r.group));
}

/**
 * The rows a bulk tap to `to` would move — the SAME set the RPC moves (R5: rows
 * at or past the target are skipped). Used by the screen to update itself and
 * by the golden test that compares it to a loop of single ticks.
 */
export function bulkTargets(rows: readonly SurfaceRow[], code: SurfaceGroupCode, to: Exclude<SurfaceState, "todo">): SurfaceRow[] {
  return rows.filter((r) => !r.removed && r.group === code && rank(r.state) < rank(to));
}

/** R3 on the client, so the button can say why before the server does. */
export function paintBlocked(rows: readonly SurfaceRow[], code: SurfaceGroupCode): boolean {
  return rows.some((r) => !r.removed && r.group === code && r.state === "todo");
}

/** "Bed 1 painted · Bed 2 prepped · Bed 3 prepped" — the expanded line under a row. */
export const ROOM_STATE_WORD: Record<SurfaceState, string> = { todo: "not started", prepped: "prepped", done: "painted" };

/** The toast after a bulk tap: "3 walls marked prepped". */
export function bulkToast(label: string, count: number, to: Exclude<SurfaceState, "todo">): string {
  return `${count} ${label.toLowerCase()} marked ${to === "done" ? "painted" : "prepped"}`;
}

/** How long the Undo stays on screen (R6) and how long the server honours it. */
export const UNDO_SHOWN_MS = 6_000;
export const UNDO_VALID_MS = 60_000;

/** The remembered view, per browser (R2: local, not a Settings value). */
export const VIEW_STORAGE_KEY = "wo:tick-view";
export type TickView = "surface" | "room";
export function viewFromStorage(raw: string | null | undefined): TickView {
  return raw === "room" ? "room" : "surface";
}
