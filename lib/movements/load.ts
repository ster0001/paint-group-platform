import type { SupabaseClient } from "@supabase/supabase-js";
import { createClient } from "@/lib/supabase/server";
import { fetchAllRows } from "@/lib/supabase/fetchAllRows";
import { inSlices } from "@/lib/supabase/inSlices";
import { realOnly } from "@/lib/demo/scope";
import { loadBoard, type Block } from "@/lib/scheduling/board";
import { addDays, isDateString } from "@/lib/scheduling/dates";
import { readGoogleBusyForStaff, type GoogleBusy, type GoogleReadKind } from "@/lib/gcal/read";
import { melbourneInstant } from "@/lib/time/businessHours";
import type { WOMaterial } from "@/lib/workorder/snapshot";
import { cansOf, jobPoint, jobRef } from "./sync";
import { suburbOf, type Appointment, type Job, type Painter, type StaffPerson, type World } from "./evaluate";
import {
  movementsSettingsFrom, type BranchRow, type EquipmentItemRow, type LogisticsDecisionRow, type MaterialLineRow, type MovementItemRow,
  type MovementLine, type MovementRow, type MovementsSettings, type Point,
} from "./types";

/**
 * Movements — the loader (Session 3). ONE round trip per source, every read keeps its
 * `error`, `realOnly()` on every list read of a flagged table (movements, movement_items,
 * wo_material_lines, wo_logistics_decisions — lib/demo/boundary.test.ts), failures RETURNED
 * as lines a screen can show, never thrown. The result is the `World` that
 * `lib/movements/evaluate.ts` computes over; nothing here computes a lane, a colour or a
 * count. Staff-only: RLS answers `[]` to anyone else, and the screens that call this sit
 * under /pc.
 *
 * A failed source leaves its slice of the world EMPTY and says so in `failures` — the
 * board then draws with a line at the top ("Couldn't read the movements: …") instead of
 * drawing a full week as if nothing needed moving (CLAUDE.md, 16 Sep 2026).
 */

export type MovementsWeek = {
  world: World;
  /** One line per source that could not be read. Empty = everything read. */
  failures: string[];
  /** The material lines on the jobs in play, for the Sources view (one list, three doors). */
  materialLines: MaterialLineRow[];
  /**
   * Per job: the Materials card's live rows as a paint chip renders them before ordering,
   * and the crew notes the Sources view shows beside the materials list (Session 4). Keyed by
   * work order id; a plain object so it crosses the server → client boundary as-is.
   */
  jobExtras: Record<string, JobExtras>;
};

/** A Materials-card row with the brand the sync groups it under (`paint:<brand>`, blank → `brand?`). */
export type PaintRowView = MovementLine & { brand: string };
export type JobExtras = {
  paintRows: PaintRowView[]; crewNotes: string;
  /** Flag 3: `exact` = work_orders.lat/lng; `suburb` = the centroid stands in; `none` = no point at all. */
  pointSource: "exact" | "suburb" | "none";
  /** The Map view asks the Places route for this job once per render while true: no real point, never checked (or not in the last 7 days). */
  geocodeWanted: boolean;
};

const GEOCODE_RETRY_MS = 7 * 24 * 60 * 60 * 1000;
/** Whether the lazy geocode should try this job now (`exact` never; a failed attempt waits a week). */
export function geocodeWanted(w: Pick<WoRow, "lat" | "lng" | "point_checked_at">, now = Date.now()): boolean {
  if (w.lat != null && w.lng != null) return false;
  if (!w.point_checked_at) return true;
  const t = new Date(w.point_checked_at).getTime();
  return Number.isNaN(t) || now - t > GEOCODE_RETRY_MS;
}

type WoRow = {
  id: string; wo_ref: string; job_no: number | null; stage: string; start_date: string | null; end_date: string | null; contractor_id: string | null;
  lat?: number | null; lng?: number | null; point_checked_at?: string | null;
  wo_snapshot: { jobAddress?: string; jobTitle?: string; materials?: WOMaterial[]; crewNotes?: string } | null;
  colours: Record<string, { status?: string } | null> | null;
};

