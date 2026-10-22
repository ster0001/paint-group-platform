import { expect } from "@playwright/test";
import type { SupabaseClient } from "@supabase/supabase-js";
import { credentials, missingCreds, signIn, test } from "./helpers";
import { contractorIdForEmail, createLoopFixture, destroyLoopFixture, rpcAs, serviceClient, type LoopFixture } from "./fixtures/woLoop";

/**
 * Tom's 22 Oct 2026 batch, migration 20270294.
 *   API: wo_set_job_title (staff, trims, refuses empty); material_cost_add_manual against an
 *   order and material_cost_update moving it to another order (and refusing an order from a
 *   different job); job_cost_update fixing a cost that landed as Other (refuses once paid).
 *   Browser, as the PC: the job page title edits in place; the Payments job panel adds a
 *   material cost by hand and edits it. The deposit colour (issued, not due = blue) is pinned
 *   by lib/invoicing/jobMoney.test.ts (tone beside state).
 */
const staff = credentials("STAFF");
const contractor = credentials("CONTRACTOR");
const db: SupabaseClient | null = serviceClient();

const RUN = Math.random().toString(36).slice(2, 8);
type Row = Record<string, unknown>;
let contractorId = "";
let job: LoopFixture | null = null;
let other: LoopFixture | null = null;
let orderA = "", orderB = "", foreignOrder = "";
let jobCostId = "";
const okId = (s: string) => { expect(s).toMatch(/^ok:/); return s.replace(/^ok:/, ""); };

test.describe.configure({ mode: "serial" });

