import { cansFor, type WOMaterial } from "@/lib/workorder/snapshot";
import type {
  BranchKind, BranchRow, LogisticsDecisionRow, MaterialLineRow, MovementKind, MovementLine, MovementRow, PlaceKind, Point,
} from "./types";

/**
 * Movements — the TypeScript mirror of `movements_sync_for_wo` (migration 20270279 §10,
 * brief §3.2). PURE: it never touches the database and never writes anything. It takes the
 * same inputs the RPC reads and returns the plan the RPC would carry out, so a test can run
 * both on one fixture and compare them (`sync.test.ts` golden over the e2e fixture;
 * `e2e/movements-sync-mirror.spec.ts` on the C1 test project, through the staff session).
 *
 * The database is the one writer. This mirror exists so a screen can say what the sync
 * WILL do (Sources view: "this line becomes a chip") and so the rule has a readable twin;
 * a difference between the two is a defect in whichever one drifted. Rules, in the RPC's
 * order:
 *
 *   paint      one chip per product brand from the Materials rows, `paint:<brand>`; brand by
 *              product NAME through products.brand, blank → `paint:brand?` / "Paint (brand?)";
 *              default branch = nearest DELIVERING paint branch of that brand, favourites first
 *   materials  one chip per line not merged into another, `matline:<id>`; NO default shop (21 Oct)
 *   rubbish    one undecided chip per job, `rubbish`, until the office answers how (ruling 20)
 *   removal    a tray chip whose source went away is deleted; a placed, ORDERED chip whose
 *              source went away or changed is flagged (`source_changed_at`), never touched otherwise
 *   closed job every done equipment_out whose gear is still on this site gets its `return:<id>`
 *              chip (the same chip `movements_after_booked` makes at booking — `autoReturnFor`)
 */

// ---- inputs ----------------------------------------------------------------------------

export type SyncWorkOrder = {
  id: string;
  stage: string;
  /** null = not issued: the sync does nothing (`ok:not_issued`). */
  wo_snapshot: { materials?: WOMaterial[] | null; jobAddress?: string | null } | null;
  job_no: number | null;
  wo_ref: string | null;
  end_date: string | null;
};

/** `products.name` → `products.brand`, latest `effective_from` first (the RPC's lateral join). */
export type ProductRow = { name: string; brand: string | null; effective_from: string | null };

/** What `equipment_item_location` answers for an item (brief §3.3 locations; evaluate.ts computes it). */
export type ItemLocation = { state: string; movement_id: string | null; work_order_id: string | null };

export type SyncInput = {
  workOrder: SyncWorkOrder;
  products: readonly ProductRow[];
  /** Every movement on this work order (any status). */
  movements: readonly MovementRow[];
  materialLines: readonly MaterialLineRow[];
  decisions: readonly LogisticsDecisionRow[];
  branches: readonly BranchRow[];
  /** The job's point (suburb centroid in v1) — `jobPoint()` below is the RPC's parse. */
  jobPoint: Point | null;
  /** Where each item on this job's done outs is now (closed jobs only). */
  itemLocations: ReadonlyMap<string, ItemLocation>;
  /** The instant the sync runs — what `now()` would stamp on `source_changed_at`. */
  now: string;
};

// ---- outputs ---------------------------------------------------------------------------

/** A chip the sync would insert, column for column. */
export type NewChip = {
  work_order_id: string | null;
  kind: MovementKind;
  source_key: string;
  title: string;
  detail: string | null;
  from_kind: PlaceKind | null;
  from_branch_id: string | null;
  from_text: string;
  to_kind: PlaceKind | null;
  to_branch_id: string | null;
  to_text: string;
  status: "tray";
  due_date: string | null;
  order_ref: string;
  /** The live Materials rows behind a paint chip (what `lines` freezes at ordering). */
  rows?: MovementLine[];
  /** Gear copied from the out onto its auto return. */
  items?: { equipment_item_id: string; label: string }[];
};

export type RefreshPatch = {
  id: string;
  title: string;
  detail: string | null;
  to_text: string;
  from_branch_id: string | null;
  from_text: string;
  order_ref: string;
  /** True when a column actually changes — the RPC counts the chip as refreshed either way. */
  changed: boolean;
};

