import type { Block } from "@/lib/scheduling/board";
import type { GoogleBusy, GoogleReadKind } from "@/lib/gcal/read";
import { jobPoint, km, rpcNeedsOrder } from "./sync";
import type {
  BranchRow, EquipmentItemRow, LogisticsDecisionRow, MovementKind, MovementRow, MovementsSettings, Point,
} from "./types";

/**
 * Movements — the one evaluator (brief §3.3). PURE: every function here takes a `World`
 * (what `lib/movements/load.ts` read, once) and a clock, and computes. Nothing is stored,
 * nothing is fetched, no colour or count is worked out anywhere else — the Week board, Day,
 * Map, Gear, the §6 work items and the pre-start gates all read these functions.
 *
 *   lanes            Supplier, then every painter in the window, then the staff in Settings order
 *   context          read-only blocks on a lane-day: jobs, Google busy, checks, check-ins, walkthroughs, leave
 *   kindLabel        "Paint delivery" · "Gear collection" · "Skip in" … (ruling 21: the map pins say the same)
 *   methodOf         supplier_delivers · pickup · drop_off · collect · takes_to_tip … and its sentence
 *   laneColour       one colour per lane, used identically on the board, in Day and on the map
 *   needsOrder       supplier lane, or a person picking up from a branch, and not ordered yet
 *   chipWindow       the days a chip may sensibly land on (a return not before the end, a delivery not after the start)
 *   nearby           tray chips within nearKm of where a staff member already is that day
 *   hotCells         every lane-day lit while a chip is dragged
 *   whileYouAreThere the single nearest tray chip to a calendar / check block
 *   orderedStops     a person-day in run order — fixed context at its time, movements by sequence then time
 *   runPlan          the stops with km from the warehouse out and back
 *   reorder          the same set of times handed out in a new order (ruling 22)
 *   locations        where every register item is, from the latest DONE movement carrying it
 *   jobNeeds         what a job still needs (ruling 21's amber icon)
 *   jobMoved         ruling 4: flag, never shift
 *   gates            the two pre-start gate answers
 *   counts           the headline
 */

// ---- the world ------------------------------------------------------------------------------

export type Job = {
  id: string;
  woRef: string;
  /** PG-#### when numbered, else the WO ref. */
  jobRef: string;
  title: string;
  address: string;
  suburb: string;
  stage: string;
  startDate: string | null;
  endDate: string | null;
  /** The lead painter (work_orders.contractor_id). */
  contractorId: string | null;
  /** wo_colours_confirmed(wo): every Materials row has a confirmed colour. */
  coloursConfirmed: boolean;
  /** work_orders.lat/lng when ⚑3 lands; the loader fills it from the suburb centroid until then. */
  point: Point | null;
};

export type Painter = {
  contractorId: string;
  profileId: string | null;
  name: string;
  employmentType: "contractor" | "employee";
};

export type StaffPerson = { profileId: string; name: string };

/** A dated appointment on a job: quality check, site check-in, walkthrough. */
export type Appointment = {
  id: string;
  kind: "qa" | "checkin" | "walkthrough";
  workOrderId: string;
  date: string;
  /** "HH:MM" or null. */
  time: string | null;
  /** Walkthroughs only: pre | final. */
  sub?: string;
};

export type World = {
  /** Inclusive ISO days. */
  from: string;
  to: string;
  settings: MovementsSettings;
  jobs: Job[];
  /** The Schedule board's blocks (jobs, assignments, visits, holds, unavailability). */
  blocks: Block[];
  painters: Painter[];
  staff: StaffPerson[];
  googleBusy: GoogleBusy[];
  googleReads: Record<string, GoogleReadKind>;
  appointments: Appointment[];
  movements: MovementRow[];
  items: EquipmentItemRow[];
  branches: BranchRow[];
  decisions: LogisticsDecisionRow[];
  /** lower-cased suburb → centroid, for the addresses in play. */
  suburbs: Map<string, Point>;
};

// ---- lanes ----------------------------------------------------------------------------------

export type LaneKind = "supplier" | "painter" | "staff";
export type MovementLane = {
  /** "supplier", or the assignee id (contractors.id for a painter, profiles.id for staff). */
  id: string;
  kind: LaneKind;
  assigneeTable: "profiles" | "contractors" | null;
  name: string;
  /** The second line under the name. */
  sub: string;
  slots: "half" | "hour";
  colour: string;
  employmentType?: "contractor" | "employee";
  /** Staff only: what the Google read said, when it was not "ok". Drawn as a line on the lane. */
  calendarNote: string | null;
};

export const SUPPLIER_LANE_ID = "supplier";
const SUPPLIER_COLOUR = "#9AA3AB";

/** A fixed palette, picked by a stable hash of the id so a painter keeps their colour across reloads and screens. */
export const LANE_PALETTE = ["#B8266B", "#1F7A4A", "#B8860B", "#2F6FBA", "#C2410C", "#0E8C9C", "#7C3AED", "#A16207", "#BE185D", "#15803D"] as const;

function hashOf(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619) >>> 0; }
  return h >>> 0;
}

/** One colour per lane: Settings for staff, the palette by stable hash for painters, grey for the supplier. */
export function laneColour(lane: { id: string; kind: LaneKind }, settings: MovementsSettings): string {
  if (lane.kind === "supplier") return SUPPLIER_COLOUR;
  const set = settings.boardPeople.find((p) => p.id === lane.id)?.colour;
  if (set) return set;
  return LANE_PALETTE[hashOf(lane.id) % LANE_PALETTE.length];
}

