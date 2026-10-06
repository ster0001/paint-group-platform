/**
 * Visit zones — the resolver (addendum A §4.1) and the Settings reads.
 *
 * The property address decides everything about a site visit. The answer is
 * one of `zone_1`…`zone_5`, `pre_arranged`, `out_of_area`, or `unmapped` (a
 * Victorian suburb the list does not know — sent down the request-a-time path
 * and raised in the work queue, never silently rejected). Looked up by SUBURB
 * AND POSTCODE together: Glen Waverley (Zone 1) and Wheelers Hill (Zone 3)
 * share 3150; Parkdale (Zone 1) and Mordialloc (Zone 4) share 3195.
 *
 * Decided on the server. The browser never sends a zone; it sends an address
 * the wizard already stores, and the server reads the list.
 *
 * `resolveFromList` is pure and is what the tests drive. `resolveZone` reads
 * the table — with the SERVICE client when a customer is asking, because
 * customers have no table access (the same shape as /api/places/details).
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import { isZoneStatus, type ZoneStatus } from "./zoneGeo";

export type { ZoneStatus } from "./zoneGeo";
export { ZONE_STATUSES, isZoneStatus } from "./zoneGeo";

export const ZONE_KEYS = ["zone_1", "zone_2", "zone_3", "zone_4", "zone_5"] as const;
export type ZoneKey = (typeof ZONE_KEYS)[number];

export type ZoneOutcome = ZoneStatus | "unmapped";

export const ZONE_STATUS_LABEL: Record<ZoneStatus, string> = {
  zone_1: "Zone 1", zone_2: "Zone 2", zone_3: "Zone 3", zone_4: "Zone 4", zone_5: "Zone 5",
  pre_arranged: "Pre-arranged", out_of_area: "Out of area",
};

export function isZoneKey(v: unknown): v is ZoneKey {
  return typeof v === "string" && (ZONE_KEYS as readonly string[]).includes(v);
}

/** One row of `visit_suburbs`, as the resolver and the Settings screen see it. */
export type SuburbRow = {
  id: string;
  suburb: string;
  postcode: string;
  status: ZoneStatus;
  far_edge: boolean;
  reviewed: boolean;
  basis: string;
  lat: number | null;
  lng: number | null;
};

export type ZoneRow = { key: ZoneKey; label: string; estimator_id: string | null; estimator_name: string | null };

export type UnmappedRow = {
  id: string;
  suburb: string;
  postcode: string;
  state: string;
  first_seen_at: string;
  last_seen_at: string;
  hits: number;
  last_estimate_id: string | null;
};

/** How a suburb name is compared: trimmed, single-spaced, case-folded. */
export function normaliseSuburb(s: string | null | undefined): string {
  return (s ?? "").trim().replace(/\s+/g, " ").toLowerCase();
}

/** Four digits or nothing; "3150 " and "VIC 3150" both give "3150". */
export function normalisePostcode(p: string | null | undefined): string {
  const m = (p ?? "").match(/\d{4}/);
  return m ? m[0] : "";
}

export type ResolveInput = { suburb: string | null | undefined; postcode: string | null | undefined; state?: string | null };

export type Resolution = {
  outcome: ZoneOutcome;
  /** R18 — only meaningful for a bookable zone. */
  farEdge: boolean;
  /** The matched row, when there was one. */
  row: Pick<SuburbRow, "id" | "suburb" | "postcode" | "status"> | null;
  /** Why this answer: for the Settings check box and the session report. */
  basis: "suburb_and_postcode" | "suburb_only_unique" | "not_victoria" | "unmapped";
};

/**
 * The pure rule. `rows` is every list row whose suburb matches by name (the
 * caller filtered; passing the whole list also works).
 *
 *  1. Suburb AND postcode match → that row.
 *  2. Only the suburb matches, and exactly one row carries that name → that
 *     row (a postcode typo must not send a Zone 1 customer to request-a-time).
 *     Two rows with the name and no postcode match → unmapped, because the
 *     postcode is the only thing that tells Glen Waverley from Wheelers Hill.
 *  3. A state that is given and is not Victoria → out of area, not unmapped.
 *  4. Otherwise unmapped.
 */