export type SyncPlan = {
  /** `ok:<created>:<refreshed>:<removed>` — the RPC's return, or `ok:not_issued`. */
  result: string;
  create: NewChip[];
  refresh: RefreshPatch[];
  /** Placed, ordered chips that get `source_changed_at = coalesce(source_changed_at, now)`. */
  flag: string[];
  /** Tray chips deleted because their source went away. */
  remove: string[];
  /** The chip set after the plan: existing rows (patched, flagged) plus the new ones, keyed by source_key. */
  after: Map<string, MovementRow | NewChip>;
};

// ---- the shared helpers (SQL twins) -------------------------------------------------------

/** `movements_km`: great-circle distance in km; null when a point is missing. */
export function km(a: Point | null | undefined, b: Point | null | undefined): number | null {
  if (!a || !b) return null;
  const r = (d: number) => (d * Math.PI) / 180;
  const h = Math.sin(r(b.lat - a.lat) / 2) ** 2 + Math.cos(r(a.lat)) * Math.cos(r(b.lat)) * Math.sin(r(b.lng - a.lng) / 2) ** 2;
  return 2 * 6371 * Math.asin(Math.min(1, Math.sqrt(h)));
}

/** `movements_cans`: fewest cans for whole litres — the same answer as `cansFor`. */
export function cansOf(litres: number | null | undefined): number {
  return cansFor(litres ?? 0).reduce((n, c) => n + c.count, 0);
}

/** `movements_job_ref`: PG-#### when the job has a number, else its WO ref. */
export function jobRef(wo: { job_no: number | null; wo_ref: string | null }): string {
  return wo.job_no != null ? `PG-${String(wo.job_no).padStart(4, "0")}` : (wo.wo_ref ?? "");
}

/**
 * `movements_job_point`: the first comma-separated part of the address that names a suburb
 * the visit map knows, with a trailing "VIC 3xxx" stripped. `suburbs` is lower-cased suburb →
 * centroid (first by postcode, as the SQL orders it).
 */
export function jobPoint(address: string | null | undefined, suburbs: ReadonlyMap<string, Point>): Point | null {
  for (const raw of (address ?? "").split(",")) {
    const part = raw.replace(/\s+(VIC|Victoria)(\s+[0-9]{4})?\s*$/i, "").trim();
    if (!part) continue;
    const hit = suburbs.get(part.toLowerCase());
    if (hit) return hit;
  }
  return null;
}

/** `movements_nearest_branch`: active, of the kind (and brand prefix), favourites first, then km (nulls last), then name. */
export function nearestBranch(
  branches: readonly BranchRow[], kind: BranchKind, brand: string | null, at: Point | null, delivering: boolean,
): BranchRow | null {
  const want = brand ? brand.trim().toLowerCase() : null;
  const pool = branches.filter((b) => b.active && b.kind === kind
    && (want === null || b.brand.toLowerCase().startsWith(want))
    && (!delivering || b.delivers_to_site));
  const dist = (b: BranchRow) => km(at, b.lat != null && b.lng != null ? { lat: b.lat, lng: b.lng } : null);
  pool.sort((a, b) => {
    if (a.favourite !== b.favourite) return a.favourite ? -1 : 1;
    const da = dist(a), db = dist(b);
    if (da == null && db != null) return 1;
    if (db == null && da != null) return -1;
    if (da != null && db != null && da !== db) return da - db;
    return a.branch.localeCompare(b.branch);
  });
  return pool[0] ?? null;
}

/** `movements_branch_text`: "Brand Branch, address" ('' when none). */
export function branchText(b: BranchRow | null | undefined): string {
  if (!b) return "";
  return `${b.brand} ${b.branch}${b.address ? `, ${b.address}` : ""}`;
}

/** `movements_site_text`: the job address, cut to 200. */
export function siteText(wo: Pick<SyncWorkOrder, "wo_snapshot">): string {
  return (wo.wo_snapshot?.jobAddress ?? "").slice(0, 200);
}

/** The RPC's lateral join: the brand of the product with that name, latest effective_from first. */
export function brandIndex(products: readonly ProductRow[]): Map<string, string> {
  const sorted = [...products].sort((a, b) => (b.effective_from ?? "").localeCompare(a.effective_from ?? ""));
  const out = new Map<string, string>();
  for (const p of sorted) {
    const key = p.name.trim().toLowerCase();
    if (!out.has(key)) out.set(key, (p.brand ?? "").trim());
  }
  return out;
}

