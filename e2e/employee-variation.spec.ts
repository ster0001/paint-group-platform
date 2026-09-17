import { test, expect } from "@playwright/test";
import type { SupabaseClient } from "@supabase/supabase-js";
import { credentials, drawSignature, missingCreds, signIn } from "./helpers";
import { createLoopFixture, destroyLoopFixture, rpcAs, serviceClient, type LoopFixture } from "./fixtures/woLoop";
import { KNOWN_MONEY_KEYS } from "../lib/painters/money";

/**
 * Employed painters — Session 4: variations, the employee side (ruling 8).
 *
 * The employee raises the same structured card (photo and all); the office
 * prices it; the customer SIGNS it on the token link — all unchanged. Then:
 * the employee sees "Variation approved" with the hours and the scope lines,
 * no dollar figure and nothing to accept; the row is already
 * contractor_accepted at the database (the stage gate never waits on
 * nobody), with a variation_employee_applied event on the record. A declined
 * one reads "Not going ahead" with the office's note. The contractor's
 * adjusted-offer path is proven untouched by wo-variations.spec.ts, which
 * runs alongside this.
 */

const staff = credentials("STAFF");
const db: SupabaseClient | null = serviceClient();
const run = Date.now().toString(36);
// TWO employees: the lead (work_orders.contractor_id) and a crew member who is
// on the job by assignment only. The CREW MEMBER raises the variation — that is
// ruling 6 (everyone assigned can update scope) proven on the RPC that used to
// answer error:not_yours to anyone but the lead (20270159).
const lead = { email: `pg.e2e.employee.${run}.lead@example.com`, password: `Employee-${run}-pw!` };
const employee = { email: `pg.e2e.employee.${run}.crew@example.com`, password: `Employee-${run}-pw!` };
let userId: string | null = null;
let leadUserId: string | null = null;
let contractorId: string | null = null;
let leadContractorId: string | null = null;
let fixture: LoopFixture | null = null;
let variationId = "";
let token = "";

async function makeEmployee(creds: { email: string; password: string }, name: string) {
  const created = await db!.auth.admin.createUser({ email: creds.email, password: creds.password, email_confirm: true, user_metadata: { name } });
  if (created.error || !created.data.user) throw new Error(`create ${name}: ${created.error?.message}`);
  const uid = created.data.user.id;
  const role = await db!.from("profiles").update({ role: "contractor", name }).eq("id", uid);
  if (role.error) throw new Error(role.error.message);
  const c = await db!.from("contractors").insert({ profile_id: uid, tier: "B", active: true, company_name: "", employment_type: "employee" }).select("id").single();
  if (c.error) throw new Error(c.error.message);
  return { uid, cid: (c.data as { id: string }).id };
}

const JPEG = Buffer.from(
  "/9j/4AAQSkZJRgABAQEAYABgAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkSEw8UHRofHh0a" +
  "HBwgJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPC4zNDL/wAALCAABAAEBAREA/8QAFAABAAAAAAAA" +
  "AAAAAAAAAAAACf/EABQQAQAAAAAAAAAAAAAAAAAAAAD/2gAIAQEAAD8AKp//2Q==",
  "base64",
);

