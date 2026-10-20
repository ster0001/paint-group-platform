import type { MovementKind, MovementLine, MovementStatus, PlaceKind } from "./types";

/**
 * Movements — what a PAINTER reads (brief §3.4 "Painter portal + job sheet", Session 5).
 *
 * Pure: it turns the rows `movements_for_painter` returns (already column-limited by the
 * definer function — no cost, no office note unless flagged, no account, no branch email)
 * into the lines the job sheet shows under Materials & colours and the "Your pickups and
 * drop-offs today" card on the portal home. Nothing here reads, writes or decides a rule:
 * the status words come from the row, the shop from `supplier_branches_for_painter`.
 */

export type PainterMovementRow = {
  id: string; work_order_id: string | null; kind: MovementKind; source_key: string | null; title: string; detail: string | null;
  status: MovementStatus; due_date: string | null; half: "AM" | "PM" | null; time: string | null; sequence: number | null;
  from_kind: PlaceKind | null; from_branch_id: string | null; from_text: string; to_kind: PlaceKind | null; to_branch_id: string | null; to_text: string;
  order_ref: string; note: string; lines: MovementLine[] | null; ordered_at: string | null; painter_confirmed_at: string | null;
  run_plan_sent_at: string | null; mine: boolean;
};

export type PainterBranch = { id: string; brand: string; branch: string; address: string; suburb: string; phone: string; opens_weekday: string | null; map_place_id: string | null };

/** One line the painter reads, with the two taps it may carry. */
export type PainterLine = {
  id: string;
  section: "paint" | "materials" | "gear" | "rubbish";
  /** The sentence: "Pick up at Paint Spot Carnegie, 1066 Dandenong Rd, from 6:30 Tue 20 — order PG-0093 under Paint Group". */
  text: string;
  /** What the chip is — "Dulux · 4 lines · 6 cans" — shown bold before the sentence. */
  what: string;
  /** The movement is on THIS painter's lane and still open: the tick is theirs to press. */
  tick: "Picked up" | "Dropped off" | "Returned" | "Done" | null;
  done: boolean;
  /** A shop to navigate to and ring, when the painter is the one going there. */
  shop: { name: string; address: string; phone: string; mapsUrl: string } | null;
  /** The lines of a paint chip (frozen at ordering, else live) — the trade-counter list. */
  lines: MovementLine[];
  note: string;
  day: string | null;
  time: string | null;
};

export type JobLogistics = { paint: PainterLine[]; materials: PainterLine[]; gear: PainterLine[]; rubbish: PainterLine[]; any: boolean };

const DAY = new Intl.DateTimeFormat("en-AU", { timeZone: "Australia/Melbourne", weekday: "short", day: "numeric", month: "short" });
/** "Tue 20 Oct" from an ISO date — a calendar day, never the UTC date. */
export function painterDay(iso: string | null): string {
  if (!iso) return "";
  const [y, m, d] = iso.split("-").map(Number);
  const parts = DAY.formatToParts(new Date(Date.UTC(y, m - 1, d, 2)));
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? "";
  return `${get("weekday")} ${get("day")} ${get("month")}`;
}

export function clock12(t: string | null): string {
  if (!t) return "";
  const [h, mm] = t.slice(0, 5).split(":").map(Number);
  const hour = h % 12 === 0 ? 12 : h % 12;
  return `${hour}:${String(mm).padStart(2, "0")} ${h >= 12 ? "pm" : "am"}`;
}

const whenOf = (m: Pick<PainterMovementRow, "time" | "half">) => (m.time ? clock12(m.time) : m.half === "PM" ? "afternoon" : "morning");

export function mapsUrl(address: string, placeId: string | null): string {
  const q = encodeURIComponent(address);
  return placeId ? `https://www.google.com/maps/search/?api=1&query=${q}&query_place_id=${encodeURIComponent(placeId)}` : `https://www.google.com/maps/search/?api=1&query=${q}`;
}

function shopOf(branchId: string | null, branches: readonly PainterBranch[]): PainterLine["shop"] {
  const b = branchId ? branches.find((x) => x.id === branchId) : null;
  if (!b) return null;
  const address = [b.address, b.suburb].filter(Boolean).join(", ");
  return { name: `${b.brand} ${b.branch}`, address, phone: b.phone, mapsUrl: mapsUrl(`${b.brand} ${b.branch}, ${address}`, b.map_place_id) };
}

const isSkip = (m: PainterMovementRow) => m.kind === "rubbish_in" || (m.kind === "rubbish_out" && (m.source_key ?? "").startsWith("hire_off:"));
const sectionOf = (m: PainterMovementRow): PainterLine["section"] =>
  m.kind === "paint" ? "paint" : m.kind === "materials" || m.kind === "restock" ? "materials"
    : m.kind === "rubbish_in" || m.kind === "rubbish_out" ? "rubbish" : "gear";