/** `movement_needs_order`: supplier lane, or a person picking up from a branch. */
export function rpcNeedsOrder(m: Pick<MovementRow, "assignee_kind" | "from_kind">): boolean {
  return m.assignee_kind === "supplier" || (m.assignee_kind === "person" && m.from_kind === "branch");
}

const NIL = "00000000-0000-0000-0000-000000000000";
const woKey = (id: string | null) => id ?? NIL;

/**
 * `movements_after_booked`: the auto return a booked out owes — `return:<id>` for an
 * equipment_out, `hire_off:<id>` for a hire_on (as hire_off) and for a rubbish_in (as
 * rubbish_out). Null when the kind has no return or the key already exists on the job.
 * Dated to the chosen return_due, else the job's end date — a hint; it stays a tray chip.
 */
export function autoReturnFor(
  m: MovementRow, wo: Pick<SyncWorkOrder, "end_date" | "wo_snapshot"> | null, existing: readonly MovementRow[], branches: readonly BranchRow[],
): NewChip | null {
  let key: string, kind: MovementKind, title: string, to_kind: PlaceKind, to_branch_id: string | null = null, to_text: string;
  const branch = branches.find((b) => b.id === m.from_branch_id) ?? null;
  if (m.kind === "equipment_out") {
    key = `return:${m.id}`; kind = "equipment_return"; title = `Collect ${m.title}`; to_kind = "warehouse"; to_text = "Warehouse";
  } else if (m.kind === "hire_on") {
    key = `hire_off:${m.id}`; kind = "hire_off"; title = `Off-hire ${m.title}`; to_kind = "branch"; to_branch_id = m.from_branch_id; to_text = branchText(branch);
  } else if (m.kind === "rubbish_in") {
    key = `hire_off:${m.id}`; kind = "rubbish_out"; title = "Skip out"; to_kind = "branch"; to_branch_id = m.from_branch_id; to_text = branchText(branch);
  } else {
    return null;
  }
  if (existing.some((x) => woKey(x.work_order_id) === woKey(m.work_order_id) && x.source_key === key)) return null;
  const due = m.return_due ?? wo?.end_date ?? null;
  return {
    work_order_id: m.work_order_id, kind, source_key: key, title: title.slice(0, 160), detail: `auto return for ${m.title}`,
    from_kind: "site", from_branch_id: null, from_text: m.work_order_id === null ? m.to_text : siteText(wo ?? { wo_snapshot: null }),
    to_kind, to_branch_id, to_text: to_text.slice(0, 200), status: "tray", due_date: due, order_ref: m.order_ref,
    items: m.items.map((i) => ({ equipment_item_id: i.equipment_item_id, label: i.label })),
  };
}

// ---- the paint rows, grouped by brand (the RPC's first loop) ---------------------------------

export type PaintGroup = { brand: string; key: string; label: string; n: number; cans: number; rows: MovementLine[] };

/** The Materials rows by product brand, in the shape the sync titles and freezes. */
export function paintGroups(materials: readonly WOMaterial[] | null | undefined, brandOf: ReadonlyMap<string, string>): PaintGroup[] {
  const groups = new Map<string, PaintGroup>();
  for (const m of materials ?? []) {
    if (!m.product) continue;
    const brand = brandOf.get(m.product.trim().toLowerCase()) ?? "";
    const g = groups.get(brand) ?? {
      brand, key: `paint:${brand === "" ? "brand?" : brand}`, label: brand === "" ? "Paint (brand?)" : brand, n: 0, cans: 0, rows: [],
    };
    g.n += 1;
    g.cans += cansOf(m.litres);
    g.rows.push({
      rowKey: m.colourKey ?? m.product, product: m.product, colourName: m.colourName ?? null, colourHex: m.colourHex ?? null,
      colourStatus: m.colourStatus ?? null, litres: m.litres ?? null, cans: cansOf(m.litres),
    });
    groups.set(brand, g);
  }
  for (const g of groups.values()) g.rows.sort((a, b) => a.rowKey.localeCompare(b.rowKey));
  return [...groups.values()];
}

