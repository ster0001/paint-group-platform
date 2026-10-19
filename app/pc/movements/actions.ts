"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { isMissingRpc } from "@/lib/supabase/missingRpc";
import { reportError } from "@/lib/monitoring/report";
import {
  BRANCH_KINDS, EQUIPMENT_CATEGORIES, EQUIPMENT_STATUSES, LOGISTICS_DECISIONS, LOGISTICS_LINES,
  MATERIAL_LINE_SOURCES, MOVEMENT_ASSIGNEES, MOVEMENT_KINDS, MOVEMENT_STATUSES, PLACE_KINDS, RUBBISH_HOW,
} from "@/lib/movements/types";

/**
 * Movements — the server boundary (brief §5, Session 1).
 *
 * Every function here is a zod-checked translation over ONE definer RPC from
 * migration 20270279. No rule lives in this file: the lane refusals, the
 * colours-first check, the stranded-gear block and every status transition
 * are the database's. A screen (Session 4+) calls these; nothing else writes
 * a movement.
 */

export type MovementActionResult = { ok: true; value: string } | { ok: false; message: string };

const MIGRATION_NEEDED = "This needs database migration 20270279 run first — nothing was saved.";

const FRIENDLY: Record<string, string> = {
  not_staff: "Only the office can do this.",
  not_found: "That is not there any more — reload the page.",
  not_yours: "That movement is not on your lane.",
  not_a_contractor: "Only the painter it is assigned to can tick this.",
  no_day: "Pick a day first.",
  bad_half: "Pick AM or PM.",
  bad_assignee: "Pick a lane first.",
  supplier_own_gear: "The supplier lane is for orders. Drop our own gear on a person.",
  branch_does_not_deliver: "That branch does not deliver to site — pick a branch that does, or drop the chip on a person who can pick it up.",
  rubbish_undecided: "Say how the rubbish goes first — open the chip.",
  colours_first: "Confirm the colours before ordering the paint.",
  no_order_step: "Nothing to order here: this one is booked by placing it.",
  not_booked: "Only a booked movement can be ticked done.",
  bad_transition: "That change is not allowed from where this movement is.",
  done: "That movement is already done.",
  cancelled: "That movement was cancelled.",
  placed: "That line is on someone's day — bring its chip back to the tray first.",
  rubbish_exists: "This job already has a rubbish chip.",
  no_items: "Pick at least one item from the register.",
  bad_item: "One of those items is not in the register.",
  empty: "Type something first.",
  synced_title: "This chip is written from the job — edit the Materials card or the line instead.",
  not_rubbish: "That is not a rubbish chip.",
  bad_rubbish_how: "Pick one of the three rubbish options.",
  bad_branch: "That branch is not in Settings.",
  bad_dates: "The skip's out day cannot be before its in day.",
  not_that_day: "One of those movements is not on that person's day any more — reload.",
  tag_taken: "That tag is already on another item.",
  in_a_movement: "That item is on a planned movement — finish or cancel it first.",
  target_merged: "That line is already merged into another.",
  not_same_job: "Lines can only be merged within one job.",
  bad_postcode: "A postcode is four digits.",
  bad_time: "Opening time looks wrong — use HH:MM.",
  bad_cost: "A cost cannot be negative.",
};

function friendly(code: string): string {
  const [head, tail] = [code.split(":")[0], code.split(":").slice(1).join(":")];
  if (head === "blocked") return "That gear cannot go out until its return is done — drop the return chip on someone first.";
  if (head === "item_unavailable") return `${tail} is not at the warehouse — check Gear for where it is.`;
  if (head === "item_already_planned") return `${tail} is already on another gear chip.`;
  if (head === "already") return "That was already done.";
  if (head.startsWith("already_")) return "That request was already answered.";
  return FRIENDLY[head] ?? (head.replace(/_/g, " ") || "That did not save.");
}

async function call(fn: string, args: Record<string, unknown>, where: string, revalidate: string[] = []): Promise<MovementActionResult> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc(fn, args);
  if (error) {
    if (isMissingRpc(error.message, fn)) return { ok: false, message: MIGRATION_NEEDED };
    reportError(new Error(error.message), { where, extra: { fn } });
    return { ok: false, message: "That did not save — try again in a moment." };
  }
  const s = String(data ?? "");
  if (s.startsWith("ok")) {
    for (const path of ["/pc/movements", ...revalidate]) revalidatePath(path);
    return { ok: true, value: s.replace(/^ok:?/, "") };
  }
  return { ok: false, message: friendly(s.replace(/^error:/, "")) };
}

