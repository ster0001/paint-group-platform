"use server";

import { revalidatePath } from "next/cache";
import { after } from "next/server";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { isMissingRpc } from "@/lib/supabase/missingRpc";
import { reportError } from "@/lib/monitoring/report";
import { createServiceClient } from "@/lib/supabase/service";
import { notifyMovementOrdered, notifyRunPlan } from "@/lib/movements/notify";
import { geocodeAddress } from "@/lib/places/geocodeAddress";
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
  bad_point: "That is not a place on the map.",
  no_shop: "Pick the shop in the chip first — an order with no shop is not a delivery yet.",
  bad_method: "Delivered or picked up — one of the two.",
  not_an_order: "Only a paint or materials chip has a shop and a method.",
  no_time: "A check-in needs a time — drop it on an hour row, or on a morning or afternoon.",
  already_recorded: "That check-in already happened.",
  closed: "That job is closed.",
  past: "That day has gone — pick one from today on.",
  no_such_item: "That item is not on the line any more — reload.",
  last_item: "That is the only item on the line — remove the line instead.",
  bad_duration: "A stop is between 15 minutes and 10 hours.",
  no_stops: "Nothing in the run plan yet.",
  bad_purpose: "Pick what the stop is for.",
  no_job: "A stop needs a job.",
  after_final: "A check-in cannot come after the final walkthrough.",
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
  const stop = s.match(/^error:stop_(\d+)_(.+)$/);
  if (stop) return { ok: false, message: `Stop ${stop[1]}: ${friendly(stop[2])}` };
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
  const r = await call("movement_mark_ordered", { p_id: p.data.id }, "movements.markOrdered", jobPaths(p.data.workOrderId));
  // Session 5: the order step is what tells the painter (brief §3.5). Best-effort, after the
  // response — a lost text never unwinds the order; the board shows "painter told" from the stamp.
  if (r.ok) {
    const service = createServiceClient();
    if (service) after(() => notifyMovementOrdered(service, p.data.id));
  }
  return r;
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

const runPlanInput = z.object({
  personKind: z.enum(["profiles", "contractors"]), personId: uuid, day: isoDate,
  /** Display words for the text, from the evaluator's runPlan() on the screen that pressed Send. */
  stops: z.number().int().min(0).max(200), km: z.number().min(0).max(5000),
});

/** Send to <name>'s phone (Day view): the RPC stamps the stops and logs it; the text follows (Session 5). */
export async function sendRunPlan(raw: unknown): Promise<MovementActionResult> {
  const p = runPlanInput.safeParse(raw);
  if (!p.success) return invalid(p);
  const r = await call("movement_send_run_plan", { p_person_kind: p.data.personKind, p_person_id: p.data.personId, p_day: p.data.day }, "movements.sendRunPlan");
  if (r.ok) {
    const service = createServiceClient();
    if (service) after(() => notifyRunPlan(service, { kind: p.data.personKind, id: p.data.personId }, p.data.day, { stops: p.data.stops, km: p.data.km }));
  }
  return r;
}

const reorderInput = z.object({
  assigneeKind: z.enum(MOVEMENT_ASSIGNEES), assigneeId: uuid.nullable().optional(), day: isoDate,
  /** The evaluator's reorder() patches: the new order, with the SAME set of times handed out in that order (ruling 22). */
  patches: z.array(z.object({ id: uuid, sequence: z.number().int().min(1), time: clock })).min(1).max(200),
  workOrderIds: z.array(uuid).max(200).optional(),
});

/**
 * Reorder a person's day (Day view ▲▼, the map's order card): one round trip that sets the
 * sequence and re-slots the times, so the week board and the run plan agree.
 */
export async function reorderDay(raw: unknown): Promise<MovementActionResult> {
  const p = reorderInput.safeParse(raw);
  if (!p.success) return invalid(p);
  const ordered = [...p.data.patches].sort((x, y) => x.sequence - y.sequence);
  const seq = await call("movement_set_sequence", {
    p_assignee_kind: p.data.assigneeKind, p_assignee_id: p.data.assigneeId ?? null, p_day: p.data.day, p_ids: ordered.map((x) => x.id),
  }, "movements.reorder");
  if (!seq.ok) return seq;
  for (const x of ordered) {
    const t = await call("movement_set_time", { p_id: x.id, p_time: x.time }, "movements.reorder.time", (p.data.workOrderIds ?? []).flatMap(jobPaths));
    if (!t.ok) return t;
  }
  return { ok: true, value: String(ordered.length) };
}

