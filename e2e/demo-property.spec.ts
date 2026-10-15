import { expect, type Page } from "@playwright/test";
import type { SupabaseClient } from "@supabase/supabase-js";
import { credentials, missingCreds, signIn, test } from "./helpers";
import { accessTokenFor, contractorIdForEmail, rpcAs, serviceClient } from "./fixtures/woLoop";

/**
 * 12 Demo Street — induction brief §8 Step 1, the three roles.
 *
 * AS THE CONTRACTOR: no demo → the Jobs tab offers to start one → one tap
 * seeds it and lands on the job, under a Demo banner → it sits under its own
 * "Demo" heading on Jobs, as a card on Home and as a tagged offer under
 * Requests → seeding again does not duplicate → Reset gives a fresh job and
 * the old one is gone.
 *
 * AS PC: with a demo variation, contractor invoice, expense and call back on
 * the demo job, no staff list, queue, count or export mentions it — the
 * strip's numbers for this painter are what they were before (Step 1
 * acceptance: "the exclusion is one scope, proven by a test that creates a
 * demo variation, invoice, expense and call back and asserts every count is
 * unchanged"). The office can still OPEN the demo job and sees the banner.
 * The status sweep writes no result for it.
 *
 * AS THE CUSTOMER: nothing — the demo estimate has no customer, and the
 * customer role reads no demo row through RLS.
 *
 * Rows the spec creates hang off the demo estimate and are deleted in
 * afterAll by the service key (every demo row carries is_demo = true, so the
 * delete is pinned to it).
 */
const contractor = credentials("CONTRACTOR");
const staff = credentials("STAFF");
const customer = credentials("CUSTOMER");
const db: SupabaseClient | null = serviceClient();
const SECRET = process.env.CRON_SECRET ?? "";
const URL = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
const ANON = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? "";

const DEMO_TITLE = "12 Demo Street";
let contractorId = "";
let demoWoId = "";
let demoRef = "";

async function removeDemo(cid: string) {
  const { data } = await db!.from("work_orders").select("id, estimate_id").eq("contractor_id", cid).eq("is_demo", true);
  for (const wo of (data ?? []) as { id: string; estimate_id: string }[]) {
    // RESTRICT-keyed children first (the fixture's purge order), every one pinned to demo rows.
    for (const t of ["timesheet_entries", "contractor_invoices", "job_costs", "contractor_expenses", "expense_preapprovals", "material_costs"]) {
      const r = await db!.from(t).delete().eq("work_order_id", wo.id).eq("is_demo", true);
      expect(r.error?.message ?? "", `${t} cleanup`).toBe("");
    }
    await db!.from("invoices").delete().eq("estimate_id", wo.estimate_id).eq("is_demo", true);
    const r = await db!.from("estimates").delete().eq("id", wo.estimate_id).eq("is_demo", true);
    expect(r.error?.message ?? "", "estimate cleanup").toBe("");
  }
}

/** The painter's row on PC Command → Contractors, as text (light, checks, app, call backs, streak). */
async function contractorRowText(page: Page): Promise<string> {
  await page.goto("/pc/contractors");
  await expect(page.getByTestId("contractor-rows")).toBeVisible();
  const row = page.getByTestId(`painter-status-row-${contractorId}`);
  return (await row.count()) ? (await row.innerText()).replace(/\s+/g, " ").trim() : "(no row)";
}

/** The counts strip on PC Command → Contractors: lights, open call backs, rewards due, not signed. */
async function contractorsStrip(page: Page): Promise<string> {
  await page.goto("/pc/contractors");
  await expect(page.getByTestId("contractors-lights")).toBeVisible();
  const parts: string[] = [await page.getByTestId("contractors-lights").innerText()];
  for (const k of ["count-callbacks", "count-bonus", "count-unsigned"]) parts.push(`${k}=${await page.getByTestId(k).innerText()}`);
  return parts.join(" | ").replace(/\s+/g, " ").trim();
}

async function expectNoDemoOn(page: Page, path: string) {
  await page.goto(path);
  await expect(page.locator("body")).not.toContainText(DEMO_TITLE);
  await expect(page.locator("body")).not.toContainText(demoRef);
}

test.describe.configure({ mode: "serial" });