const uuid = z.string().uuid();
const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "a date as YYYY-MM-DD");
const clock = z.string().regex(/^\d{2}:\d{2}(:\d{2})?$/, "a time as HH:MM");
const half = z.enum(["AM", "PM"]);
const jobPaths = (workOrderId?: string | null) => (workOrderId ? [`/pc/wo/${workOrderId}`] : []);

function invalid(p: { success: false; error: z.ZodError }): MovementActionResult {
  return { ok: false, message: p.error.issues[0]?.message ?? "That input is not valid." };
}

// ---- the sync ------------------------------------------------------------------------------

export async function syncMovements(raw: unknown): Promise<MovementActionResult> {
  const p = z.object({ workOrderId: uuid }).safeParse(raw);
  if (!p.success) return invalid(p);
  return call("movements_sync_now", { p_work_order_id: p.data.workOrderId }, "movements.sync", jobPaths(p.data.workOrderId));
}

// ---- chips ---------------------------------------------------------------------------------

const place = z.object({ kind: z.enum(PLACE_KINDS).optional(), branchId: uuid.optional(), text: z.string().max(200).optional() });

const createInput = z.object({
  kind: z.enum(MOVEMENT_KINDS),
  workOrderId: uuid.nullable().optional(),
  title: z.string().max(160).optional(),
  detail: z.string().max(300).optional(),
  from: place.optional(),
  to: place.optional(),
  items: z.array(uuid).max(50).optional(),
  note: z.string().max(500).optional(),
  orderRef: z.string().max(40).optional(),
  expectedCostCents: z.number().int().min(0).optional(),
  returnDue: isoDate.optional(),
});

/** + Add a chip: a manual movement in the tray. Gear items are checked against the register by the RPC. */
export async function createMovement(raw: unknown): Promise<MovementActionResult> {
  const p = createInput.safeParse(raw);
  if (!p.success) return invalid(p);
  const d = p.data;
  return call("movement_create", {
    p: {
      kind: d.kind, work_order_id: d.workOrderId ?? null, title: d.title ?? "", detail: d.detail ?? "",
      from: d.from ? { kind: d.from.kind ?? null, branch_id: d.from.branchId ?? null, text: d.from.text ?? "" } : null,
      to: d.to ? { kind: d.to.kind ?? null, branch_id: d.to.branchId ?? null, text: d.to.text ?? "" } : null,
      items: d.items ?? null, note: d.note ?? "", order_ref: d.orderRef ?? "",
      expected_cost_cents: d.expectedCostCents ?? null, return_due: d.returnDue ?? null,
    },
  }, "movements.create", jobPaths(d.workOrderId));
}

const placeInput = z.object({
  id: uuid,
  assigneeKind: z.enum(MOVEMENT_ASSIGNEES),
  assigneeId: uuid.nullable().optional(),
  dueDate: isoDate,
  half: half.nullable().optional(),
  time: clock.nullable().optional(),
  workOrderId: uuid.nullable().optional(),
}).refine((v) => (v.assigneeKind === "supplier") === !v.assigneeId, { message: "A person lane needs a person; the supplier lane has none." });

/** The drop: lane + day (+ half or an exact time on an hourly lane). */
export async function placeMovement(raw: unknown): Promise<MovementActionResult> {
  const p = placeInput.safeParse(raw);
  if (!p.success) return invalid(p);
  const d = p.data;
  return call("movement_place", {
    p_id: d.id, p_assignee_kind: d.assigneeKind, p_assignee_id: d.assigneeId ?? null,
    p_due_date: d.dueDate, p_half: d.half ?? null, p_time: d.time ?? null,
  }, "movements.place", jobPaths(d.workOrderId));
}

const idInput = z.object({ id: uuid, workOrderId: uuid.nullable().optional() });

export async function unplaceMovement(raw: unknown): Promise<MovementActionResult> {
  const p = idInput.safeParse(raw);
  if (!p.success) return invalid(p);
  return call("movement_unplace", { p_id: p.data.id }, "movements.unplace", jobPaths(p.data.workOrderId));
}

/** Ordered ✓ — the order step; paint needs its colours confirmed first (the RPC says so). */
export async function markMovementOrdered(raw: unknown): Promise<MovementActionResult> {
  const p = idInput.safeParse(raw);
  if (!p.success) return invalid(p);
  return call("movement_mark_ordered", { p_id: p.data.id }, "movements.markOrdered", jobPaths(p.data.workOrderId));
}

const statusInput = idInput.extend({ status: z.enum(MOVEMENT_STATUSES), note: z.string().max(500).optional() });