/** "Dulux · 4 lines · 6 cans" — the chip's first line. */
export function paintTitle(g: Pick<PaintGroup, "label" | "n" | "cans">): string {
  return `${g.label} · ${g.n} ${g.n === 1 ? "line" : "lines"} · ${g.cans} ${g.cans === 1 ? "can" : "cans"}`.slice(0, 160);
}

const lineDetail = (source: MaterialLineRow["source"]) =>
  source === "estimate" ? "from the estimate" : source === "painter_request" ? "asked for by the painter" : "from the job page";

/** `lines` as stored vs the rows as computed — equal when every row matches field for field. */
export function linesEqual(a: MovementLine[] | null, b: MovementLine[] | null): boolean {
  if (a === null || b === null) return a === b;
  if (a.length !== b.length) return false;
  const norm = (l: MovementLine) => JSON.stringify([l.rowKey, l.product, l.colourName ?? null, l.colourHex ?? null, l.colourStatus ?? null, l.litres == null ? null : Number(l.litres), l.cans]);
  const sa = a.map(norm).sort(), sb = b.map(norm).sort();
  return sa.every((x, i) => x === sb[i]);
}

// ---- the sync -----------------------------------------------------------------------------

export function syncForWo(input: SyncInput): SyncPlan {
  const { workOrder: wo, movements, branches } = input;
  const plan: SyncPlan = { result: "", create: [], refresh: [], flag: [], remove: [], after: new Map() };
  for (const m of movements) if (m.source_key) plan.after.set(m.source_key, m);
  if (wo.wo_snapshot === null) { plan.result = "ok:not_issued"; return plan; }

  const site = siteText(wo);
  const ref = jobRef(wo);
  const decision = (line: LogisticsDecisionRow["line"]) => input.decisions.find((d) => d.work_order_id === wo.id && d.line === line)?.decision ?? null;
  const byKey = (key: string) => movements.find((m) => m.work_order_id === wo.id && m.source_key === key) ?? null;
  const seen = new Set<string>();
  let created = 0, refreshed = 0, removed = 0;

  const refreshTray = (m: MovementRow, title: string, detail: string | null, branch: BranchRow | null) => {
    const takeBranch = m.from_branch_id === null && branch !== null;
    const patch: RefreshPatch = {
      id: m.id, title, detail, to_text: site,
      from_branch_id: m.from_branch_id ?? branch?.id ?? null,
      from_text: takeBranch ? branchText(branch) : m.from_text,
      order_ref: m.order_ref === "" ? ref : m.order_ref,
      changed: m.title !== title || (m.detail ?? null) !== detail || m.to_text !== site || takeBranch,
    };
    plan.refresh.push(patch);
    refreshed += 1;
    plan.after.set(m.source_key!, { ...m, title, detail, to_text: patch.to_text, from_branch_id: patch.from_branch_id, from_text: patch.from_text, order_ref: patch.order_ref });
  };
  const flag = (m: MovementRow) => {
    plan.flag.push(m.id);
    plan.after.set(m.source_key!, { ...m, source_changed_at: m.source_changed_at ?? input.now });
  };

  if (wo.stage !== "closed") {
    // Paint: one chip per product brand.
    if (decision("paint") === null) {
      for (const g of paintGroups(wo.wo_snapshot.materials, brandIndex(input.products))) {
        const title = paintTitle(g);
        const detail = "from the Materials card";
        const branch = g.brand === "" ? null : nearestBranch(branches, "paint", g.brand, input.jobPoint, true);
        const existing = byKey(g.key);
        if (!existing) {
          plan.create.push({
            work_order_id: wo.id, kind: "paint", source_key: g.key, title, detail, from_kind: "branch", from_branch_id: branch?.id ?? null,
            from_text: branchText(branch), to_kind: "site", to_branch_id: null, to_text: site, status: "tray", due_date: null, order_ref: ref, rows: g.rows,
          });
          created += 1;
        } else if (existing.status === "tray") {
          refreshTray(existing, title, detail, branch);
        } else if (existing.ordered_at !== null && !linesEqual(existing.lines, g.rows)) {
          // The RPC's guard is `lines is distinct from rows` — a title change alone with equal lines flags nothing.
          flag(existing);
        }
        seen.add(g.key);
      }
    }

    // Materials: one chip per line not merged into another.
    if (decision("materials") === null) {
      const lines = input.materialLines
        .filter((l) => l.work_order_id === wo.id && l.merged_into === null)
        .sort((a, b) => a.sort - b.sort || a.created_at.localeCompare(b.created_at));
      for (const l of lines) {
        const key = `matline:${l.id}`;
        const title = l.text.slice(0, 160);
        const detail = lineDetail(l.source);
        // Tom, 21 Oct 2026: no default shop — the office confirms the shop and delivery / pickup in the chip.
        const branch = null;
        const existing = byKey(key);
        if (!existing) {
          plan.create.push({
            work_order_id: wo.id, kind: "materials", source_key: key, title, detail, from_kind: null, from_branch_id: null,
            from_text: "", to_kind: "site", to_branch_id: null, to_text: site, status: "tray", due_date: null, order_ref: ref,
          });
          created += 1;
        } else if (existing.status === "tray") {
          refreshTray(existing, title, detail, branch);
        } else if (existing.ordered_at !== null && existing.title !== title) {
          flag(existing);
        }
        seen.add(key);
      }
    }

    // Rubbish: one undecided chip per job until the office answers how (ruling 20).
    if (decision("rubbish") === null) {
      if (!byKey("rubbish")) {
        plan.create.push({
          work_order_id: wo.id, kind: "rubbish_out", source_key: "rubbish", title: "Rubbish — how?", detail: "undecided",
          from_kind: "site", from_branch_id: null, from_text: site, to_kind: null, to_branch_id: null, to_text: "", status: "tray", due_date: null, order_ref: ref,
        });
        created += 1;
      }
      seen.add("rubbish");
    }

    // A tray chip whose source went away; a placed, ordered chip whose source went away is flagged.
    const synced = (k: string | null) => k !== null && (k.startsWith("paint:") || k.startsWith("matline:") || k === "rubbish");
    for (const m of movements) {
      if (m.work_order_id !== wo.id || !synced(m.source_key) || seen.has(m.source_key!)) continue;
      if (m.status === "tray") {
        plan.remove.push(m.id); removed += 1; plan.after.delete(m.source_key!);
      } else if ((m.status === "planned" || m.status === "booked" || m.status === "problem") && m.ordered_at !== null && m.source_key !== "rubbish") {
        flag(m);
      }
    }
  } else {
    // Closed job: every item the register still shows on this site gets its return chip.
    const outs = movements.filter((m) => m.work_order_id === wo.id && m.kind === "equipment_out" && m.status === "done")
      .filter((m) => m.items.some((i) => {
        const loc = input.itemLocations.get(i.equipment_item_id);
        return loc?.state === "stranded" && loc.work_order_id === wo.id;
      }));
    for (const out of outs) {
      const chip = autoReturnFor(out, wo, [...movements, ...plan.create.map(asRow)], branches);
      if (chip) { plan.create.push(chip); created += 1; }
    }
  }

  for (const c of plan.create) plan.after.set(c.source_key, c);
  plan.result = `ok:${created}:${refreshed}:${removed}`;
  return plan;
}

/** A new chip as a row, so the closed-job loop can see what it has already planned. */
function asRow(c: NewChip): MovementRow {
  return {
    id: `new:${c.source_key}`, work_order_id: c.work_order_id, kind: c.kind, source_key: c.source_key, title: c.title, detail: c.detail,
    assignee_kind: null, assignee_table: null, assignee_id: null, due_date: c.due_date, half: null, time: null, sequence: null,
    from_kind: c.from_kind, from_branch_id: c.from_branch_id, from_text: c.from_text, to_kind: c.to_kind, to_branch_id: c.to_branch_id, to_text: c.to_text,
    status: "tray", ordered_at: null, method_pref: null, client_notice: false, order_ref: c.order_ref, lines: null, planned_for_start: null, return_due: null,
    blocked_by_movement_id: null, expected_cost_cents: null, note: "", problem_note: "", painter_confirmed_at: null, source_changed_at: null,
    booked_at: null, done_at: null, created_at: "", updated_at: "", items: c.items?.map((i) => ({ movement_id: `new:${c.source_key}`, ...i })) ?? [],
  };
}