/** The painter's tick on a movement on their lane (portal; the RPC checks it is theirs). */
export async function painterMovementDone(raw: unknown): Promise<MovementActionResult> {
  const p = idInput.safeParse(raw);
  if (!p.success) return invalid(p);
  return call("movement_painter_done", { p_id: p.data.id }, "movements.painterDone", ["/portal", ...jobPaths(p.data.workOrderId).map((x) => x.replace("/pc/wo/", "/portal/jobs/"))]);
}


// ---- the map: real points on jobs (flag 3) -----------------------------------------------------

const geocodeInput = z.object({ workOrderIds: z.array(uuid).min(1).max(8) });

/**
 * Fill `work_orders.lat/lng` lazily: the Map view names the jobs of the week that have no
 * real point and were not tried this week; this reads their addresses, asks the Places key
 * (server-side), and writes through `wo_set_point` — a miss still stamps the attempt. Returns
 * how many points were set; the screen re-reads when it is more than none.
 */
export async function geocodeJobs(raw: unknown): Promise<MovementActionResult> {
  const p = geocodeInput.safeParse(raw);
  if (!p.success) return invalid(p);
  const key = process.env.GOOGLE_MAPS_API_KEY;
  if (!key) return { ok: false, message: "Address lookup is not configured (GOOGLE_MAPS_API_KEY)." };
  const supabase = await createClient();
  const { data, error } = await supabase.from("work_orders").select("id, wo_snapshot").in("id", p.data.workOrderIds);
  if (error) {
    reportError(new Error(error.message), { where: "movements.geocode.read" });
    return { ok: false, message: "Could not read the jobs to place them on the map." };
  }
  let set = 0;
  for (const row of (data ?? []) as { id: string; wo_snapshot: { jobAddress?: string } | null }[]) {
    const point = await geocodeAddress(row.wo_snapshot?.jobAddress ?? "", key);
    const { data: r, error: e } = await supabase.rpc("wo_set_point", { p_work_order_id: row.id, p_lat: point?.lat ?? null, p_lng: point?.lng ?? null });
    if (e) {
      if (isMissingRpc(e.message, "wo_set_point")) return { ok: false, message: "This needs database migration 20270283 run first — the map uses suburb centres until then." };
      reportError(new Error(e.message), { where: "movements.geocode.write", extra: { workOrderId: row.id } });
      continue;
    }
    if (String(r) === "ok:set") set += 1;
  }
  if (set > 0) revalidatePath("/pc/movements");
  return { ok: true, value: String(set) };
}

// ---- material lines: one list, three doors --------------------------------------------------

const lineAddInput = z.object({ workOrderId: uuid, text: z.string().min(1).max(500), source: z.enum(MATERIAL_LINE_SOURCES).optional() });

const methodInput = idInput.extend({ method: z.enum(["delivery", "pickup"]), branchId: uuid.nullable().optional() });

/** Tom, 21 Oct 2026: confirm the shop and delivered / picked up on a tray order. Delivery + a delivering shop places it on the Supplier lane. */
export async function setMovementMethod(raw: unknown): Promise<MovementActionResult> {
  const p = methodInput.safeParse(raw);
  if (!p.success) return invalid(p);
  return call("movement_set_method", { p_id: p.data.id, p_method: p.data.method, p_branch_id: p.data.branchId ?? null }, "movements.setMethod", jobPaths(p.data.workOrderId));
}

const visitInput = z.object({ visitId: uuid, date: isoDate, time: clock, workOrderId: uuid.nullable().optional() });

/** Tom, 21 Oct 2026: an unscheduled site check-in dropped on a staff lane gets its day and time. */
export async function scheduleSiteVisit(raw: unknown): Promise<MovementActionResult> {
  const p = visitInput.safeParse(raw);
  if (!p.success) return invalid(p);
  return call("wo_site_visit_set_schedule", { p_visit_id: p.data.visitId, p_date: p.data.date, p_time: p.data.time }, "movements.scheduleVisit", jobPaths(p.data.workOrderId));
}