export const GOOGLE_NOTES: Record<Exclude<GoogleReadKind, "ok">, string> = {
  not_connected: "Calendar not connected",
  unconfigured: "Calendar not set up",
  needs_reconnect: "Calendar needs reconnecting",
  error: "Calendar could not be read",
};

const overlaps = (aStart: string, aEnd: string, bStart: string, bEnd: string) => aStart <= bEnd && aEnd >= bStart;

/**
 * Supplier (always), then every painter with a booking, an assignment or any movement in the
 * window — contractors and employees alike (ruling 8) — by first job start, then every profile
 * in Settings → boardPeople, in that order. An employee who is also in boardPeople is ONE lane
 * (their painter lane), taking its slots and colour from Settings (⚑5).
 */
export function lanes(world: World): MovementLane[] {
  const { settings } = world;
  const out: MovementLane[] = [{
    id: SUPPLIER_LANE_ID, kind: "supplier", assigneeTable: null, name: "Supplier delivers", sub: "orders you place", slots: "half", colour: SUPPLIER_COLOUR, calendarNote: null,
  }];
  const firstStart = new Map<string, string>();
  for (const b of world.blocks) {
    if (b.kind === "unavailable" || b.kind === "hold") continue;
    if (!overlaps(b.start, b.end, world.from, world.to)) continue;
    const seen = firstStart.get(b.contractorId);
    if (!seen || b.start < seen) firstStart.set(b.contractorId, b.start);
  }
  for (const m of world.movements) {
    if (m.assignee_kind !== "person" || m.assignee_table !== "contractors" || !m.assignee_id || !m.due_date) continue;
    if (m.due_date < world.from || m.due_date > world.to) continue;
    if (m.status === "cancelled") continue;
    const seen = firstStart.get(m.assignee_id);
    if (!seen || m.due_date < seen) firstStart.set(m.assignee_id, m.due_date);
  }
  const painterByProfile = new Map(world.painters.filter((p) => p.profileId).map((p) => [p.profileId!, p]));
  const painters = world.painters.filter((p) => firstStart.has(p.contractorId))
    .sort((a, b) => firstStart.get(a.contractorId)!.localeCompare(firstStart.get(b.contractorId)!) || a.name.localeCompare(b.name));
  const staffIds = new Set(settings.boardPeople.map((p) => p.id));
  for (const p of painters) {
    const boardEntry = p.profileId && staffIds.has(p.profileId) ? settings.boardPeople.find((x) => x.id === p.profileId) : undefined;
    const lane = { id: p.contractorId, kind: "painter" as const };
    out.push({
      id: p.contractorId, kind: "painter", assigneeTable: "contractors", name: p.name,
      sub: p.employmentType === "employee" ? "employee" : "contractor",
      slots: boardEntry?.slots ?? "half",
      colour: boardEntry?.colour ?? laneColour(lane, settings),
      employmentType: p.employmentType,
      calendarNote: null,
    });
  }
  for (const bp of settings.boardPeople) {
    if (painterByProfile.has(bp.id) && firstStart.has(painterByProfile.get(bp.id)!.contractorId)) continue; // merged above
    const person = world.staff.find((s) => s.profileId === bp.id);
    if (!person) continue;
    const read = world.googleReads[bp.id];
    const painter = painterByProfile.get(bp.id);
    out.push({
      id: bp.id, kind: "staff", assigneeTable: "profiles", name: person.name,
      sub: painter ? `employee · ${bp.slots === "hour" ? "1-hour slots" : "moves things"}` : bp.slots === "hour" ? "1-hour slots · 07:30–17:30" : "moves things",
      slots: bp.slots ?? "half",
      colour: laneColour({ id: bp.id, kind: "staff" }, settings),
      employmentType: painter?.employmentType,
      calendarNote: read && read !== "ok" ? GOOGLE_NOTES[read] : null,
    });
  }
  return out;
}

// ---- context ---------------------------------------------------------------------------------

export type ContextKind = "job" | "calendar" | "qa" | "checkin" | "walkthrough" | "leave";
export type ContextBlock = {
  id: string;
  laneId: string;
  day: string;
  kind: ContextKind;
  /** The label: "On site · 22 Clarke St", "Quality check · 88 Station St", the calendar title, "Leave". */
  label: string;
  /** "Quality check" · "Job check-in" · "Walkthrough" · "On site" · "Leave" · the calendar's own title. */
  kindLabel: string;
  sub: string;
  half: "AM" | "PM" | "ALL";
  /** "HH:MM" when the block has a time. */
  time: string | null;
  endTime: string | null;
  suburb: string;
  point: Point | null;
  workOrderId: string | null;
};

