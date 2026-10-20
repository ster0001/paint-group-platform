import { expect } from "@playwright/test";
import type { SupabaseClient } from "@supabase/supabase-js";
import { credentials, missingCreds, test } from "./helpers";
import { accessTokenFor, contractorIdForEmail, createLoopFixture, destroyLoopFixture, rpcAs, serviceClient, type LoopFixture } from "./fixtures/woLoop";
import { jobPoint, syncForWo, type NewChip, type SyncInput } from "../lib/movements/sync";
import type { BranchRow, LogisticsDecisionRow, MaterialLineRow, MovementRow } from "../lib/movements/types";

/**
 * Movements Session 3 — the sync MIRROR pinned to the RPC. One fixture; `movements_sync_for_wo`
 * runs on the database (through the staff session's `movements_sync_now`) and `syncForWo` runs in
 * TypeScript on the same inputs, read back through the STAFF session; the two chip sets must
 * agree column for column — key, kind, title, detail, from/to, branch, status, order ref. Then
 * the Materials rows change and both are asked again: the RPC's refresh and the mirror's patch
 * must agree too. The service key builds and destroys the fixture; it never reads on a role's behalf.
 */
const staff = credentials("STAFF");
const contractor = credentials("CONTRACTOR");
const db: SupabaseClient | null = serviceClient();
const URL = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const ANON = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;

const RUN = Math.random().toString(36).slice(2, 8);
const BRAND_A = `E2E Mirror A ${RUN}`, BRAND_B = `E2E Mirror B ${RUN}`, HARDWARE = `E2E Mirror Hardware ${RUN}`;
const PRODUCT_A = `E2E Mirror Paint A ${RUN}`, PRODUCT_B = `E2E Mirror Paint B ${RUN}`;
const ADDRESS = "1 Test St, Oakleigh South VIC 3167";
type Row = Record<string, unknown>;

async function readAs<T = Row>(who: { email: string; password: string }, path: string): Promise<T[]> {
  const token = await accessTokenFor(who);
  const body = await fetch(`${URL}/rest/v1/${path}`, { headers: { apikey: ANON, Authorization: `Bearer ${token}` } }).then((r) => r.json());
  if (!Array.isArray(body)) throw new Error(`${path}: ${JSON.stringify(body)}`);
  return body as T[];
}

const melbourne = new Intl.DateTimeFormat("en-CA", { timeZone: "Australia/Melbourne", year: "numeric", month: "2-digit", day: "2-digit" });
const day = (offset: number) => { const d = new Date(); d.setDate(d.getDate() + offset); return melbourne.format(d); };

let job: LoopFixture | null = null;
const productIds: string[] = [];
const branchIds: string[] = [];

/** Everything the RPC reads, through the staff session, in the mirror's shape. */
async function inputsFor(workOrderId: string): Promise<SyncInput> {
  const [wo] = await readAs<{ id: string; stage: string; wo_snapshot: SyncInput["workOrder"]["wo_snapshot"]; job_no: number | null; wo_ref: string | null; end_date: string | null }>(
    staff!, `work_orders?id=eq.${workOrderId}&select=id,stage,wo_snapshot,job_no,wo_ref,end_date`);
  const products = await readAs<{ name: string; brand: string | null; effective_from: string | null }>(staff!, `products?select=name,brand,effective_from&name=like.E2E%20Mirror%20Paint%25`);
  const movements = await readAs<Omit<MovementRow, "items">>(staff!, `movements?work_order_id=eq.${workOrderId}&select=*&order=created_at`);
  const lines = await readAs<MaterialLineRow>(staff!, `wo_material_lines?work_order_id=eq.${workOrderId}&select=id,work_order_id,text,source,sort,merged_into,created_at`);
  const decisions = await readAs<LogisticsDecisionRow>(staff!, `wo_logistics_decisions?work_order_id=eq.${workOrderId}&select=work_order_id,line,decision`);
  const branches = await readAs<BranchRow>(staff!, `supplier_branches?select=id,brand,branch,kind,address,suburb,phone,lat,lng,delivers_to_site,opens_weekday,favourite,active&brand=like.E2E%20Mirror%25`);
  const suburbRows = await readAs<{ suburb: string; lat: number | null; lng: number | null }>(staff!, `visit_suburbs?suburb=ilike.Oakleigh%20South&select=suburb,lat,lng,postcode&order=postcode`);
  const suburbs = new Map<string, { lat: number; lng: number }>();
  for (const s of suburbRows) if (s.lat != null && s.lng != null && !suburbs.has(s.suburb.toLowerCase())) suburbs.set(s.suburb.toLowerCase(), { lat: s.lat, lng: s.lng });
  return {
    workOrder: wo, products, movements: movements.map((m) => ({ ...m, items: [] })), materialLines: lines, decisions, branches,
    jobPoint: jobPoint(wo.wo_snapshot?.jobAddress, suburbs), itemLocations: new Map(), now: new Date().toISOString(),
  };
}