export async function setMovementStatus(raw: unknown): Promise<MovementActionResult> {
  const p = statusInput.safeParse(raw);
  if (!p.success) return invalid(p);
  return call("movement_set_status", { p_id: p.data.id, p_status: p.data.status, p_note: p.data.note ?? "" }, "movements.setStatus", jobPaths(p.data.workOrderId));
}

const redateInput = idInput.extend({ dueDate: isoDate, half: half.nullable().optional() });

export async function redateMovement(raw: unknown): Promise<MovementActionResult> {
  const p = redateInput.safeParse(raw);
  if (!p.success) return invalid(p);
  return call("movement_redate", { p_id: p.data.id, p_due_date: p.data.dueDate, p_half: p.data.half ?? null }, "movements.redate", jobPaths(p.data.workOrderId));
}

const timeInput = idInput.extend({ time: clock.nullable() });

export async function setMovementTime(raw: unknown): Promise<MovementActionResult> {
  const p = timeInput.safeParse(raw);
  if (!p.success) return invalid(p);
  return call("movement_set_time", { p_id: p.data.id, p_time: p.data.time }, "movements.setTime", jobPaths(p.data.workOrderId));
}

const sequenceInput = z.object({
  assigneeKind: z.enum(MOVEMENT_ASSIGNEES), assigneeId: uuid.nullable().optional(), day: isoDate, ids: z.array(uuid).min(1).max(200),
});

/** The run order within a person-day — every id must be that person's on that day. */
export async function setMovementSequence(raw: unknown): Promise<MovementActionResult> {
  const p = sequenceInput.safeParse(raw);
  if (!p.success) return invalid(p);
  return call("movement_set_sequence", {
    p_assignee_kind: p.data.assigneeKind, p_assignee_id: p.data.assigneeId ?? null, p_day: p.data.day, p_ids: p.data.ids,
  }, "movements.setSequence");
}

const updateInput = idInput.extend({
  fromBranchId: uuid.nullable().optional(),
  toBranchId: uuid.nullable().optional(),
  note: z.string().max(500).optional(),
  painterVisible: z.boolean().optional(),
  clientNotice: z.boolean().optional(),
  orderRef: z.string().max(40).optional(),
  expectedCostCents: z.number().int().min(0).nullable().optional(),
  returnDue: isoDate.nullable().optional(),
  time: clock.nullable().optional(),
  title: z.string().max(200).optional(),
  detail: z.string().max(300).optional(),
  rubbishHow: z.enum(RUBBISH_HOW).optional(),
  skip: z.object({ branchId: uuid, inDate: isoDate, outDate: isoDate }).optional(),
});

/** Branch, note, client notice, order ref, cost, text of a manual chip or a materials line, the rubbish answer, the skip. */
export async function updateMovement(raw: unknown): Promise<MovementActionResult> {
  const p = updateInput.safeParse(raw);
  if (!p.success) return invalid(p);
  const d = p.data;
  const patch: Record<string, unknown> = {};
  if (d.fromBranchId !== undefined) patch.from_branch_id = d.fromBranchId;
  if (d.toBranchId !== undefined) patch.to_branch_id = d.toBranchId;
  if (d.note !== undefined) patch.note = d.note;
  if (d.painterVisible !== undefined) patch.painter_visible = d.painterVisible;
  if (d.clientNotice !== undefined) patch.client_notice = d.clientNotice;
  if (d.orderRef !== undefined) patch.order_ref = d.orderRef;
  if (d.expectedCostCents !== undefined) patch.expected_cost_cents = d.expectedCostCents;
  if (d.returnDue !== undefined) patch.return_due = d.returnDue;
  if (d.time !== undefined) patch.time = d.time;
  if (d.title !== undefined) patch.title = d.title;
  if (d.detail !== undefined) patch.detail = d.detail;
  if (d.rubbishHow !== undefined) patch.rubbish_how = d.rubbishHow;
  if (d.skip) patch.skip = { branch_id: d.skip.branchId, in_date: d.skip.inDate, out_date: d.skip.outDate };
  return call("movement_update", { p_id: d.id, p: patch }, "movements.update", jobPaths(d.workOrderId));
}