const MOVEMENT_COLUMNS = "id, work_order_id, kind, source_key, title, detail, assignee_kind, assignee_table, assignee_id, due_date, half, time, sequence, "
  + "from_kind, from_branch_id, from_text, to_kind, to_branch_id, to_text, status, ordered_at, client_notice, order_ref, lines, planned_for_start, return_due, "
  + "blocked_by_movement_id, expected_cost_cents, note, problem_note, painter_confirmed_at, source_changed_at, booked_at, done_at, created_at, updated_at";

type RawMovement = Omit<MovementRow, "items">;

/** `wo_colours_confirmed(wo)`, in TS: a snapshot with rows, every row's colour confirmed. */
export function coloursConfirmed(wo: Pick<WoRow, "wo_snapshot" | "colours">): boolean {
  const rows = wo.wo_snapshot?.materials ?? [];
  if (!wo.wo_snapshot || rows.length === 0) return false;
  return rows.every((m) => (wo.colours?.[m.product]?.status ?? "tbc") === "confirmed");
}

/** A work order row as the evaluator's Job. The point is the suburb centroid until ⚑3 fills lat/lng. */
export function jobFrom(w: WoRow, suburbs: ReadonlyMap<string, Point>): Job {
  const address = w.wo_snapshot?.jobAddress ?? "";
  return {
    id: w.id, woRef: w.wo_ref, jobRef: jobRef(w), title: w.wo_snapshot?.jobTitle || w.wo_ref, address, suburb: suburbOf(address),
    stage: w.stage, startDate: w.start_date, endDate: w.end_date, contractorId: w.contractor_id, coloursConfirmed: coloursConfirmed(w),
    point: w.lat != null && w.lng != null ? { lat: w.lat, lng: w.lng } : jobPoint(address, suburbs),
  };
}

export type QaFlags = { qa_required: boolean | null; qa_waived: boolean | null };
/** Tom, 20 Oct 2026: a quality check reaches the board only when the job has it ticked as required and not waived. */
export function qaCheckRequired(wo: QaFlags | null | undefined): boolean {
  return Boolean(wo?.qa_required) && !wo?.qa_waived;
}

type Read<T> = { rows: T[]; error: string | null };
type Sliced<T> = PromiseLike<{ data: T[] | null; error: { message: string } | null }>;
/** The generated Database types predate 20270279, so a typed builder on these tables answers `GenericStringError[]`; the row shape is asserted here, once. */
const sliced = <T,>(q: unknown) => q as Sliced<T>;
const failed = <T,>(error: { message: string } | null | undefined, data: T[] | null | undefined): Read<T> =>
  error ? { rows: [], error: error.message } : { rows: data ?? [], error: null };

/** Every job id the week touches: on a movement, a block, a check, a check-in or a walkthrough. */
function jobIds(movements: readonly RawMovement[], blocks: readonly Block[], appointments: readonly Appointment[]): string[] {
  const ids = new Set<string>();
  for (const m of movements) if (m.work_order_id) ids.add(m.work_order_id);
  for (const b of blocks) if (b.workOrderId) ids.add(b.workOrderId);
  for (const a of appointments) ids.add(a.workOrderId);
  return [...ids];
}