export async function addMaterialLine(raw: unknown): Promise<MovementActionResult> {
  const p = lineAddInput.safeParse(raw);
  if (!p.success) return invalid(p);
  return call("material_line_add", { p_work_order_id: p.data.workOrderId, p_text: p.data.text, p_source: p.data.source ?? "pc" }, "movements.lineAdd", jobPaths(p.data.workOrderId));
}

const lineUpdateInput = z.object({ id: uuid, text: z.string().min(1).max(500), workOrderId: uuid.nullable().optional() });

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

const splitInput = z.object({ id: uuid, item: z.string().min(1).max(500), workOrderId: uuid.nullable().optional() });

/** Tom, 21 Oct 2026: one item off a comma-separated line becomes its own line and chip (tapes out of stock). */
export async function splitMaterialLine(raw: unknown): Promise<MovementActionResult> {
  const p = splitInput.safeParse(raw);
  if (!p.success) return invalid(p);
  return call("material_line_split", { p_id: p.data.id, p_item: p.data.item }, "movements.lineSplit", jobPaths(p.data.workOrderId));
}

const durationInput = z.object({ id: uuid, minutes: z.number().int().min(15).max(600), workOrderId: uuid.nullable().optional() });

/** How long a stop takes — the end time on the run plan. */
export async function setMovementDuration(raw: unknown): Promise<MovementActionResult> {
  const p = durationInput.safeParse(raw);
  if (!p.success) return invalid(p);
  return call("movement_set_duration", { p_id: p.data.id, p_minutes: p.data.minutes }, "movements.setDuration", jobPaths(p.data.workOrderId));
}

export const RUN_PURPOSES = ["collect_materials", "quality_check", "site_checkin", "rubbish_collection", "drop_materials", "drop_paint"] as const;
const publishInput = z.object({
  personKind: z.enum(["profiles", "contractors"]), personId: uuid, day: isoDate,
  stops: z.array(z.object({
    movementId: uuid.nullable().optional(), workOrderId: uuid.nullable().optional(),
    purpose: z.enum(RUN_PURPOSES).nullable().optional(), time: clock, durationMin: z.number().int().min(15).max(600).optional(),
  })).min(1).max(60),
  workOrderIds: z.array(uuid).max(60).optional(),
});

/**
 * Publish a run planned on the Map (Tom, 21 Oct 2026): one RPC places every stop on the
 * person for the day at its time, makes the purpose-only stops, writes the durations and the
 * order. Until this is called the plan exists only in the browser.
 */
export async function publishRun(raw: unknown): Promise<MovementActionResult> {
  const p = publishInput.safeParse(raw);
  if (!p.success) return invalid(p);
  const stops = p.data.stops.map((s) => ({ movement_id: s.movementId ?? null, work_order_id: s.workOrderId ?? null, purpose: s.purpose ?? null, time: s.time, duration_min: s.durationMin ?? 60 }));
  return call("movement_publish_run", { p_person_kind: p.data.personKind, p_person_id: p.data.personId, p_day: p.data.day, p_stops: stops }, "movements.publishRun", (p.data.workOrderIds ?? []).flatMap(jobPaths));
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
  }, "movements.itemCreate", ["/settings"]);
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
  return call("equipment_item_update", { p_id: d.id, p: patch }, "movements.itemUpdate", ["/settings"]);
}

const itemStatusInput = z.object({ id: uuid, status: z.enum(EQUIPMENT_STATUSES) });

export async function setEquipmentItemStatus(raw: unknown): Promise<MovementActionResult> {
  const p = itemStatusInput.safeParse(raw);
  if (!p.success) return invalid(p);
  return call("equipment_item_set_status", { p_id: p.data.id, p_status: p.data.status }, "movements.itemStatus", ["/settings"]);
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
  return call("supplier_branch_upsert", { p: payload }, "movements.branchUpsert", ["/settings"]);
}

const accountInput = z.object({ branchId: uuid, accountRef: z.string().max(80), accountName: z.string().max(120).optional() });

/** The trade account on a branch — staff-only table, masked on screen, never in a file. */
export async function setSupplierBranchAccount(raw: unknown): Promise<MovementActionResult> {
  const p = accountInput.safeParse(raw);
  if (!p.success) return invalid(p);
  return call("supplier_branch_set_account", {
    p_branch_id: p.data.branchId, p_account_ref: p.data.accountRef, p_account_name: p.data.accountName ?? "",
  }, "movements.branchAccount", ["/settings"]);
}