export function resolveFromList(rows: ReadonlyArray<Pick<SuburbRow, "id" | "suburb" | "postcode" | "status" | "far_edge">>, input: ResolveInput): Resolution {
  const name = normaliseSuburb(input.suburb);
  const pc = normalisePostcode(input.postcode);
  const state = (input.state ?? "").trim().toUpperCase();
  if (state && state !== "VIC" && state !== "VICTORIA") {
    return { outcome: "out_of_area", farEdge: false, row: null, basis: "not_victoria" };
  }
  if (!name) return { outcome: "unmapped", farEdge: false, row: null, basis: "unmapped" };
  const byName = rows.filter((r) => normaliseSuburb(r.suburb) === name);
  const exact = pc ? byName.find((r) => r.postcode === pc) : undefined;
  const hit = exact ?? (byName.length === 1 ? byName[0] : undefined);
  if (!hit) return { outcome: "unmapped", farEdge: false, row: null, basis: "unmapped" };
  return {
    outcome: hit.status,
    farEdge: isZoneKey(hit.status) && hit.far_edge,
    row: { id: hit.id, suburb: hit.suburb, postcode: hit.postcode, status: hit.status },
    basis: exact ? "suburb_and_postcode" : "suburb_only_unique",
  };
}

const SUBURB_SELECT = "id, suburb, postcode, status, far_edge, reviewed, basis, lat, lng";

/**
 * Resolve an address against the live list. One indexed read on the suburb
 * name. An unmapped Victorian suburb is RECORDED (`visit_unmapped_suburbs`,
 * hits + 1) so the work queue can raise it — unless `record: false`, which the
 * Settings "check an address" box uses so a staff lookup never raises an item.
 *
 * The caller passes a client that can read the table: the staff session under
 * RLS, or the service client for a customer.
 */
export async function resolveZone(
  db: SupabaseClient,
  input: ResolveInput & { draftId?: string | null; estimateId?: string | null },
  opts: { record?: boolean } = {},
): Promise<Resolution> {
  const name = normaliseSuburb(input.suburb);
  if (!name) return { outcome: "unmapped", farEdge: false, row: null, basis: "unmapped" };
  const { data, error } = await db.from("visit_suburbs").select(SUBURB_SELECT).ilike("suburb", name).limit(20);
  if (error) {
    // A refused read is not "unmapped"; surface it. The caller decides what the
    // customer sees (the request-a-time path), nothing books on a guess.
    throw new Error(`visit_suburbs read failed: ${error.message}`);
  }
  const res = resolveFromList((data ?? []) as SuburbRow[], input);
  if (res.outcome === "unmapped" && opts.record !== false) {
    await recordUnmapped(db, { suburb: input.suburb ?? "", postcode: normalisePostcode(input.postcode), state: (input.state ?? "VIC").trim().toUpperCase() || "VIC", draftId: input.draftId ?? null, estimateId: input.estimateId ?? null });
  }
  return res;
}

/** The fact behind the "unmapped suburb" work item. Idempotent per suburb + postcode; counts hits. */
export async function recordUnmapped(
  db: SupabaseClient,
  r: { suburb: string; postcode: string; state: string; draftId: string | null; estimateId: string | null },
): Promise<void> {
  const suburb = r.suburb.trim().replace(/\s+/g, " ");
  if (!suburb) return;
  const { data: existing, error } = await db.from("visit_unmapped_suburbs")
    .select("id, hits")
    .ilike("suburb", normaliseSuburb(suburb))
    .eq("postcode", r.postcode)
    .maybeSingle();
  if (error) throw new Error(`visit_unmapped_suburbs read failed: ${error.message}`);
  const now = new Date().toISOString();
  if (existing) {
    const { error: upErr } = await db.from("visit_unmapped_suburbs")
      .update({ hits: (existing.hits as number) + 1, last_seen_at: now, last_draft_id: r.draftId, last_estimate_id: r.estimateId, resolved_at: null })
      .eq("id", existing.id);
    if (upErr) throw new Error(`visit_unmapped_suburbs update failed: ${upErr.message}`);
    return;
  }
  const { error: insErr } = await db.from("visit_unmapped_suburbs")
    .insert({ suburb, postcode: r.postcode, state: r.state, last_draft_id: r.draftId, last_estimate_id: r.estimateId });
  // Two customers at once: the unique key makes the second insert lose; that is fine.
  if (insErr && insErr.code !== "23505") throw new Error(`visit_unmapped_suburbs insert failed: ${insErr.message}`);
}