test.describe("12 Demo Street — the practice job and its wall", () => {
  test.skip(!contractor || !staff || !customer, missingCreds("CONTRACTOR"));
  test.skip(!db, "set SUPABASE_SERVICE_ROLE_KEY to build the fixtures");

  test.beforeAll(async () => {
    contractorId = (await contractorIdForEmail(db!, contractor!.email))!;
    expect(contractorId).toBeTruthy();
    await removeDemo(contractorId);
  });

  test.afterAll(async () => {
    if (contractorId) await removeDemo(contractorId);
  });

  test("as the contractor: start the practice job from Jobs, land on it under the Demo banner", async ({ page }) => {
    await signIn(page, contractor!, /\/portal/);
    await page.goto("/portal/jobs");
    await expect(page.getByTestId("jobs-demo-heading")).toHaveText("Demo");
    await page.getByTestId("demo-seed").click();
    await expect(page).toHaveURL(/\/portal\/jobs\/[0-9a-f-]{36}/, { timeout: 20_000 });
    demoWoId = page.url().split("/portal/jobs/")[1].split(/[?#]/)[0];
    await expect(page.getByTestId("demo-banner")).toContainText("Practice job");
    // Suburb only until the offer is accepted — the privacy gate applies to the demo like any job.
    await expect(page.getByTestId("job-back")).toBeVisible();
    await expect(page.locator("body")).toContainText("Demoville");
    await expect(page.locator("body")).not.toContainText("12 Demo Street, Demoville VIC");
    const { data: wo } = await db!.from("work_orders").select("wo_ref, is_demo, stage, estimates(is_demo, customer_id)").eq("id", demoWoId).single();
    const row = wo as unknown as { wo_ref: string; is_demo: boolean; stage: string; estimates: { is_demo: boolean; customer_id: string | null } | null };
    demoRef = row.wo_ref;
    expect(row.is_demo).toBe(true);
    expect(row.stage).toBe("offered");
    expect(row.estimates?.is_demo).toBe(true);
    expect(row.estimates?.customer_id).toBeNull();
    const { data: surfaces } = await db!.from("wo_surfaces").select("is_demo").eq("work_order_id", demoWoId);
    expect(surfaces?.length).toBe(27);
    expect((surfaces ?? []).every((s) => (s as { is_demo: boolean }).is_demo)).toBe(true);
  });

  test("as the contractor: Jobs, Home and Requests show it under Demo; seeding again does not duplicate", async ({ page }) => {
    await signIn(page, contractor!, /\/portal/);
    await page.goto("/portal/jobs");
    await expect(page.getByTestId("jobs-demo-heading")).toBeVisible();
    await expect(page.getByTestId("job-demo-chip")).toHaveCount(1);
    await expect(page.getByTestId("demo-seed")).toHaveCount(0);
    await page.goto("/portal");
    await expect(page.getByTestId("home-demo-card")).toContainText(DEMO_TITLE);
    await page.goto("/portal/requests");
    await expect(page.getByTestId("offer-demo-chip")).toHaveCount(1);

    expect(await rpcAs(contractor!, "demo_property_seed", { p_contractor_id: null })).toBe(`exists:${demoWoId}`);
    const { data: all } = await db!.from("work_orders").select("id").eq("contractor_id", contractorId).eq("is_demo", true);
    expect(all?.length).toBe(1);
  });

  test("as PC: a demo variation, invoice, expense and call back change no count anywhere; the office can still open it", async ({ page, request }) => {
    await signIn(page, staff!, /\/home/);
    const stripBefore = await contractorsStrip(page);
    const rowBefore = await contractorRowText(page);
    await page.goto("/invoicing");
    const invoicingBefore = (await page.getByTestId("pm-headline").innerText()).trim();

    // The four money/status rows the brief names, all on the demo job. The copy
    // trigger (20270262) marks each one is_demo without being told.
    const v = await db!.from("wo_variations").insert({ work_order_id: demoWoId, category: "extra_scope", comment: "E2E demo extra door", status: "raised", raised_kind: "contractor", est_hours: 1.5 }).select("is_demo").single();
    expect(v.error?.message ?? "").toBe(""); expect((v.data as { is_demo: boolean }).is_demo).toBe(true);
    const ci = await db!.from("contractor_invoices").insert({ work_order_id: demoWoId, contractor_id: contractorId, status: "submitted", claimed_ex_cents: 100_000, gst_cents: 10_000, total_inc_cents: 110_000 }).select("is_demo").single();
    expect(ci.error?.message ?? "").toBe(""); expect((ci.data as { is_demo: boolean }).is_demo).toBe(true);
    const ex = await db!.from("contractor_expenses").insert({ work_order_id: demoWoId, contractor_id: contractorId, category: "parking", amount_cents: 2_000, gst_cents: 182, receipt_path: `receipts/e2e/${demoWoId}.jpg`, status: "submitted" }).select("is_demo").single();
    expect(ex.error?.message ?? "").toBe(""); expect((ex.data as { is_demo: boolean }).is_demo).toBe(true);
    const cb = await db!.from("wo_callbacks").insert({ work_order_id: demoWoId, painter_id: contractorId, source: "customer_call", reason: "workmanship", reported_on: new Date().toISOString().slice(0, 10), description: "E2E demo call back", status: "open" }).select("is_demo").single();
    expect(cb.error?.message ?? "").toBe(""); expect((cb.data as { is_demo: boolean }).is_demo).toBe(true);

    for (const path of ["/pc", "/pc/flow", "/pc/schedule", "/pc/updates", "/pc/contractors", "/invoicing", "/home", "/contractors"]) {
      await expectNoDemoOn(page, path);
    }
    expect(await contractorsStrip(page)).toBe(stripBefore);
    expect(await contractorRowText(page)).toBe(rowBefore);
    await page.goto("/invoicing");
    expect((await page.getByTestId("pm-headline").innerText()).trim()).toBe(invoicingBefore);

    // The office can open it, and it says so.
    await page.goto(`/pc/wo/${demoWoId}`);
    await expect(page.getByTestId("demo-banner")).toContainText("induction demo");
    await expect(page.getByTestId("wo-ref")).toContainText(demoRef);

    // The evaluator leaves it alone.
    const res = await request.get("/api/cron/campaign-sweep?only=status", { headers: { Authorization: `Bearer ${SECRET}` }, timeout: 170_000 });
    expect(res.ok(), await res.text()).toBe(true);
    const { data: results } = await db!.from("painter_job_results").select("id").eq("work_order_id", demoWoId);
    expect(results?.length ?? 0).toBe(0);
  });

  test("as the customer: nothing", async ({ page }) => {
    await signIn(page, customer!, /\/account/);
    await expect(page.locator("body")).not.toContainText(DEMO_TITLE);
    const token = await accessTokenFor(customer!);
    const read = async (table: string, col: string) => fetch(`${URL}/rest/v1/${table}?select=${col}&is_demo=eq.true`, { headers: { apikey: ANON, Authorization: `Bearer ${token}` } }).then((r) => r.json());
    for (const [t, c] of [["work_orders", "id"], ["estimates", "id"], ["wo_variations", "id"], ["wo_callbacks", "id"], ["contractor_invoices", "id"]] as const) {
      const rows = await read(t, c);
      expect(Array.isArray(rows) ? rows : [], `customer reads no demo ${t}`).toEqual([]);
    }
  });

  test("as the contractor: Reset gives a fresh job and the old one is gone", async ({ page }) => {
    await signIn(page, contractor!, /\/portal/);
    await page.goto(`/portal/jobs/${demoWoId}`);
    page.once("dialog", (d) => d.accept());
    await page.getByTestId("demo-reset").click();
    // The old URL matches the job-page shape too — wait for the id to CHANGE.
    await page.waitForURL((u) => u.pathname.startsWith("/portal/jobs/") && !u.pathname.includes(demoWoId), { timeout: 20_000 });
    const fresh = page.url().split("/portal/jobs/")[1].split(/[?#]/)[0];
    expect(fresh).not.toBe(demoWoId);
    await expect(page.getByTestId("demo-banner")).toBeVisible();
    const { data: old } = await db!.from("work_orders").select("id").eq("id", demoWoId);
    expect(old?.length ?? 0).toBe(0);
    const { data: leftovers } = await db!.from("wo_callbacks").select("id").eq("work_order_id", demoWoId);
    expect(leftovers?.length ?? 0).toBe(0);
    const { data: surfaces } = await db!.from("wo_surfaces").select("state").eq("work_order_id", fresh);
    expect(surfaces?.length).toBe(27);
    expect((surfaces ?? []).every((s) => (s as { state: string }).state === "todo")).toBe(true);
    demoWoId = fresh;
    // One reset event, naming the fresh job (seed and reset share the transaction's now(), so "latest" would be a tie).
    const { data: ev } = await db!.from("contractor_events").select("detail").eq("contractor_id", contractorId).eq("type", "demo_reset").eq("detail->>work_order_id", fresh);
    expect(ev?.length).toBe(1);
  });
});
