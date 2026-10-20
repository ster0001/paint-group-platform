/**
 * Movements — the shared vocabulary (brief docs/briefs/claude-code-brief-pc-movements.md §3.1).
 *
 * These unions mirror the Postgres enums created by migration 20270279. The
 * database is the one writer of every status (the RPCs in that file); this
 * module only names the values so zod, the loaders and the evaluator (Session
 * 3) agree on the spelling. Nothing here computes a chip, a colour or a count.
 */

export const MOVEMENT_KINDS = [
  "paint", "materials", "equipment_out", "equipment_return", "hire_on", "hire_off",
  "rubbish_in", "rubbish_out", "restock", "repair_out", "repair_back", "other",
] as const;
export type MovementKind = (typeof MOVEMENT_KINDS)[number];

export const MOVEMENT_STATUSES = ["tray", "planned", "booked", "done", "problem", "cancelled"] as const;
export type MovementStatus = (typeof MOVEMENT_STATUSES)[number];

export const MOVEMENT_ASSIGNEES = ["supplier", "person"] as const;
export type MovementAssignee = (typeof MOVEMENT_ASSIGNEES)[number];

export const PLACE_KINDS = ["branch", "warehouse", "site", "person", "tip", "other"] as const;
export type PlaceKind = (typeof PLACE_KINDS)[number];

export const BRANCH_KINDS = ["paint", "hardware", "hire", "other"] as const;
export type BranchKind = (typeof BRANCH_KINDS)[number];

/** Tom's nine register types + other (ruling 18). A new category needs an icon first. */
export const EQUIPMENT_CATEGORIES = [
  "step_ladder", "ext_ladder_7", "ext_ladder_10", "platform_ladder", "spray_gun",
  "planex_sander", "festool_vacuum", "mobile_scaffold", "fall_protection", "other",
] as const;
export type EquipmentCategory = (typeof EQUIPMENT_CATEGORIES)[number];

export const EQUIPMENT_STATUSES = ["active", "repair", "retired", "lost"] as const;
export type EquipmentStatus = (typeof EQUIPMENT_STATUSES)[number];

export const MATERIAL_LINE_SOURCES = ["estimate", "pc", "painter_request"] as const;
export type MaterialLineSource = (typeof MATERIAL_LINE_SOURCES)[number];

export const LOGISTICS_LINES = ["paint", "materials", "equipment", "rubbish"] as const;
export type LogisticsLine = (typeof LOGISTICS_LINES)[number];

export const LOGISTICS_DECISIONS = ["not_needed", "painter_supplies"] as const;
export type LogisticsDecision = (typeof LOGISTICS_DECISIONS)[number];

/** Ruling 20: the rubbish question on the chip. `none` records not_needed and cancels the chip. */
export const RUBBISH_HOW = ["none", "painter_disposed", "painter_warehouse", "left_on_site"] as const;
export type RubbishHow = (typeof RUBBISH_HOW)[number];

/** The tables migration 20270279 created. The boundary test greps for direct writes to them. */
export const MOVEMENTS_TABLES = [
  "movements", "movement_items", "wo_material_lines", "wo_logistics_decisions",
  "equipment_items", "supplier_branches", "supplier_branch_accounts",
] as const;

// ---- row shapes the loader reads and the evaluator / sync mirror consume (Session 3) ----
// Column names as the tables spell them, so a row read through PostgREST needs no mapping.

/** One `lines` entry a paint chip freezes at ordering (brief §3.1), and the live rows before. */
export type MovementLine = {
  rowKey: string; product: string; colourName: string | null; colourHex: string | null;
  colourStatus: string | null; litres: number | null; cans: number;
};

export type MovementItemRow = { movement_id: string; equipment_item_id: string; label: string };

export type MovementRow = {
  id: string;
  work_order_id: string | null;
  kind: MovementKind;
  source_key: string | null;
  title: string;
  detail: string | null;
  assignee_kind: MovementAssignee | null;
  assignee_table: "profiles" | "contractors" | null;
  assignee_id: string | null;
  due_date: string | null;
  half: "AM" | "PM" | null;
  time: string | null;
  sequence: number | null;
  from_kind: PlaceKind | null;
  from_branch_id: string | null;
  from_text: string;
  to_kind: PlaceKind | null;
  to_branch_id: string | null;
  to_text: string;
  status: MovementStatus;
  ordered_at: string | null;
  client_notice: boolean;
  order_ref: string;
  lines: MovementLine[] | null;
  planned_for_start: string | null;
  return_due: string | null;
  blocked_by_movement_id: string | null;
  expected_cost_cents: number | null;
  note: string;
  problem_note: string;
  painter_confirmed_at: string | null;
  source_changed_at: string | null;
  booked_at: string | null;
  done_at: string | null;
  created_at: string;
  updated_at: string;
  /** The gear on it (movement_items), carried by the loader. */
  items: MovementItemRow[];
};