export async function loadMovementsWeek(from: string, to: string, client?: SupabaseClient): Promise<MovementsWeek> {
  if (!isDateString(from) || !isDateString(to) || to < from) {
    throw new Error(`loadMovementsWeek: bad window ${from}..${to}`);
  }
  const supabase = client ?? await createClient();
  const failures: string[] = [];
  const fail = (what: string, error: string | null) => { if (error) failures.push(`Couldn't read ${what}: ${error}`); };

  // ---- round 1: everything that needs nothing else ----------------------------------------
  const [settingsRes, board, movementsRes, itemLinksRes, equipmentRes, branchesRes, qaRes, visitsRes, suburbsRes, productsRes] = await Promise.all([
    supabase.from("settings").select("value").eq("key", "movements").maybeSingle(),
    loadBoard(from, to),
    // The tray (any date) plus everything dated in the window. Done and cancelled rows in the
    // window ride along so a ticked movement still shows on its day.
    realOnly(supabase.from("movements").select(MOVEMENT_COLUMNS))
      .or(`status.eq.tray,and(due_date.gte.${from},due_date.lte.${to})`)
      .order("due_date", { nullsFirst: true }).order("sequence", { nullsFirst: false }).order("created_at").limit(2000),
    // Every item link: the register's locations come from the latest DONE movement carrying an
    // item, which may be months old. Small table (one row per item per movement).
    fetchAllRows<MovementItemRow>((f, t) => realOnly(supabase.from("movement_items").select("movement_id, equipment_item_id, label")).order("movement_id").order("equipment_item_id").range(f, t))
      .then((rows) => ({ data: rows, error: null as { message: string } | null }), (e: unknown) => ({ data: null, error: { message: e instanceof Error ? e.message : String(e) } })),
    supabase.from("equipment_items").select("id, tag, name, category, serial_or_model, status").neq("status", "retired").order("tag"),
    supabase.from("supplier_branches").select("id, brand, branch, kind, address, suburb, phone, lat, lng, delivers_to_site, opens_weekday, favourite, active").eq("active", true).order("brand").order("branch"),
    // Tom, 20 Oct 2026: a quality check is on the board only when the job has "Quality check
    // required" ticked (work_orders.qa_required) and it was not waived — not on every staff job.
    realOnly(supabase.from("wo_qa_checks").select("id, work_order_id, scheduled_for, scheduled_time, kind, work_orders(qa_required, qa_waived)")).is("result", null).gte("scheduled_for", from).lte("scheduled_for", to),
    realOnly(supabase.from("wo_site_visits").select("id, work_order_id, scheduled_for, scheduled_time")).is("visited_at", null).gte("scheduled_for", from).lte("scheduled_for", to),
    // The centroids (one paged read; ~1,000 rows). Keyed lower-case; the first by postcode wins, as the SQL orders it.
    fetchAllRows<{ suburb: string; postcode: string; lat: number | null; lng: number | null }>((f, t) => supabase.from("visit_suburbs").select("suburb, postcode, lat, lng").order("suburb").order("postcode").range(f, t))
      .then((rows) => ({ data: rows, error: null as { message: string } | null }), (e: unknown) => ({ data: null, error: { message: e instanceof Error ? e.message : String(e) } })),
    // Brand by product NAME (Session 1 decision): the paint chip's live rows are the Materials
    // rows of its brand, and the rows carry only the product's name.
    supabase.from("products").select("name, brand, effective_from").order("effective_from", { ascending: false, nullsFirst: false }).limit(2000),
  ]);

  fail("the Movements settings", settingsRes.error?.message ?? null);
  for (const e of board.errors) failures.push(`Couldn't read the schedule: ${e}`);
  const settings: MovementsSettings = movementsSettingsFrom(settingsRes.data?.value);
  const movementsRead = failed<RawMovement>(movementsRes.error, movementsRes.data as RawMovement[] | null);
  fail("the movements", movementsRead.error);
  const linksRead = failed<MovementItemRow>(itemLinksRes.error, itemLinksRes.data);
  fail("the gear on movements", linksRead.error);
  const equipmentRead = failed<EquipmentItemRow>(equipmentRes.error, equipmentRes.data as EquipmentItemRow[] | null);
  fail("the equipment register", equipmentRead.error);
  const branchesRead = failed<BranchRow>(branchesRes.error, branchesRes.data as BranchRow[] | null);
  fail("the supplier branches", branchesRead.error);
  type QaRow = { id: string; work_order_id: string; scheduled_for: string; scheduled_time: string | null; kind: string; work_orders: QaFlags | null };
  const qaRead = failed<QaRow>(qaRes.error, qaRes.data as unknown as QaRow[] | null);
  qaRead.rows = qaRead.rows.filter((r) => qaCheckRequired(r.work_orders));
  fail("the quality checks", qaRead.error);
  type VisitRow = { id: string; work_order_id: string; scheduled_for: string; scheduled_time: string | null };
  const visitsRead = failed<VisitRow>(visitsRes.error, visitsRes.data as VisitRow[] | null);
  fail("the site check-ins", visitsRead.error);
  const suburbsRead = failed(suburbsRes.error, suburbsRes.data);
  fail("the suburb centroids", suburbsRead.error);
  const productsRead = failed<{ name: string; brand: string | null; effective_from: string | null }>(productsRes.error, productsRes.data as { name: string; brand: string | null; effective_from: string | null }[] | null);
  fail("the products", productsRead.error);
  const brandOf = new Map<string, string>();
  for (const p of productsRead.rows) { const k = p.name.trim().toLowerCase(); if (!brandOf.has(k)) brandOf.set(k, (p.brand ?? "").trim()); }
  const suburbs = new Map<string, Point>();
  for (const s of suburbsRead.rows) {
    const key = s.suburb.trim().toLowerCase();
    if (s.lat != null && s.lng != null && !suburbs.has(key)) suburbs.set(key, { lat: s.lat, lng: s.lng });
  }

  const appointments: Appointment[] = [
    ...qaRead.rows.map((r): Appointment => ({ id: r.id, kind: "qa", workOrderId: r.work_order_id, date: r.scheduled_for, time: r.scheduled_time?.slice(0, 5) ?? null, sub: r.kind })),
    ...visitsRead.rows.map((r): Appointment => ({ id: r.id, kind: "checkin", workOrderId: r.work_order_id, date: r.scheduled_for, time: r.scheduled_time?.slice(0, 5) ?? null })),
    ...board.walkthroughs.map((w): Appointment => ({ id: w.id, kind: "walkthrough", workOrderId: w.workOrderId, date: w.date, time: w.time, sub: w.kind })),
  ];

  // ---- round 2: what the first round pointed at -------------------------------------------
  // Movements referenced but outside the window: the one a chip is blocked by, and every
  // DONE movement that carried an item (the register's locations).
  const have = new Set(movementsRead.rows.map((m) => m.id));
  const wanted = new Set<string>();
  for (const m of movementsRead.rows) if (m.blocked_by_movement_id && !have.has(m.blocked_by_movement_id)) wanted.add(m.blocked_by_movement_id);
  for (const l of linksRead.rows) if (!have.has(l.movement_id)) wanted.add(l.movement_id);
  const jobsWanted = jobIds(movementsRead.rows, board.blocks, appointments);
  const staffIds = settings.boardPeople.map((p) => p.id);
  const windowStart = melbourneInstant(+from.slice(0, 4), +from.slice(5, 7), +from.slice(8, 10), 0);
  const windowEnd = melbourneInstant(+addDays(to, 1).slice(0, 4), +addDays(to, 1).slice(5, 7), +addDays(to, 1).slice(8, 10), 0);

  const [extraRes, jobsRes, linesRes, decisionsRes, profilesRes, contractorsRes, google] = await Promise.all([
    inSlices<RawMovement>([...wanted], (ids) => sliced<RawMovement>(realOnly(supabase.from("movements").select(MOVEMENT_COLUMNS)).in("id", ids))),
    inSlices<WoRow>(jobsWanted, (ids) => sliced<WoRow>(realOnly(supabase.from("work_orders").select("id, wo_ref, job_no, stage, start_date, end_date, contractor_id, wo_snapshot, colours, lat, lng, point_checked_at")).in("id", ids))),
    inSlices<MaterialLineRow>(jobsWanted, (ids) => sliced<MaterialLineRow>(realOnly(supabase.from("wo_material_lines").select("id, work_order_id, text, source, sort, merged_into, created_at")).in("work_order_id", ids).order("sort").order("created_at"))),
    inSlices<LogisticsDecisionRow>(jobsWanted, (ids) => sliced<LogisticsDecisionRow>(realOnly(supabase.from("wo_logistics_decisions").select("work_order_id, line, decision")).in("work_order_id", ids))),
    inSlices<{ id: string; name: string | null }>(staffIds, (ids) => sliced<{ id: string; name: string | null }>(supabase.from("profiles").select("id, name").in("id", ids))),
    // Which profile each painter logs in as — an employee in boardPeople is ONE lane (⚑5).
    supabase.from("contractors").select("id, profile_id").in("id", board.lanes.map((l) => l.contractorId)),
    staffIds.length ? readGoogleBusyForStaff(staffIds, windowStart, windowEnd).then(
      (r) => ({ busy: r.busy, reads: Object.fromEntries(Object.entries(r.reads).map(([id, read]) => [id, read.kind])) as Record<string, GoogleReadKind>, error: null as string | null }),
      (e: unknown) => ({ busy: [] as GoogleBusy[], reads: {} as Record<string, GoogleReadKind>, error: e instanceof Error ? e.message : String(e) }))
      : Promise.resolve({ busy: [] as GoogleBusy[], reads: {} as Record<string, GoogleReadKind>, error: null as string | null }),
  ]);

  fail("the movements a chip depends on", extraRes.error?.message ?? null);
  fail("the jobs", jobsRes.error?.message ?? null);
  fail("the material lines", linesRes.error?.message ?? null);
  fail("the logistics decisions", decisionsRes.error?.message ?? null);
  fail("the staff on the board", profilesRes.error?.message ?? null);
  fail("the painters' logins", contractorsRes.error?.message ?? null);
  if (google.error) failures.push(`Couldn't read Google Calendar: ${google.error}`);

  // ---- assemble ----------------------------------------------------------------------------
  const itemsByMovement = new Map<string, MovementItemRow[]>();
  for (const l of linksRead.rows) itemsByMovement.set(l.movement_id, [...(itemsByMovement.get(l.movement_id) ?? []), l]);
  const movements: MovementRow[] = [...movementsRead.rows, ...extraRes.rows].map((m) => ({ ...m, lines: m.lines ?? null, items: itemsByMovement.get(m.id) ?? [] }));

  const jobs = jobsRes.rows.map((w) => jobFrom(w, suburbs));
  const jobExtras: Record<string, JobExtras> = {};
  for (const w of jobsRes.rows) {
    const exact = w.lat != null && w.lng != null;
    jobExtras[w.id] = {
      crewNotes: w.wo_snapshot?.crewNotes ?? "",
      pointSource: exact ? "exact" : jobPoint(w.wo_snapshot?.jobAddress ?? "", suburbs) ? "suburb" : "none",
      geocodeWanted: geocodeWanted(w),
      paintRows: (w.wo_snapshot?.materials ?? []).filter((m) => m.product).map((m) => ({
        rowKey: m.colourKey ?? m.product, product: m.product, colourName: m.colourName ?? null, colourHex: m.colourHex ?? null,
        colourStatus: m.colourStatus ?? null, litres: m.litres ?? null, cans: cansOf(m.litres),
        brand: brandOf.get(m.product.trim().toLowerCase()) || "brand?",
      })),
    };
  }
  const profileOf = new Map(((contractorsRes.data ?? []) as { id: string; profile_id: string | null }[]).map((c) => [c.id, c.profile_id]));
  const painters: Painter[] = board.lanes.map((l) => ({ contractorId: l.contractorId, profileId: profileOf.get(l.contractorId) ?? null, name: l.name, employmentType: l.employmentType }));
  const staff: StaffPerson[] = profilesRes.rows.map((p) => ({ profileId: p.id, name: p.name?.trim() || "Staff" }));

  return {
    world: {
      from, to, settings, jobs, blocks: board.blocks, painters, staff,
      googleBusy: google.busy, googleReads: google.reads, appointments, movements,
      items: equipmentRead.rows, branches: branchesRead.rows, decisions: decisionsRes.rows, suburbs,
    },
    failures,
    materialLines: linesRes.rows,
    jobExtras,
  };
}