test.describe("Tom batch 22 Oct: titles, cost edits, deposit colour", () => {
  test.skip(!staff || !contractor, missingCreds("CONTRACTOR"));
  test.skip(!db, "set SUPABASE_SERVICE_ROLE_KEY to build the fixtures");

  test.beforeAll(async () => {
    contractorId = (await contractorIdForEmail(db!, contractor!.email))!;
    job = await createLoopFixture(db!, contractorId, [{ heading: "Front", labels: ["Walls"] }]);
    other = await createLoopFixture(db!, contractorId, [{ heading: "Back", labels: ["Walls"] }]);
    orderA = okId(await rpcAs(staff!, "movement_create", { p: { kind: "materials", work_order_id: job.workOrderId, title: `E2E order A ${RUN}` } }));
    orderB = okId(await rpcAs(staff!, "movement_create", { p: { kind: "materials", work_order_id: job.workOrderId, title: `E2E order B ${RUN}` } }));
    foreignOrder = okId(await rpcAs(staff!, "movement_create", { p: { kind: "materials", work_order_id: other.workOrderId, title: `E2E other job ${RUN}` } }));
    const { data: jc, error } = await db!.from("job_costs").insert({ work_order_id: job.workOrderId, category: "other", description: `E2E mystery cost ${RUN}`, amount_ex_cents: 10000, gst_cents: 1000, status: "recorded", paid_with: "account" }).select("id").single();
    if (error) throw new Error(error.message);
    jobCostId = (jc as { id: string }).id;
  });

  test.afterAll(async () => {
    if (job) { await db!.from("material_costs").delete().eq("work_order_id", job.workOrderId); await db!.from("job_costs").delete().eq("work_order_id", job.workOrderId); }
    await destroyLoopFixture(db!, job);
    await destroyLoopFixture(db!, other);
  });

  test("the working scope title is the office's to set", async () => {
    expect(await rpcAs(staff!, "wo_set_job_title", { p_work_order_id: job!.workOrderId, p_title: "   " })).toBe("error:empty");
    expect(await rpcAs(staff!, "wo_set_job_title", { p_work_order_id: job!.workOrderId, p_title: ` E2E ${RUN} — Exterior ` })).toBe(`ok:E2E ${RUN} — Exterior`);
    expect(await rpcAs(contractor!, "wo_set_job_title", { p_work_order_id: job!.workOrderId, p_title: "nope" })).toBe("error:not_staff");
    const { data } = await db!.from("work_orders").select("wo_snapshot").eq("id", job!.workOrderId).single();
    expect((data as { wo_snapshot: { jobTitle: string } }).wo_snapshot.jobTitle).toBe(`E2E ${RUN} — Exterior`);
  });

  test("a material cost by hand on an order; edited; moved to another order; never to another job's order", async () => {
    const id = okId(await rpcAs(staff!, "material_cost_add_manual", { p_work_order_id: job!.workOrderId, p_supplier: "Other", p_amount_cents: 12345, p_movement_id: orderA, p_order_ref: "", p_invoice_date: null }));
    expect(await rpcAs(staff!, "material_cost_add_manual", { p_work_order_id: job!.workOrderId, p_supplier: "", p_amount_cents: 100 })).toBe("error:empty");
    expect(await rpcAs(staff!, "material_cost_add_manual", { p_work_order_id: job!.workOrderId, p_supplier: "X", p_amount_cents: -1 })).toBe("error:bad_amount");
    expect(await rpcAs(staff!, "material_cost_update", { p_id: id, p: { supplier: `Dulux Trade ${RUN}`, amount_cents: 20000, movement_id: orderB } })).toBe(`ok:${id}`);
    expect(await rpcAs(staff!, "material_cost_update", { p_id: id, p: { movement_id: foreignOrder } })).toBe("error:bad_order");
    const { data } = await db!.from("material_costs").select("supplier, amount_cents, movement_id, source").eq("id", id).single();
    expect(data).toMatchObject({ supplier: `Dulux Trade ${RUN}`, amount_cents: 20000, movement_id: orderB, source: "manual" });
  });

  test("a recorded cost that landed as Other is put right; a paid one is not editable", async () => {
    expect(await rpcAs(staff!, "job_cost_update", { p_id: jobCostId, p: { description: `E2E scaffold ${RUN}`, category: "scaffold", amount_ex_cents: 15000, gst_cents: 1500 } })).toBe(`ok:${jobCostId}`);
    expect(await rpcAs(staff!, "job_cost_update", { p_id: jobCostId, p: { category: "not-a-category" } })).toBe("error:bad_category");
    const { data } = await db!.from("job_costs").select("description, category, amount_ex_cents, gst_cents").eq("id", jobCostId).single();
    expect(data).toMatchObject({ description: `E2E scaffold ${RUN}`, category: "scaffold", amount_ex_cents: 15000, gst_cents: 1500 });
    await db!.from("job_costs").update({ status: "paid" }).eq("id", jobCostId);
    expect(await rpcAs(staff!, "job_cost_update", { p_id: jobCostId, p: { description: "too late" } })).toBe("error:paid");
    await db!.from("job_costs").update({ status: "recorded" }).eq("id", jobCostId);
  });

  test("in the browser: the job title edits in place; the panel adds and edits a material cost", async ({ page }) => {
    await signIn(page, staff!, /\/(home|estimates)/);
    await page.goto(`/pc/wo/${job!.workOrderId}`);
    await expect(page.getByTestId("wo-title")).toContainText(`E2E ${RUN} — Exterior`, { timeout: 30_000 });
    await page.getByTestId("wo-title-edit").click();
    await page.getByTestId("wo-title-input").fill(`E2E ${RUN} — Interior`);
    await page.getByTestId("wo-title-save").click();
    await expect(page.getByTestId("wo-title")).toContainText(`E2E ${RUN} — Interior`, { timeout: 15_000 });

    await page.goto(`/invoicing/job/${job!.estimateId}?jt=out`);
    await page.getByTestId("add-material-cost").click();
    await page.getByTestId("add-material-supplier").fill(`Bunnings ${RUN}`);
    await page.getByTestId("add-material-amount").fill("88.00");
    await page.getByTestId("add-material-cost-form").getByTestId("cost-order").selectOption(orderA);
    await page.getByTestId("add-material-save").click();
    const row = page.locator(".li", { hasText: `Bunnings ${RUN}` });
    await expect(row).toBeVisible({ timeout: 20_000 });
    await row.getByTestId("material-edit").click();
    await row.getByTestId("material-supplier").fill(`Haymes Paint ${RUN}`);
    await row.getByTestId("material-edit-form").getByTestId("cost-order").selectOption(orderB);
    await row.getByTestId("material-save").click();
    await expect(page.locator(".li", { hasText: `Haymes Paint ${RUN}` })).toBeVisible({ timeout: 20_000 });
    const { data: mc } = await db!.from("material_costs").select("movement_id").eq("work_order_id", job!.workOrderId).ilike("supplier", `Haymes Paint ${RUN}`).single();
    expect((mc as { movement_id: string }).movement_id).toBe(orderB);
  });
});