test.describe("employed painter — variations", () => {
  test.skip(!staff, missingCreds("STAFF"));
  test.skip(!db, "set SUPABASE_SERVICE_ROLE_KEY to provision the employee account");
  test.describe.configure({ mode: "serial" });

  test.beforeAll(async () => {
    const l = await makeEmployee(lead, "E2E Lead Employee");
    leadUserId = l.uid; leadContractorId = l.cid;
    const e = await makeEmployee(employee, "E2E Crew Employee");
    userId = e.uid; contractorId = e.cid;

    fixture = await createLoopFixture(db!, leadContractorId, [{ heading: "Left", labels: ["Walls — weatherboard", "Windows × 2"] }]);
    const reset = await db!.from("work_orders")
      .update({ contractor_id: null, start_date: null, end_date: null, stage: "offered", status: "issued" })
      .eq("id", fixture.workOrderId);
    if (reset.error) throw new Error(reset.error.message);
    const r = await rpcAs(staff!, "assign_job", {
      p_work_order_id: fixture.workOrderId,
      p_painters: [
        { contractor_id: leadContractorId, start_date: "2026-11-23", end_date: "2026-11-25" },
        { contractor_id: contractorId, start_date: "2026-11-23", end_date: "2026-11-25" },
      ],
      p_lead_contractor_id: leadContractorId,
    });
    if (!r.startsWith("ok:")) throw new Error(`assign_job: ${r}`);
  });

  test.afterAll(async () => {
    if (fixture) await destroyLoopFixture(db!, fixture);
    for (const cid of [contractorId, leadContractorId]) {
      if (cid) { const r = await db!.from("contractors").delete().eq("id", cid); if (r.error) throw new Error(r.error.message); }
    }
    for (const uid of [userId, leadUserId]) {
      if (uid) { const r = await db!.auth.admin.deleteUser(uid); if (r.error) throw new Error(r.error.message); }
    }
  });

  test("the employee raises a variation from the job, with a photo — the same card as a contractor", async ({ page }) => {
    await signIn(page, employee, /\/portal/);
    await page.goto(`/portal/jobs/${fixture!.workOrderId}`);
    await page.getByTestId("raise-variation").click();
    await page.getByTestId("category-rot").click();
    await page.getByTestId("variation-comment").fill("Bottom boards on the left are soft right through — E2E employee.");
    await page.getByTestId("variation-hours").fill("3");
    await expect(page.getByTestId("send-variation")).toBeDisabled();
    await page.locator('input[type="file"]').last().setInputFiles({ name: "rot.jpg", mimeType: "image/jpeg", buffer: JPEG });
    await expect(page.getByTestId("variation-photo")).toContainText("1 photo added", { timeout: 20_000 });
    await page.getByTestId("send-variation").click();
    await expect(page.getByTestId("variation-message")).toContainText("Sent to the office");

    const { data } = await db!.from("wo_variations").select("id, status, raised_kind, raised_by")
      .eq("work_order_id", fixture!.workOrderId).like("comment", "%E2E employee%").single();
    const row = data as { id: string; status: string; raised_kind: string; raised_by: string };
    variationId = row.id;
    expect(row.status).toBe("raised");
    expect(row.raised_kind).toBe("contractor");
    expect(row.raised_by).toBe(userId);

    // On screen: "With the office", and no money anywhere on the page.
    await page.reload();
    await expect(page.getByTestId(`variation-${variationId}`)).toContainText("With the office");
    const html = await page.content();
    for (const key of KNOWN_MONEY_KEYS) expect(html, `leaked ${key}`).not.toContain(key);
  });

  test("the office prices it; the employee sees 'With the customer' and still no figure", async ({ page }) => {
    const priced = await rpcAs(staff!, "wo_price_variation", {
      p_variation_id: variationId, p_price_cents: 84000,
      p_inputs: { hours: 3, chargeOutCents: 28000, type: "Exterior" },
      p_priced_lines: [{ label: "Replace three lower weatherboards, prime and paint", cents: 84000 }, { label: "Labour — 3 hr", cents: 0 }],
      p_hours: 3,
    });
    expect(priced).toMatch(/^ok:/);
    token = priced.slice(3);

    await signIn(page, employee, /\/portal/);
    await page.goto(`/portal/jobs/${fixture!.workOrderId}`);
    await expect(page.getByTestId(`variation-${variationId}`)).toContainText("With the customer");
    const text = await page.locator("body").innerText();
    expect(text).not.toMatch(/\$\s?\d/);
    expect(text).not.toMatch(/840|180\.00/);
  });

  test("the customer signs it; the employee sees 'Variation approved' with the scope and hours — nothing to accept", async ({ page }) => {
    await page.goto(`/v/${token}`);
    await page.getByTestId("approve-variation").click();
    await page.getByTestId("sign-name").fill("Casey Customer");
    // The priced lines push the pad below the fold; a stroke drawn at an
    // off-screen coordinate never reaches the canvas.
    await page.getByTestId("signature-canvas").scrollIntoViewIfNeeded();
    await expect(page.getByTestId("signature-canvas")).toBeVisible();
    await drawSignature(page);
    await page.getByTestId("confirm-sign").click();
    await expect(page.getByTestId("variation-outcome")).toContainText("Approved", { timeout: 20_000 });

    // At the database: applied in the same statement — no accept step, and
    // the stage gate is not waiting on anyone.
    const { data } = await db!.from("wo_variations").select("status, contractor_accepted_at").eq("id", variationId).single();
    expect((data as { status: string }).status).toBe("contractor_accepted");
    expect((data as { contractor_accepted_at: string | null }).contractor_accepted_at).not.toBeNull();
    const { count } = await db!.from("wo_events").select("id", { count: "exact", head: true })
      .eq("work_order_id", fixture!.workOrderId).eq("type", "variation_employee_applied");
    expect(count).toBe(1);

    await signIn(page, employee, /\/portal/);
    await page.goto(`/portal/jobs/${fixture!.workOrderId}`);
    const card = page.getByTestId(`variation-${variationId}`);
    await expect(card).toContainText("Variation approved");
    await expect(page.getByTestId(`approved-${variationId}`)).toContainText("3 hrs added");
    await expect(page.getByTestId(`scope-${variationId}`)).toContainText("Replace three lower weatherboards");
    await expect(page.getByTestId(`accept-${variationId}`)).toHaveCount(0);
    const html = await page.content();
    const text = await page.locator("body").innerText();
    for (const key of KNOWN_MONEY_KEYS) expect(html, `leaked ${key}`).not.toContain(key);
    expect(text).not.toMatch(/\$\s?\d|840|180\.00|added to your payment/);
  });

  test("a declined one reads 'Not going ahead' with the office's note", async ({ page }) => {
    // Seeded straight in, priced by the office, declined by the customer.
    const { data: v, error } = await db!.from("wo_variations").insert({
      work_order_id: fixture!.workOrderId, raised_by: userId, raised_kind: "contractor",
      category: "extra_scope", comment: "E2E second variation — the fence", est_hours: 2, status: "raised",
    }).select("id").single();
    if (error) throw new Error(error.message);
    const declinedId = (v as { id: string }).id;
    const priced = await rpcAs(staff!, "wo_price_variation", {
      p_variation_id: declinedId, p_price_cents: 30000, p_inputs: { hours: 2 },
      p_priced_lines: [{ label: "Fence — 2 hr", cents: 30000 }], p_hours: 2,
    });
    expect(priced).toMatch(/^ok:/);
    const declined = await rpcAs(employee, "wo_customer_respond_variation", { p_token: priced.slice(3), p_approve: false, p_note: "Leave the fence for now" });
    expect(declined).toBe("ok:declined");

    await signIn(page, employee, /\/portal/);
    await page.goto(`/portal/jobs/${fixture!.workOrderId}`);
    const card = page.getByTestId(`variation-${declinedId}`);
    await expect(card).toContainText("Not going ahead");
    await expect(page.getByTestId(`declined-${declinedId}`)).toContainText("Leave the fence for now");
  });
});