const MELB_PARTS = new Intl.DateTimeFormat("en-CA", { timeZone: "Australia/Melbourne", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23" });
/** Melbourne calendar day + "HH:MM" of an instant. */
export function melbourneDayTime(iso: string): { day: string; time: string } {
  const p: Record<string, string> = {};
  for (const part of MELB_PARTS.formatToParts(new Date(iso))) p[part.type] = part.value;
  return { day: `${p.year}-${p.month}-${p.day}`, time: `${p.hour}:${p.minute}` };
}

const two = (n: number) => String(n).padStart(2, "0");
function addDays(iso: string, n: number): string {
  const d = new Date(`${iso}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return `${d.getUTCFullYear()}-${two(d.getUTCMonth() + 1)}-${two(d.getUTCDate())}`;
}
export function daysBetween(from: string, to: string): string[] {
  const out: string[] = [];
  for (let d = from; d <= to && out.length < 400; d = addDays(d, 1)) out.push(d);
  return out;
}

/** The suburb in an address — the part before the "VIC 3xxx", as the tray shows it. */
export function suburbOf(address: string | null | undefined): string {
  const parts = (address ?? "").split(",").map((s) => s.replace(/\s+(VIC|Victoria)(\s+[0-9]{4})?\s*$/i, "").trim()).filter(Boolean);
  if (parts.length === 0) return "";
  return parts.length >= 2 ? parts[parts.length - 1] : parts[0];
}

/** The suburb a free-text title names (a calendar entry: "Estimate visit · Thornbury"), by lookup — the LAST known one wins. */
export function knownSuburbIn(text: string | null | undefined, suburbs: ReadonlyMap<string, Point>): string {
  const parts = (text ?? "").split(/[,·|–—-]/).map((s) => s.replace(/\s+(VIC|Victoria)(\s+[0-9]{4})?\s*$/i, "").trim()).filter(Boolean);
  for (let i = parts.length - 1; i >= 0; i--) if (suburbs.has(parts[i].toLowerCase())) return parts[i];
  return "";
}

export function timeOrder(t: string | null | undefined, half: "AM" | "PM" | null | undefined, settings: MovementsSettings): number {
  const s = t ?? (half ? settings.defaultHalfTime[half] : null) ?? settings.defaultHalfTime.AM;
  const [h, m] = s.split(":").map(Number);
  return h + (m || 0) / 60;
}
const halfOf = (time: string): "AM" | "PM" => (time < "12:00" ? "AM" : "PM");

function jobById(world: World, id: string | null | undefined): Job | null {
  return id ? world.jobs.find((j) => j.id === id) ?? null : null;
}
function pointOfJob(world: World, job: Job | null): Point | null {
  if (!job) return null;
  return job.point ?? jobPoint(job.address, world.suburbs);
}

/** Every context block in the window, built once; `context(lane, day)` filters it. */
export function contextBlocks(world: World): ContextBlock[] {
  const out: ContextBlock[] = [];
  const laneList = lanes(world);
  const laneIds = new Set(laneList.map((l) => l.id));
  const painterLane = new Map(world.painters.map((p) => [p.contractorId, p]));
  const staffHourly = laneList.filter((l) => l.kind === "staff" && l.slots === "hour");
  const checkLanes = world.settings.boardPeople.some((p) => p.checks)
    ? laneList.filter((l) => l.kind === "staff" && world.settings.boardPeople.find((p) => p.id === l.id)?.checks)
    : staffHourly;

  // Jobs and leave from the Schedule board, one block per day in the window.
  for (const b of world.blocks) {
    if (!laneIds.has(b.contractorId) || b.kind === "hold" || b.kind === "offered" || b.kind === "proposed") continue;
    const job = jobById(world, b.workOrderId);
    const address = job?.address ?? b.address ?? "";
    const point = job ? pointOfJob(world, job) : jobPoint(address, world.suburbs);
    for (const day of daysBetween(b.start < world.from ? world.from : b.start, b.end > world.to ? world.to : b.end)) {
      if (b.kind === "unavailable") {
        out.push({ id: `${b.id}:${day}`, laneId: b.contractorId, day, kind: "leave", label: b.title || "Leave", kindLabel: "Leave", sub: "", half: "ALL", time: null, endTime: null, suburb: "", point: null, workOrderId: null });
        continue;
      }
      const first = day === b.start, last = day === b.end;
      const where = suburbOf(address) || (address ? address.split(",")[0] : "");
      out.push({
        id: `${b.id}:${day}`, laneId: b.contractorId, day, kind: "job",
        label: `On site${first && where ? ` · ${address.split(",")[0]}` : last ? " · finishes" : ""}`,
        kindLabel: "On site", sub: b.title, half: "ALL", time: null, endTime: null, suburb: where, point, workOrderId: b.workOrderId,
      });
    }
  }

  // Google busy on the staff lanes (titles when the scope allows — the read already labels a private one "Busy").
  for (const g of world.googleBusy) {
    if (!laneIds.has(g.staffId)) continue;
    const start = melbourneDayTime(g.startsAt), end = melbourneDayTime(g.endsAt);
    const days = g.allDay ? daysBetween(start.day, addDays(end.day, -1)) : daysBetween(start.day, end.day);
    for (const day of days) {
      if (day < world.from || day > world.to) continue;
      const time = g.allDay ? null : day === start.day ? start.time : "00:00";
      const where = knownSuburbIn(g.label, world.suburbs);
      out.push({
        id: `gcal:${g.staffId}:${g.startsAt}:${day}`, laneId: g.staffId, day, kind: "calendar", label: g.label, kindLabel: g.label.split(" · ")[0].trim() || "Busy",
        sub: g.calendar, half: g.allDay ? "ALL" : halfOf(time!), time, endTime: g.allDay ? null : day === end.day ? end.time : "23:59",
        suburb: where, point: where ? world.suburbs.get(where.toLowerCase()) ?? null : null, workOrderId: null,
      });
    }
  }

  // Checks and check-ins on the lanes that do them (boardPeople[].checks, else every hourly staff lane);
  // walkthroughs on the painter's lane (the Schedule board pins them there) AND those lanes.
  for (const a of world.appointments) {
    if (a.date < world.from || a.date > world.to) continue;
    const job = jobById(world, a.workOrderId);
    const address = job?.address ?? "";
    const kindLabel = a.kind === "qa" ? "Quality check" : a.kind === "checkin" ? "Job check-in" : "Walkthrough";
    const targets: string[] = checkLanes.map((l) => l.id);
    if (a.kind === "walkthrough" && job?.contractorId && painterLane.has(job.contractorId) && laneIds.has(job.contractorId)) targets.push(job.contractorId);
    for (const laneId of new Set(targets)) {
      out.push({
        id: `${a.kind}:${a.id}:${laneId}`, laneId, day: a.date, kind: a.kind,
        label: `${kindLabel}${address ? ` · ${address.split(",")[0]}${suburbOf(address) ? `, ${suburbOf(address)}` : ""}` : job ? ` · ${job.title}` : ""}`,
        kindLabel, sub: a.kind === "walkthrough" ? `${a.sub === "pre" ? "pre-start" : "final"} · ${job?.jobRef ?? ""}`.trim() : `from the job · ${job?.jobRef ?? ""}`.trim(),
        half: a.time ? halfOf(a.time) : "AM", time: a.time, endTime: null, suburb: suburbOf(address), point: pointOfJob(world, job), workOrderId: a.workOrderId,
      });
    }
  }
  return out.sort((a, b) => a.day.localeCompare(b.day) || timeOrder(a.time, a.half === "ALL" ? "AM" : a.half, world.settings) - timeOrder(b.time, b.half === "ALL" ? "AM" : b.half, world.settings));
}

/** The read-only blocks on one lane-day. */
export function context(world: World, laneId: string, day: string, blocks: readonly ContextBlock[] = contextBlocks(world)): ContextBlock[] {
  return blocks.filter((b) => b.laneId === laneId && b.day === day);
}

// ---- labels and methods ----------------------------------------------------------------------

export const RETURN_KINDS: ReadonlySet<MovementKind> = new Set(["equipment_return", "hire_off", "rubbish_out", "repair_back"]);
export const OUT_KINDS: ReadonlySet<MovementKind> = new Set(["paint", "materials", "equipment_out", "hire_on", "rubbish_in", "repair_out", "restock"]);

export const isUndecidedRubbish = (m: Pick<MovementRow, "source_key" | "detail">) => m.source_key === "rubbish" && m.detail === "undecided";
export const isSkip = (m: Pick<MovementRow, "kind" | "source_key">) => m.kind === "rubbish_in" || (m.kind === "rubbish_out" && (m.source_key ?? "").startsWith("hire_off:"));
const isPainterDisposes = (m: Pick<MovementRow, "kind" | "detail">) => m.kind === "rubbish_out" && m.detail === "painter disposes of it";
const isLive = (m: Pick<MovementRow, "status">) => m.status === "planned" || m.status === "booked" || m.status === "problem";

/** The label on cards, run plans and map pins. */
export function kindLabel(m: Pick<MovementRow, "kind" | "assignee_kind" | "source_key" | "detail" | "to_kind" | "title">): string {
  const supplier = m.assignee_kind === "supplier";
  switch (m.kind) {
    case "paint": return supplier ? "Paint delivery" : "Paint pickup";
    case "materials": return supplier ? "Materials delivery" : "Materials pickup";
    case "equipment_out": return "Gear drop-off";
    case "equipment_return": return "Gear collection";
    case "hire_on": return "Hire delivery";
    case "hire_off": return "Hire collection";
    case "rubbish_in": return "Skip in";
    case "rubbish_out":
      if ((m.source_key ?? "").startsWith("hire_off:")) return "Skip out";
      if (isUndecidedRubbish(m)) return "Rubbish — how?";
      if (isPainterDisposes(m)) return "Rubbish disposed";
      if (m.to_kind === "warehouse") return "Rubbish to warehouse";
      return m.to_kind === "tip" && m.assignee_kind === "person" ? "Rubbish to tip" : "Rubbish collection";
    case "restock": return "Restock";
    case "repair_out": return "Repair out";
    case "repair_back": return "Repair back";
    default: return m.title || "Movement";
  }
}

export type Method = "supplier_delivers" | "hire_delivers" | "pickup" | "drop_off" | "collect" | "takes_to_tip" | "painter_disposes" | "unplaced";

/** From assignee kind + chip kind + from/to. */
export function methodOf(m: Pick<MovementRow, "kind" | "assignee_kind" | "from_kind" | "to_kind" | "source_key" | "detail">): Method {
  if (!m.assignee_kind) return "unplaced";
  if (m.assignee_kind === "supplier") return m.kind === "hire_on" || m.kind === "hire_off" || isSkip(m) ? "hire_delivers" : "supplier_delivers";
  if (isPainterDisposes(m)) return "painter_disposes";
  if (RETURN_KINDS.has(m.kind)) return m.kind === "rubbish_out" && m.to_kind === "tip" ? "takes_to_tip" : "collect";
  if (m.from_kind === "branch") return "pickup";
  return "drop_off";
}

/** "Josef picks up" / "Felipe drops off" / "Saul collects" / "delivered to site". */
export function methodLabel(m: Parameters<typeof methodOf>[0], laneName: string | null): string {
  const first = (laneName ?? "").split(" ")[0] || "They";
  switch (methodOf(m)) {
    case "supplier_delivers": return "delivered to site";
    case "hire_delivers": return "hire company delivers";
    case "pickup": return `${first} picks up`;
    case "drop_off": return `${first} drops off`;
    case "collect": return `${first} collects`;
    case "takes_to_tip": return `${first} takes it to the tip`;
    case "painter_disposes": return `${first} disposes`;
    default: return "in the tray";
  }
}

/** Supplier lane, or a person picking up from a branch, and `ordered_at` is null. */
export function needsOrder(m: Pick<MovementRow, "assignee_kind" | "from_kind" | "ordered_at" | "status" | "kind" | "detail">): boolean {
  if (!isLive(m) || isPainterDisposes(m)) return false;
  return rpcNeedsOrder(m) && m.ordered_at === null;
}

/** The chip's state word on the card: tray · needs-order · planned · booked · done · problem · cancelled. */
export function chipState(m: MovementRow): "tray" | "needs-order" | "planned" | "booked" | "done" | "problem" | "cancelled" {
  if (m.status === "tray" || m.status === "done" || m.status === "cancelled" || m.status === "problem") return m.status;
  if (needsOrder(m)) return "needs-order";
  return m.status;
}

// ---- windows, blocks and reasons ---------------------------------------------------------------

export type ChipWindow = { from: string | null; to: string | null };

/**
 * The days a chip may sensibly land on: a return not before its job's end date, a delivery /
 * pickup / drop-off not after its job's start date; closed-job returns and warehouse chips any
 * day. Dropping outside is allowed with a warning; Nearby, ghosts and hot cells never suggest it.
 */
export function chipWindow(m: Pick<MovementRow, "kind" | "work_order_id">, job: Job | null): ChipWindow {
  if (!job || job.stage === "closed") return { from: null, to: null };
  if (RETURN_KINDS.has(m.kind)) return { from: job.endDate ?? job.startDate, to: null };
  if (OUT_KINDS.has(m.kind)) return { from: null, to: job.startDate };
  return { from: null, to: null };
}
export function inWindow(w: ChipWindow, day: string): boolean {
  return (w.from === null || day >= w.from) && (w.to === null || day <= w.to);
}

/** Why a tray chip cannot be dropped yet, or null. */
export function blockedReason(m: MovementRow, world: World): string | null {
  if (m.blocked_by_movement_id) {
    const ret = world.movements.find((x) => x.id === m.blocked_by_movement_id);
    if (!ret) return "waiting on a return that is no longer there — reload";
    if (ret.status === "done") return null;
    const job = jobById(world, ret.work_order_id);
    const tag = m.items[0]?.label.split(" · ")[0] ?? "that item";
    if (ret.status === "tray") return `${tag} is still at ${job?.address || "its last job"} — ${job?.stage === "closed" ? "job closed" : "not back yet"}. Drop "${ret.title}" on someone first.`;
    return `return booked ${ret.due_date ?? ""} · available after`.trim();
  }
  if (isUndecidedRubbish(m)) return "say how the rubbish goes first";
  return null;
}

/** Where a chip is for the purpose of distance: its job, else its branch, else the warehouse. */
export function chipPoint(m: MovementRow, world: World): Point | null {
  const job = jobById(world, m.work_order_id);
  if (job) return pointOfJob(world, job);
  const branchId = m.from_branch_id ?? m.to_branch_id;
  const b = branchId ? world.branches.find((x) => x.id === branchId) : null;
  if (b && b.lat != null && b.lng != null) return { lat: b.lat, lng: b.lng };
  return warehousePoint(world);
}
export function warehousePoint(world: World): Point | null {
  const w = world.settings.warehouse;
  if (w.lat != null && w.lng != null) return { lat: w.lat, lng: w.lng };
  return w.suburb ? world.suburbs.get(w.suburb.toLowerCase()) ?? null : null;
}

const trayChips = (world: World) => world.movements.filter((m) => m.status === "tray");
function suggestable(m: MovementRow, world: World, day: string): boolean {
  return blockedReason(m, world) === null && !isUndecidedRubbish(m) && inWindow(chipWindow(m, jobById(world, m.work_order_id)), day);
}

export type Nearby = { chip: MovementRow; from: ContextBlock; km: number };

/** Tray chips within nearKm of any context block that STAFF member has that day, nearest first. */
export function nearby(world: World, laneId: string, day: string, blocks: readonly ContextBlock[] = contextBlocks(world)): Nearby[] {
  const lane = lanes(world).find((l) => l.id === laneId);
  if (!lane || lane.kind !== "staff") return [];
  const there = context(world, laneId, day, blocks).filter((b) => b.point && b.kind !== "leave");
  if (there.length === 0) return [];
  const out: Nearby[] = [];
  for (const chip of trayChips(world)) {
    if (!suggestable(chip, world, day)) continue;
    const p = chipPoint(chip, world);
    if (!p) continue;
    let best: Nearby | null = null;
    for (const b of there) {
      const d = km(b.point, p);
      if (d == null || d > world.settings.nearKm) continue;
      if (!best || d < best.km) best = { chip, from: b, km: d };
    }
    if (best) out.push(best);
  }
  return out.sort((a, b) => a.km - b.km);
}

/** Every (lane, day) where someone has context within nearKm of the chip — lit while dragging. */
export function hotCells(world: World, chip: MovementRow, blocks: readonly ContextBlock[] = contextBlocks(world)): { laneId: string; day: string }[] {
  const p = chipPoint(chip, world);
  if (!p) return [];
  const w = chipWindow(chip, jobById(world, chip.work_order_id));
  const out: { laneId: string; day: string }[] = [];
  for (const lane of lanes(world)) {
    if (lane.kind === "supplier") continue;
    for (const day of daysBetween(world.from, world.to)) {
      if (!inWindow(w, day)) continue;
      const near = blocks.some((b) => b.laneId === lane.id && b.day === day && b.kind !== "leave" && b.point && (km(b.point, p) ?? Infinity) <= world.settings.nearKm);
      if (near) out.push({ laneId: lane.id, day });
    }
  }
  return out;
}

/** The single nearest tray chip to a calendar / check block (one ghost per block, max). */
export function whileYouAreThere(world: World, block: ContextBlock): Nearby | null {
  if (block.kind === "job" || block.kind === "leave" || !block.point) return null;
  let best: Nearby | null = null;
  for (const chip of trayChips(world)) {
    if (!suggestable(chip, world, block.day)) continue;
    const d = km(block.point, chipPoint(chip, world));
    if (d == null || d > world.settings.nearKm) continue;
    if (!best || d < best.km) best = { chip, from: block, km: d };
  }
  return best;
}

// ---- the run plan ----------------------------------------------------------------------------

export type Stop =
  | { fixed: true; block: ContextBlock; time: string; point: Point | null }
  | { fixed: false; movement: MovementRow; time: string; point: Point | null; sequence: number };

/** The time a movement sits at: its own, else the half's default. */
export function movementTime(m: Pick<MovementRow, "time" | "half">, settings: MovementsSettings): string {
  return (m.time ?? (m.half ? settings.defaultHalfTime[m.half] : null) ?? settings.defaultHalfTime.AM).slice(0, 5);
}

/** The point a stop is at: a return → its job; a pickup from a branch → the branch; else the job, else the warehouse. */
export function stopPoint(m: MovementRow, world: World): Point | null {
  const job = jobById(world, m.work_order_id);
  if (RETURN_KINDS.has(m.kind) && job) return pointOfJob(world, job);
  if (m.assignee_kind === "person" && m.from_kind === "branch" && m.from_branch_id) {
    const b = world.branches.find((x) => x.id === m.from_branch_id);
    if (b && b.lat != null && b.lng != null) return { lat: b.lat, lng: b.lng };
  }
  if (job) return pointOfJob(world, job);
  if (m.to_kind === "warehouse" || m.from_kind === "warehouse") return warehousePoint(world);
  return chipPoint(m, world);
}

/** A person-day in run order: fixed context at its time; movements by sequence, then time; merged by time. */
export function orderedStops(world: World, laneId: string, day: string, blocks: readonly ContextBlock[] = contextBlocks(world)): Stop[] {
  const s = world.settings;
  const fixed: Stop[] = context(world, laneId, day, blocks)
    .filter((b) => b.kind !== "job" && b.kind !== "leave")
    .map((b) => ({ fixed: true, block: b, time: b.time ?? s.defaultHalfTime.AM, point: b.point }));
  const lane = laneId === SUPPLIER_LANE_ID ? { assignee_kind: "supplier" as const, id: null } : { assignee_kind: "person" as const, id: laneId };
  const mv = world.movements
    .filter((m) => m.due_date === day && m.assignee_kind === lane.assignee_kind && (m.assignee_id ?? null) === lane.id && m.status !== "tray" && m.status !== "cancelled")
    .sort((a, b) => (a.sequence ?? 99) - (b.sequence ?? 99) || timeOrder(a.time, a.half, s) - timeOrder(b.time, b.half, s) || a.created_at.localeCompare(b.created_at))
    .map((m, i): Stop => ({ fixed: false, movement: m, time: movementTime(m, s), point: stopPoint(m, world), sequence: i + 1 }));
  const all = [...fixed, ...mv];
  all.sort((a, b) => timeOrder(a.time, null, s) - timeOrder(b.time, null, s) || (a.fixed ? -1 : b.fixed ? 1 : (a as { sequence: number }).sequence - (b as { sequence: number }).sequence));
  return all;
}

export type RunPlanStop = Stop & { kmFromPrevious: number | null; n: number | null };
export type RunPlan = { stops: RunPlanStop[]; totalKm: number; stopCount: number };

/** The stops with distances from the warehouse out and back. */
export function runPlan(world: World, laneId: string, day: string, blocks: readonly ContextBlock[] = contextBlocks(world)): RunPlan {
  let prev = warehousePoint(world);
  let total = 0, n = 0;
  const stops: RunPlanStop[] = orderedStops(world, laneId, day, blocks).map((s) => {
    const d = km(prev, s.point);
    if (d != null) total += d;
    if (s.point) prev = s.point;
    if (!s.fixed) n += 1;
    return { ...s, kmFromPrevious: d, n: s.fixed ? null : n };
  });
  const back = km(prev, warehousePoint(world));
  if (back != null && stops.length > 0) total += back;
  return { stops, totalKm: Math.round(total * 10) / 10, stopCount: n };
}

export type ReorderPatch = { id: string; sequence: number; time: string; half: "AM" | "PM" };

/**
 * Ruling 22: the same set of times, handed out in the new order, so the week board and the
 * run plan agree. Returns what `movement_set_sequence` + `movement_set_time` should be given.
 * Ids not on that person-day are ignored; movements left out of the order keep their place after.
 */
export function reorder(world: World, laneId: string, day: string, newOrderIds: readonly string[]): ReorderPatch[] {
  const s = world.settings;
  const mine = orderedStops(world, laneId, day, []).flatMap((st) => (st.fixed ? [] : [st.movement]));
  const times = mine.map((m) => movementTime(m, s)).sort((a, b) => timeOrder(a, null, s) - timeOrder(b, null, s));
  const order = [...newOrderIds.filter((id) => mine.some((m) => m.id === id)), ...mine.map((m) => m.id).filter((id) => !newOrderIds.includes(id))];
  return order.map((id, i) => ({ id, sequence: i + 1, time: times[i], half: halfOf(times[i]) }));
}

// ---- the register ----------------------------------------------------------------------------

export type ItemState = "warehouse" | "site" | "person" | "repair" | "stranded" | "other";
export type ItemLocationView = {
  item: EquipmentItemRow;
  state: ItemState;
  /** The done movement that put it there (null = never moved: at the warehouse). */
  movement: MovementRow | null;
  job: Job | null;
  /** One line: "On site · 88 Station St, Fairfield · back Fri", "Warehouse", "With Mira Delaney". */
  detail: string;
  /** The open movement carrying it next (a planned return, an out in the tray), if any. */
  next: MovementRow | null;
};

/** `equipment_item_location`, in TS: the latest DONE movement carrying the item decides. */
export function itemLocation(itemId: string, world: { movements: readonly MovementRow[]; jobs: readonly Pick<Job, "id" | "stage">[] }): { state: ItemState; movement: MovementRow | null } {
  const carried = world.movements.filter((m) => m.status === "done" && m.items.some((i) => i.equipment_item_id === itemId))
    .sort((a, b) => (b.done_at ?? "").localeCompare(a.done_at ?? "") || b.updated_at.localeCompare(a.updated_at));
  const m = carried[0];
  if (!m) return { state: "warehouse", movement: null };
  const job = m.work_order_id ? world.jobs.find((j) => j.id === m.work_order_id) ?? null : null;
  if (m.kind === "repair_out") return { state: "repair", movement: m };
  if (m.kind === "equipment_return" || m.kind === "repair_back" || m.to_kind === "warehouse") return { state: "warehouse", movement: m };
  if (m.to_kind === "person") return { state: "person", movement: m };
  if (m.to_kind === "site" || m.kind === "equipment_out") return { state: job?.stage === "closed" ? "stranded" : "site", movement: m };
  return { state: "other", movement: m };
}

/** Per item: where it is and what carries it next. */
export function locations(world: World, laneNames: ReadonlyMap<string, string> = new Map()): ItemLocationView[] {
  return world.items.map((item) => {
    const { state, movement } = itemLocation(item.id, world);
    const job = jobById(world, movement?.work_order_id);
    const next = world.movements
      .filter((m) => isLive(m) || m.status === "tray")
      .filter((m) => m.items.some((i) => i.equipment_item_id === item.id))
      .sort((a, b) => (a.due_date ?? "9999").localeCompare(b.due_date ?? "9999"))[0] ?? null;
    const nextLine = next?.due_date ? ` · ${RETURN_KINDS.has(next.kind) ? "back" : "out"} ${next.due_date}` : "";
    const detail =
      state === "warehouse" ? `${world.settings.warehouse.label || "Warehouse"}${nextLine}`
      : state === "site" ? `On site · ${job?.address || movement?.to_text || ""}${nextLine}`
      : state === "stranded" ? `On site · job closed · ${job?.address || movement?.to_text || ""}${next ? ` · ${next.status === "tray" ? "return in the tray" : `return ${next.due_date ?? ""}`}` : ""}`
      : state === "person" ? `With ${laneNames.get(movement?.assignee_id ?? "") ?? movement?.to_text ?? "someone"}`
      : state === "repair" ? `Repair · ${movement?.to_text || ""}`
      : movement?.to_text || "";
    return { item, state, movement, job, detail: detail.replace(/\s+·\s*$/, ""), next };
  });
}

// ---- jobs ------------------------------------------------------------------------------------

/** What a job still needs: chips in the tray, or placed but not ordered (ruling 21's amber). */
export function jobNeeds(world: World, jobId: string): MovementRow[] {
  return world.movements.filter((m) => m.work_order_id === jobId && !isPainterDisposes(m) && m.status !== "cancelled" && m.status !== "done"
    && (m.status === "tray" || needsOrder(m)));
}

/** Ruling 4: the job's dates moved after the chip was placed — flag, never shift. */
export function jobMoved(m: Pick<MovementRow, "planned_for_start" | "status">, job: Pick<Job, "startDate"> | null): boolean {
  if (!job || !isLive(m) || !m.planned_for_start || !job.startDate) return false;
  return m.planned_for_start !== job.startDate;
}

export type Gates = {
  /** Every paint chip ordered or done, or a paint decision (not_needed / painter_supplies). */
  paint: boolean;
  /** Every gear chip (out, hire) booked or done, or an equipment decision. */
  gear: boolean;
  paintOrdered: number; paintTotal: number; gearBooked: number; gearTotal: number;
  /** The first chip in the way, for the console's blocker line. */
  paintBlocker: MovementRow | null; gearBlocker: MovementRow | null;
};

/** The two pre-start gate answers (brief §3.5; Session 7 redefines the tick to ask these). */
export function gates(world: World, jobId: string): Gates {
  const decided = (line: LogisticsDecisionRow["line"]) => world.decisions.some((d) => d.work_order_id === jobId && d.line === line);
  const mine = world.movements.filter((m) => m.work_order_id === jobId && m.status !== "cancelled");
  const paint = mine.filter((m) => m.kind === "paint");
  const gear = mine.filter((m) => m.kind === "equipment_out" || m.kind === "hire_on");
  const paintOk = (m: MovementRow) => m.status === "done" || m.ordered_at !== null;
  const gearOk = (m: MovementRow) => m.status === "done" || m.status === "booked";
  const paintBlocker = paint.find((m) => !paintOk(m)) ?? null;
  const gearBlocker = gear.find((m) => !gearOk(m)) ?? null;
  return {
    paint: decided("paint") || paintBlocker === null,
    gear: decided("equipment") || gearBlocker === null,
    paintOrdered: paint.filter(paintOk).length, paintTotal: paint.length,
    gearBooked: gear.filter(gearOk).length, gearTotal: gear.length,
    paintBlocker: decided("paint") ? null : paintBlocker, gearBlocker: decided("equipment") ? null : gearBlocker,
  };
}

export type Counts = { tray: number; placed: number; ordersToPlace: number; blocked: number };

/** The headline: chips in the tray, movements placed in the window, orders still to place. */
export function counts(world: World): Counts {
  const inWin = (m: MovementRow) => m.due_date !== null && m.due_date >= world.from && m.due_date <= world.to;
  const tray = trayChips(world);
  return {
    tray: tray.length,
    blocked: tray.filter((m) => blockedReason(m, world) !== null).length,
    placed: world.movements.filter((m) => isLive(m) && inWin(m)).length,
    ordersToPlace: world.movements.filter((m) => needsOrder(m) && inWin(m)).length,
  };
}

// ---- the drop (Session 4) ---------------------------------------------------------------------

export type DropVerdict = {
  /** The RPC would refuse this drop — the ghost says why and the drop is not sent. */
  blocked: boolean;
  /** Allowed, but outside the chip's window (brief §3.3): said on the ghost, warned after the drop. */
  warn: string | null;
  reason: string | null;
};

/**
 * What `movement_place` will say to this chip on this lane — the twin of the RPC's refusals
 * (supplier lane: own gear, a rubbish chip that is not a skip, a paint/materials chip whose
 * shop does not deliver; any lane: a blocked chip, an undecided rubbish chip) plus the window
 * warning. The database stays the rule; this lets the ghost say it before the pointer lets go.
 */
export function dropProblem(world: World, chip: MovementRow, lane: Pick<MovementLane, "kind">, day: string): DropVerdict {
  const refuse = (reason: string): DropVerdict => ({ blocked: true, warn: null, reason });
  const blockedBy = blockedReason(chip, world);
  if (blockedBy) return refuse(blockedBy);
  if (isUndecidedRubbish(chip)) return refuse("say how the rubbish goes first — open the chip");
  if (lane.kind === "supplier") {
    const supplierKinds: ReadonlySet<MovementKind> = new Set(["paint", "materials", "hire_on", "hire_off", "rubbish_in", "rubbish_out"]);
    if (!supplierKinds.has(chip.kind) || (chip.kind === "rubbish_out" && !chip.to_branch_id)) {
      return refuse(chip.kind === "rubbish_out" ? "only a skip goes on the Supplier lane — drop it on a person" : "our own gear can't be delivered by a supplier — drop it on a person");
    }
    if ((chip.kind === "paint" || chip.kind === "materials") && chip.from_branch_id) {
      const b = world.branches.find((x) => x.id === chip.from_branch_id);
      if (b && !b.delivers_to_site) return refuse(`${b.brand} ${b.branch} doesn't deliver — pick a delivering shop in the chip, or drop it on a painter`);
    }
  }
  const w = chipWindow(chip, jobById(world, chip.work_order_id));
  if (!inWindow(w, day)) {
    return { blocked: false, reason: null, warn: RETURN_KINDS.has(chip.kind) ? "before the job ends — fine if the painter has finished with it" : "after the job starts — the painter will be waiting on it" };
  }
  return { blocked: false, warn: null, reason: null };
}

/** The tray's groups: one per job (closed jobs with stranded gear as their own), Warehouse last. */
export type TrayGroup = { key: string; job: Job | null; title: string; sub: string; closed: boolean };

export function trayGroupOf(world: World, chip: MovementRow, painterName: (contractorId: string | null) => string | null): TrayGroup {
  const job = jobById(world, chip.work_order_id);
  if (!job) return { key: "warehouse", job: null, title: world.settings.warehouse.label || "Warehouse", sub: "no job", closed: false };
  const painter = painterName(job.contractorId);
  const closed = job.stage === "closed";
  const dates = job.startDate ? `${shortDay(job.startDate)}–${job.endDate ? shortDay(job.endDate) : "?"}` : "no dates";
  return {
    key: job.id, job, title: job.address.split(",").slice(0, 2).join(",") || job.title,
    sub: `${painter ? `${painter.split(" ")[0]} · ` : ""}${closed ? `closed${job.endDate ? ` ${shortDay(job.endDate)}` : ""}` : dates}`, closed,
  };
}

const SHORT_DAY = new Intl.DateTimeFormat("en-AU", { weekday: "short", day: "numeric", timeZone: "UTC" });
/** "Mon 19" — a date as the board's header says it. */
export function shortDay(iso: string): string {
  const d = new Date(`${iso}T00:00:00Z`);
  return Number.isNaN(d.getTime()) ? iso : SHORT_DAY.format(d).replace(",", "");
}

/** Which tray filter a chip answers to: paint · materials · gear · rubbish. */
export function chipFilterKind(m: Pick<MovementRow, "kind">): "paint" | "materials" | "gear" | "rubbish" {
  switch (m.kind) {
    case "paint": return "paint";
    case "materials": case "restock": return "materials";
    case "rubbish_in": case "rubbish_out": return "rubbish";
    default: return "gear";
  }
}