/** A paint line edit goes through the Materials card's own writer; the sync re-reads the chip. */
const paintLineInput = z.object({
  workOrderId: uuid, rowKey: z.string().min(1).max(200),
  colourName: z.string().max(120).optional(), colourHex: z.string().regex(/^(#[0-9A-Fa-f]{6})?$/).optional(),
  status: z.enum(["tbc", "confirmed"]).optional(), litres: z.number().min(0).max(10000).nullable().optional(),
});

export async function setPaintLine(raw: unknown): Promise<MovementActionResult> {
  const p = paintLineInput.safeParse(raw);
  if (!p.success) return invalid(p);
  const d = p.data;
  return call("wo_set_material", {
    p_work_order_id: d.workOrderId, p_row_key: d.rowKey, p_colour_name: d.colourName ?? "", p_colour_hex: d.colourHex ?? "",
    p_status: d.status ?? "tbc", p_litres: d.litres ?? null,
  }, "movements.setPaintLine", jobPaths(d.workOrderId));
}

const runPlanInput = z.object({ personKind: z.enum(["profiles", "contractors"]), personId: uuid, day: isoDate });

/** Send to phone — a logged stub until Session 5 wires the text. */
export async function sendRunPlan(raw: unknown): Promise<MovementActionResult> {
  const p = runPlanInput.safeParse(raw);
  if (!p.success) return invalid(p);
  return call("movement_send_run_plan", { p_person_kind: p.data.personKind, p_person_id: p.data.personId, p_day: p.data.day }, "movements.sendRunPlan");
}

/** The painter's tick on a movement on their lane (portal; the RPC checks it is theirs). */
export async function painterMovementDone(raw: unknown): Promise<MovementActionResult> {
  const p = idInput.safeParse(raw);
  if (!p.success) return invalid(p);
  return call("movement_painter_done", { p_id: p.data.id }, "movements.painterDone", ["/portal", ...jobPaths(p.data.workOrderId).map((x) => x.replace("/pc/wo/", "/portal/jobs/"))]);
}

// ---- material lines: one list, three doors --------------------------------------------------

const lineAddInput = z.object({ workOrderId: uuid, text: z.string().min(1).max(200), source: z.enum(MATERIAL_LINE_SOURCES).optional() });

export async function addMaterialLine(raw: unknown): Promise<MovementActionResult> {
  const p = lineAddInput.safeParse(raw);
  if (!p.success) return invalid(p);
  return call("material_line_add", { p_work_order_id: p.data.workOrderId, p_text: p.data.text, p_source: p.data.source ?? "pc" }, "movements.lineAdd", jobPaths(p.data.workOrderId));
}

const lineUpdateInput = z.object({ id: uuid, text: z.string().min(1).max(200), workOrderId: uuid.nullable().optional() });

export async function updateMaterialLine(raw: unknown): Promise<MovementActionResult> {
  const p = lineUpdateInput.safeParse(raw);
  if (!p.success) return invalid(p);
  return call("material_line_update", { p_id: p.data.id, p_text: p.data.text }, "movements.lineUpdate", jobPaths(p.data.workOrderId));
}

export async function removeMaterialLine(raw: unknown): Promise<MovementActionResult> {
  const p = idInput.safeParse(raw);
  if (!p.success) return invalid(p);
  return call("material_line_remove", { p_id: p.data.id }, "movements.lineRemove", jobPaths(p.data.workOrderId));
}

const mergeInput = z.object({ ids: z.array(uuid).max(50), into: uuid, workOrderId: uuid.nullable().optional() });

/** Merge lines into one chip; an empty `ids` un-merges everything pointing at `into`. */
export async function mergeMaterialLines(raw: unknown): Promise<MovementActionResult> {
  const p = mergeInput.safeParse(raw);
  if (!p.success) return invalid(p);
  return call("material_line_merge", { p_ids: p.data.ids, p_into: p.data.into }, "movements.lineMerge", jobPaths(p.data.workOrderId));
}

const requestInput = z.object({ requestId: uuid, workOrderId: uuid.nullable().optional() });

/** Accept a painter's materials request as a line (the sync makes its chip). */
export async function acceptMaterialRequest(raw: unknown): Promise<MovementActionResult> {
  const p = requestInput.safeParse(raw);
  if (!p.success) return invalid(p);
  return call("material_request_accept", { p_request_id: p.data.requestId }, "movements.requestAccept", ["/pc", ...jobPaths(p.data.workOrderId)]);
}

const decideInput = z.object({ workOrderId: uuid, line: z.enum(LOGISTICS_LINES), decision: z.enum(LOGISTICS_DECISIONS).nullable() });

/** Not needed / painter supplies — the one stored fact a job holds without a movement. Null clears it. */
export async function decideLogistics(raw: unknown): Promise<MovementActionResult> {
  const p = decideInput.safeParse(raw);
  if (!p.success) return invalid(p);
  return call("wo_logistics_decide", { p_work_order_id: p.data.workOrderId, p_line: p.data.line, p_decision: p.data.decision }, "movements.decide", jobPaths(p.data.workOrderId));
}

// ---- the register ----------------------------------------------------------------------------

const itemCreateInput = z.object({
  name: z.string().min(1).max(120), category: z.enum(EQUIPMENT_CATEGORIES),
  serialOrModel: z.string().max(120).optional(), notes: z.string().max(500).optional(), tag: z.string().max(20).optional(),
});

export async function createEquipmentItem(raw: unknown): Promise<MovementActionResult> {
  const p = itemCreateInput.safeParse(raw);
  if (!p.success) return invalid(p);
  return call("equipment_item_create", {
    p_name: p.data.name, p_category: p.data.category, p_serial_or_model: p.data.serialOrModel ?? "", p_notes: p.data.notes ?? "", p_tag: p.data.tag ?? null,
  }, "movements.itemCreate", ["/settings/equipment"]);
}

const itemUpdateInput = z.object({
  id: uuid, name: z.string().min(1).max(120).optional(), category: z.enum(EQUIPMENT_CATEGORIES).optional(),
  serialOrModel: z.string().max(120).optional(), notes: z.string().max(500).optional(),
});

export async function updateEquipmentItem(raw: unknown): Promise<MovementActionResult> {
  const p = itemUpdateInput.safeParse(raw);
  if (!p.success) return invalid(p);
  const d = p.data;
  const patch: Record<string, unknown> = {};
  if (d.name !== undefined) patch.name = d.name;
  if (d.category !== undefined) patch.category = d.category;
  if (d.serialOrModel !== undefined) patch.serial_or_model = d.serialOrModel;
  if (d.notes !== undefined) patch.notes = d.notes;
  return call("equipment_item_update", { p_id: d.id, p: patch }, "movements.itemUpdate", ["/settings/equipment"]);
}

const itemStatusInput = z.object({ id: uuid, status: z.enum(EQUIPMENT_STATUSES) });

export async function setEquipmentItemStatus(raw: unknown): Promise<MovementActionResult> {
  const p = itemStatusInput.safeParse(raw);
  if (!p.success) return invalid(p);
  return call("equipment_item_set_status", { p_id: p.data.id, p_status: p.data.status }, "movements.itemStatus", ["/settings/equipment"]);
}

// ---- suppliers -------------------------------------------------------------------------------

const branchInput = z.object({
  id: uuid.optional(),
  brand: z.string().min(1).max(80), branch: z.string().min(1).max(80), kind: z.enum(BRANCH_KINDS).optional(),
  address: z.string().max(200).optional(), suburb: z.string().max(80).optional(), postcode: z.string().regex(/^(\d{4})?$/).optional(),
  phone: z.string().max(40).optional(), email: z.string().max(200).optional(), mapPlaceId: z.string().max(200).optional(),
  lat: z.number().nullable().optional(), lng: z.number().nullable().optional(),
  deliversToSite: z.boolean().optional(), opensWeekday: clock.nullable().optional(), favourite: z.boolean().optional(), active: z.boolean().optional(),
  sourceUrl: z.string().max(400).optional(), notes: z.string().max(500).optional(),
});

/** Settings → Suppliers. By id when given, else by (brand, branch). Never touches the account. */
export async function upsertSupplierBranch(raw: unknown): Promise<MovementActionResult> {
  const p = branchInput.safeParse(raw);
  if (!p.success) return invalid(p);
  const d = p.data;
  const payload: Record<string, unknown> = { id: d.id ?? null, brand: d.brand, branch: d.branch, kind: d.kind ?? "paint" };
  const map: [keyof typeof d, string][] = [
    ["address", "address"], ["suburb", "suburb"], ["postcode", "postcode"], ["phone", "phone"], ["email", "email"], ["mapPlaceId", "map_place_id"],
    ["lat", "lat"], ["lng", "lng"], ["deliversToSite", "delivers_to_site"], ["opensWeekday", "opens_weekday"], ["favourite", "favourite"],
    ["active", "active"], ["sourceUrl", "source_url"], ["notes", "notes"],
  ];
  for (const [from, to] of map) if (d[from] !== undefined) payload[to] = d[from];
  return call("supplier_branch_upsert", { p: payload }, "movements.branchUpsert", ["/settings/suppliers"]);
}

const accountInput = z.object({ branchId: uuid, accountRef: z.string().max(80), accountName: z.string().max(120).optional() });

/** The trade account on a branch — staff-only table, masked on screen, never in a file. */
export async function setSupplierBranchAccount(raw: unknown): Promise<MovementActionResult> {
  const p = accountInput.safeParse(raw);
  if (!p.success) return invalid(p);
  return call("supplier_branch_set_account", {
    p_branch_id: p.data.branchId, p_account_ref: p.data.accountRef, p_account_name: p.data.accountName ?? "",
  }, "movements.branchAccount", ["/settings/suppliers"]);
}