export type BranchRow = {
  id: string; brand: string; branch: string; kind: BranchKind; address: string; suburb: string;
  phone: string; lat: number | null; lng: number | null; delivers_to_site: boolean;
  opens_weekday: string | null; favourite: boolean; active: boolean;
};

export type EquipmentItemRow = {
  id: string; tag: string; name: string; category: EquipmentCategory; serial_or_model: string; status: EquipmentStatus;
};

export type MaterialLineRow = {
  id: string; work_order_id: string; text: string; source: MaterialLineSource; sort: number;
  merged_into: string | null; created_at: string;
};

export type LogisticsDecisionRow = { work_order_id: string; line: LogisticsLine; decision: LogisticsDecision };

/** A point on the map (suburb centroid in v1; work_orders.lat/lng when ⚑3 lands). */
export type Point = { lat: number; lng: number };

/** The settings row `movements` (migration 20270279 §8). */
export type BoardPerson = { id: string; slots?: "half" | "hour"; colour?: string; checks?: boolean };
export type MovementsSettings = {
  warehouse: { label: string; address: string; suburb: string; postcode: string; lat: number | null; lng: number | null };
  nearKm: number;
  planningHorizonDays: number;
  deliveryConfirmBy: string;
  boardPeople: BoardPerson[];
  showHowItWorks: boolean;
  recordHireCosts: boolean;
  defaultHalfTime: { AM: string; PM: string };
};

export const DEFAULT_MOVEMENTS_SETTINGS: MovementsSettings = {
  warehouse: { label: "Warehouse", address: "", suburb: "", postcode: "", lat: null, lng: null },
  nearKm: 7,
  planningHorizonDays: 7,
  deliveryConfirmBy: "10:00",
  boardPeople: [],
  showHowItWorks: true,
  recordHireCosts: true,
  defaultHalfTime: { AM: "07:00", PM: "13:00" },
};

/** The settings row as stored, with every missing or malformed field falling back to the default. */
export function movementsSettingsFrom(value: unknown): MovementsSettings {
  const v = (value && typeof value === "object" ? value : {}) as Record<string, unknown>;
  const d = DEFAULT_MOVEMENTS_SETTINGS;
  const wh = (v.warehouse && typeof v.warehouse === "object" ? v.warehouse : {}) as Record<string, unknown>;
  const num = (x: unknown, fallback: number) => (typeof x === "number" && Number.isFinite(x) ? x : fallback);
  const str = (x: unknown, fallback: string) => (typeof x === "string" ? x : fallback);
  const half = (v.defaultHalfTime && typeof v.defaultHalfTime === "object" ? v.defaultHalfTime : {}) as Record<string, unknown>;
  const people = Array.isArray(v.boardPeople) ? v.boardPeople : [];
  return {
    warehouse: {
      label: str(wh.label, d.warehouse.label), address: str(wh.address, ""), suburb: str(wh.suburb, ""), postcode: str(wh.postcode, ""),
      lat: typeof wh.lat === "number" ? wh.lat : null, lng: typeof wh.lng === "number" ? wh.lng : null,
    },
    nearKm: num(v.nearKm, d.nearKm),
    planningHorizonDays: num(v.planningHorizonDays, d.planningHorizonDays),
    deliveryConfirmBy: str(v.deliveryConfirmBy, d.deliveryConfirmBy),
    boardPeople: people.flatMap((p): BoardPerson[] => {
      if (typeof p === "string") return [{ id: p }];
      if (!p || typeof p !== "object" || typeof (p as { id?: unknown }).id !== "string") return [];
      const o = p as Record<string, unknown>;
      return [{
        id: o.id as string,
        slots: o.slots === "hour" ? "hour" : o.slots === "half" ? "half" : undefined,
        colour: typeof o.colour === "string" ? o.colour : undefined,
        checks: typeof o.checks === "boolean" ? o.checks : undefined,
      }];
    }),
    showHowItWorks: typeof v.showHowItWorks === "boolean" ? v.showHowItWorks : d.showHowItWorks,
    recordHireCosts: typeof v.recordHireCosts === "boolean" ? v.recordHireCosts : d.recordHireCosts,
    defaultHalfTime: { AM: str(half.AM, d.defaultHalfTime.AM), PM: str(half.PM, d.defaultHalfTime.PM) },
  };
}