// ---- Settings reads ---------------------------------------------------------

export type VisitZonesData = {
  zones: ZoneRow[];
  suburbs: SuburbRow[];
  unmapped: UnmappedRow[];
  staff: Array<{ id: string; name: string }>;
  /** A read that failed, in staff English. The screen shows this instead of an empty list. */
  loadError: string | null;
};

/**
 * PostgREST caps a read at 1,000 rows whatever `limit` says (the row-cap trap:
 * the first e2e run showed Zone 1 with 71 suburbs of 174). Page through in
 * 1,000-row ranges until a short page comes back.
 */
async function readAllSuburbs(db: SupabaseClient): Promise<{ data: SuburbRow[] | null; error: { message: string; code?: string } | null }> {
  const out: SuburbRow[] = [];
  for (let from = 0; from < 20_000; from += 1000) {
    const { data, error } = await db.from("visit_suburbs").select(SUBURB_SELECT).order("suburb").order("postcode").range(from, from + 999);
    if (error) return { data: null, error };
    out.push(...((data ?? []) as SuburbRow[]));
    if ((data ?? []).length < 1000) break;
  }
  return { data: out, error: null };
}

/** Everything Settings → Visit zones shows. Every read checks its error. */
export async function loadVisitZonesData(db: SupabaseClient): Promise<VisitZonesData> {
  const [zones, suburbs, unmapped, staff] = await Promise.all([
    db.from("visit_zones").select("key, label, estimator_id").order("key"),
    readAllSuburbs(db),
    db.from("visit_unmapped_suburbs").select("id, suburb, postcode, state, first_seen_at, last_seen_at, hits, last_estimate_id").is("resolved_at", null).order("first_seen_at").limit(200),
    db.from("profiles").select("id, name").eq("role", "staff").order("name").limit(50),
  ]);
  const failed = [zones, suburbs, unmapped, staff].find((r) => r.error)?.error ?? null;
  const loadError = failed
    ? (failed.code === "42P01" || /does not exist/i.test(failed.message)
      ? "The visit zones tables are not on this database yet — run migration 20270212000000_visit_zones.sql, then reload."
      : `The zones could not be loaded: ${failed.message}`)
    : null;
  const staffRows = ((staff.data ?? []) as Array<{ id: string; name: string | null }>).map((p) => ({ id: p.id, name: p.name || "Unnamed" }));
  const names = new Map(staffRows.map((s) => [s.id, s.name]));
  return {
    zones: ((zones.data ?? []) as Array<{ key: string; label: string; estimator_id: string | null }>)
      .filter((z) => isZoneKey(z.key))
      .map((z) => ({ key: z.key as ZoneKey, label: z.label, estimator_id: z.estimator_id, estimator_name: z.estimator_id ? names.get(z.estimator_id) ?? null : null })),
    suburbs: ((suburbs.data ?? []) as SuburbRow[]).filter((r) => isZoneStatus(r.status)),
    unmapped: (unmapped.data ?? []) as UnmappedRow[],
    staff: staffRows,
    loadError,
  };
}

/** Which estimator covers a bookable zone (null when unassigned). */
export async function estimatorForZone(db: SupabaseClient, zone: ZoneKey): Promise<string | null> {
  const { data, error } = await db.from("visit_zones").select("estimator_id").eq("key", zone).maybeSingle();
  if (error) throw new Error(`visit_zones read failed: ${error.message}`);
  return (data?.estimator_id as string | null | undefined) ?? null;
}