/** The columns the two must agree on, keyed by source_key. */
type Shape = { kind: string; title: string; detail: string | null; from_kind: string | null; from_branch_id: string | null; from_text: string; to_kind: string | null; to_branch_id: string | null; to_text: string; status: string; order_ref: string };
const shape = (c: Shape) => ({
  kind: c.kind, title: c.title, detail: c.detail, from_kind: c.from_kind, from_branch_id: c.from_branch_id, from_text: c.from_text,
  to_kind: c.to_kind, to_branch_id: c.to_branch_id, to_text: c.to_text, status: c.status, order_ref: c.order_ref,
});

test.describe.configure({ mode: "serial" });

test.describe("the TypeScript sync mirror agrees with movements_sync_for_wo", () => {
  test.skip(!staff || !contractor, missingCreds("CONTRACTOR"));
  test.skip(!db, "set SUPABASE_SERVICE_ROLE_KEY to build the fixtures");

  test.beforeAll(async () => {
    const contractorId = (await contractorIdForEmail(db!, contractor!.email))!;
    for (const [name, brand] of [[PRODUCT_A, BRAND_A], [PRODUCT_B, BRAND_B]]) {
      const { data, error } = await db!.from("products").insert({ name, brand, coverage: 12, price_per_litre: 2500, wastage_pct: 10 }).select("id").single();
      if (error) throw new Error(`product: ${error.message}`);
      productIds.push((data as { id: string }).id);
    }
    for (const p of [
      { brand: BRAND_A, branch: "Delivers", kind: "paint", suburb: "Oakleigh South", postcode: "3167", lat: -37.92, lng: 145.1, delivers_to_site: true },
      { brand: BRAND_A, branch: "Counter only", kind: "paint", suburb: "Carnegie", postcode: "3163", lat: -37.89, lng: 145.06, delivers_to_site: false },
      { brand: HARDWARE, branch: "Store", kind: "hardware", suburb: "Moorabbin", postcode: "3189", lat: -37.94, lng: 145.05, delivers_to_site: true, favourite: true },
    ]) {
      const r = await rpcAs(staff!, "supplier_branch_upsert", { p });
      expect(r, "branch").toMatch(/^ok:/);
      branchIds.push(r.slice(3));
    }
    job = await createLoopFixture(db!, contractorId, [{ heading: "Front", labels: ["Walls"] }]);
    const materials = [
      { product: PRODUCT_A, colourKey: `${PRODUCT_A}||`, photoUrl: "", litres: 13, coverageMissing: false, colourName: "", colourHex: "", colourStatus: "tbc" },
      { product: PRODUCT_A, colourKey: `${PRODUCT_A}||Mist`, photoUrl: "", litres: 4, coverageMissing: false, colourName: "Mist", colourHex: "#EEEEEE", colourStatus: "tbc" },
      { product: PRODUCT_B, colourKey: `${PRODUCT_B}||`, photoUrl: "", litres: 20, coverageMissing: false, colourName: "", colourHex: "", colourStatus: "tbc" },
    ];
    const { data: w } = await db!.from("work_orders").select("wo_snapshot").eq("id", job.workOrderId).single();
    const snap = { ...((w as { wo_snapshot: Row }).wo_snapshot), materials, jobAddress: ADDRESS };
    const { error } = await db!.from("work_orders").update({ wo_snapshot: snap, stage: "pre_start", start_date: day(7), end_date: day(9) }).eq("id", job.workOrderId);
    if (error) throw new Error(`fixture update: ${error.message}`);
  });

  test.afterAll(async () => {
    await destroyLoopFixture(db!, job);
    for (const id of branchIds) await db!.from("supplier_branches").delete().eq("id", id);
    await db!.from("vendors").delete().in("name", [BRAND_A, BRAND_B, HARDWARE]);
    if (productIds.length) await db!.from("products").delete().in("id", productIds);
  });

  test("first sync: the RPC's chips and the mirror's plan are the same set, column for column", async () => {
    // The trigger already synced on the snapshot update. Read what it made; then ask the mirror
    // what it WOULD make from the same inputs with no existing chips.
    const made = await readAs<Omit<MovementRow, "items">>(staff!, `movements?work_order_id=eq.${job!.workOrderId}&select=*`);
    expect(made.map((m) => m.source_key).sort()).toEqual([`paint:${BRAND_A}`, `paint:${BRAND_B}`, "rubbish"].sort());
    const inputs = await inputsFor(job!.workOrderId);
    const plan = syncForWo({ ...inputs, movements: [] });
    expect(plan.result).toBe("ok:3:0:0");
    const fromDb = Object.fromEntries(made.map((m) => [m.source_key, shape(m)]));
    const fromMirror = Object.fromEntries(plan.create.map((c) => [c.source_key, shape(c)]));
    expect(fromMirror).toEqual(fromDb);
    // And with the chips present, the mirror converges exactly as the RPC does.
    expect(await rpcAs(staff!, "movements_sync_now", { p_work_order_id: job!.workOrderId })).toBe("ok:0:2:0");
    const again = syncForWo(inputs);
    expect(again.result).toBe("ok:0:2:0");
    expect(again.refresh.every((p) => !p.changed)).toBe(true);
  });

  test("a line added and the litres changed: the RPC's refreshed rows match the mirror's patches", async () => {
    const lineId = (await rpcAs(staff!, "material_line_add", { p_work_order_id: job!.workOrderId, p_text: "Caulk × 6", p_source: "estimate" })).slice(3);
    const before = await inputsFor(job!.workOrderId);
    // The mirror, run on the inputs BEFORE the litres change but AFTER the line (the line's chip
    // exists already): nothing to create.
    expect(syncForWo(before).create).toEqual([]);
    const { data: w } = await db!.from("work_orders").select("wo_snapshot").eq("id", job!.workOrderId).single();
    const snap = (w as { wo_snapshot: Row & { materials: Row[] } }).wo_snapshot;
    snap.materials = snap.materials.map((m) => (m.product === PRODUCT_B ? { ...m, litres: 15 } : m));
    await db!.from("work_orders").update({ wo_snapshot: snap }).eq("id", job!.workOrderId);

    const after = await readAs<Omit<MovementRow, "items">>(staff!, `movements?work_order_id=eq.${job!.workOrderId}&select=*`);
    const mirrored = syncForWo({ ...before, workOrder: { ...before.workOrder, wo_snapshot: snap as SyncInput["workOrder"]["wo_snapshot"] } });
    const patchB = mirrored.refresh.find((p) => p.id === before.movements.find((m) => m.source_key === `paint:${BRAND_B}`)!.id)!;
    expect(patchB.changed).toBe(true);
    expect(after.find((m) => m.source_key === `paint:${BRAND_B}`)!.title).toBe(patchB.title);
    expect(after.find((m) => m.source_key === `paint:${BRAND_B}`)!.title).toBe(`${BRAND_B} · 1 line · 1 can`);
    expect(shape(after.find((m) => m.source_key === `matline:${lineId}`)!)).toEqual(shape(mirrored.after.get(`matline:${lineId}`) as NewChip));
    // The whole set still agrees.
    const planNow = syncForWo(await inputsFor(job!.workOrderId));
    for (const m of after) expect(shape(planNow.after.get(m.source_key!) as NewChip), m.source_key!).toEqual(shape(m));
  });
});
