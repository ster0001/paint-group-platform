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