/** The sentence and the tick for one row. */
export function painterLine(m: PainterMovementRow, branches: readonly PainterBranch[]): PainterLine | null {
  if (m.status === "cancelled") return null;
  const section = sectionOf(m);
  const day = painterDay(m.due_date);
  const when = whenOf(m);
  const done = m.status === "done";
  const open = m.status === "booked" && m.mine;
  const shop = m.mine && m.from_kind === "branch" ? shopOf(m.from_branch_id, branches) : null;
  const order = m.order_ref ? ` — order ${m.order_ref} under Paint Group` : "";
  let text = ""; let tick: PainterLine["tick"] = null;

  if (m.status === "tray") {
    text = section === "rubbish" ? "Rubbish: the office will say how it goes." : "Not arranged yet — the office will tell you how it gets to site.";
  } else if (section === "rubbish") {
    if (isSkip(m)) text = m.kind === "rubbish_in" ? `Skip arrives ${day} ${when}.` : `Skip goes ${day}.`;
    else if (m.detail === "painter disposes of it") text = "You dispose of the rubbish as you go.";
    else if (m.to_kind === "warehouse" && m.mine) { text = `Drop the rubbish at the warehouse on ${day}.`; tick = open ? "Dropped off" : null; }
    else if (m.to_kind === "tip" && m.mine) { text = `Take the rubbish to the tip ${day} — claim the fee under Expenses.`; tick = open ? "Done" : null; }
    else text = `Leave the rubbish on site — it is collected ${day}.`;
  } else if (m.kind === "equipment_return" || m.kind === "hire_off" || m.kind === "repair_back") {
    if (m.mine) { text = `Bring ${m.kind === "hire_off" ? "the hire gear" : "it"} back to the warehouse ${day}.`; tick = open ? "Returned" : null; }
    else text = `Collected from site ${day}${m.kind === "hire_off" ? " by the hire company" : ""}.`;
  } else if (m.mine && m.from_kind === "branch") {
    // The pickup — the line the whole order step exists for.
    const from = shop ? `${shop.name}, ${shop.address}` : m.from_text || "the shop";
    const b = m.from_branch_id ? branches.find((x) => x.id === m.from_branch_id) : null;
    const fromTime = b?.opens_weekday ? `from ${clock12(b.opens_weekday)} ` : m.time ? `${clock12(m.time)} ` : "";
    text = m.ordered_at
      ? `Pick up at ${from}, ${fromTime}${day}${order}.`
      : `Pick up at ${from} on ${day} — the office will text you when it is ready.`;
    tick = open && m.ordered_at ? "Picked up" : null;
  } else if (m.mine) {
    text = `Take ${section === "gear" ? "it" : "them"} to site ${day} ${when}.`;
    tick = open ? "Dropped off" : null;
  } else if (m.from_kind === "branch" || m.kind === "hire_on") {
    text = m.ordered_at ? `Delivered to site ${day}, ${when}${order}.` : `Delivery being arranged for ${day}.`;
  } else {
    text = `Brought to site ${day} ${when}.`;
  }
  if (done) text = text.replace(/\.$/, "") + (m.painter_confirmed_at ? " ✓" : " — done ✓");

  return {
    id: m.id, section, text, what: m.title, tick: done ? null : tick, done, shop, lines: m.lines ?? [], note: m.note,
    day: m.due_date, time: m.time ? m.time.slice(0, 5) : null,
  };
}

/** The job sheet's four groups for one job. */
export function jobLogistics(rows: readonly PainterMovementRow[], branches: readonly PainterBranch[], workOrderId: string): JobLogistics {
  const out: JobLogistics = { paint: [], materials: [], gear: [], rubbish: [], any: false };
  for (const m of rows) {
    if (m.work_order_id !== workOrderId) continue;
    const line = painterLine(m, branches);
    if (!line) continue;
    out[line.section].push(line);
    out.any = true;
  }
  return out;
}

/** "Your pickups and drop-offs today": every open movement on THIS painter's lane that day, in run order. */
export function todayStops(rows: readonly PainterMovementRow[], branches: readonly PainterBranch[], day: string): PainterLine[] {
  return rows
    .filter((m) => m.mine && m.due_date === day && m.status !== "tray" && m.status !== "cancelled")
    .sort((a, b) => (a.sequence ?? 99) - (b.sequence ?? 99) || (a.time ?? (a.half === "PM" ? "13:00" : "07:00")).localeCompare(b.time ?? (b.half === "PM" ? "13:00" : "07:00")))
    .flatMap((m) => { const l = painterLine(m, branches); return l ? [l] : []; });
}
