import { test, expect } from "@playwright/test";
import type { SupabaseClient } from "@supabase/supabase-js";
import { credentials, missingCreds, signIn } from "./helpers";
import { createLoopFixture, destroyLoopFixture, rpcAs, serviceClient, type LoopFixture } from "./fixtures/woLoop";
import { KNOWN_MONEY_KEYS } from "../lib/painters/money";

/**
 * Employed painters — Session 5: expenses only, settings, the tick box, the
 * customer-facing lead (brief §6 Session 5 acceptance).
 *
 *  · An employee submits a $140 inc. GST personal-card expense → it is flagged
 *    over the threshold → the PC approves it → it appears on Payables under
 *    "Employee reimbursements", never on any invoice, and the office marks it
 *    paid back. A company-card claim never reaches that list.
 *  · The self-invoicing routes 404 for employees; the Expenses tab exists and
 *    carries no invoice, offer or rate vocabulary.
 *  · Their settings page has no company details, no banking, no insurance —
 *    white card and working-at-heights instead.
 *  · The Employee tick box on /contractors: refused with the reason inline
 *    while the painter has an open offer; flips a clean contractor's portal on
 *    their next load and logs the event; un-ticking sends the profile to
 *    "details needed" (no offers until insurance is verified).
 *  · Changing the lead changes the name the customer's report shows.
 *
 * Every account and row made here is removed at the end.
 */

const staff = credentials("STAFF");
const db: SupabaseClient | null = serviceClient();
const URL = process.env.NEXT_PUBLIC_SUPABASE_URL!;

const run = Date.now().toString(36);
const employee = { email: `pg.e2e.employee.${run}.money@example.com`, password: `Employee-${run}-pw!` };
const flipper = { email: `pg.e2e.employee.${run}.flip@example.com`, password: `Employee-${run}-pw!` };
const ids: { user: string; contractor: string }[] = [];
let fixture: LoopFixture | null = null;
let expenseId = "";
let companyCardId = "";

async function makePainter(creds: { email: string; password: string }, name: string, type: "contractor" | "employee") {
  const created = await db!.auth.admin.createUser({ email: creds.email, password: creds.password, email_confirm: true, user_metadata: { name } });
  if (created.error || !created.data.user) throw new Error(`create ${name}: ${created.error?.message}`);
  const uid = created.data.user.id;
  const role = await db!.from("profiles").update({ role: "contractor", name }).eq("id", uid);
  if (role.error) throw new Error(role.error.message);
  const c = await db!.from("contractors").insert({ profile_id: uid, tier: "B", active: true, company_name: "", employment_type: type }).select("id").single();
  if (c.error) throw new Error(c.error.message);
  ids.push({ user: uid, contractor: (c.data as { id: string }).id });
  return (c.data as { id: string }).id;
}

const JPEG = Buffer.from(
  "/9j/4AAQSkZJRgABAQEAYABgAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkSEw8UHRofHh0a" +
  "HBwgJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPC4zNDL/wAALCAABAAEBAREA/8QAFAABAAAAAAAA" +
  "AAAAAAAAAAAACf/EABQQAQAAAAAAAAAAAAAAAAAAAAD/2gAIAQEAAD8AKp//2Q==", "base64");

test.describe("employed painter — expenses, settings, the tick box, the lead", () => {
  test.skip(!staff, missingCreds("STAFF"));
  test.skip(!db, "set SUPABASE_SERVICE_ROLE_KEY to provision the accounts");
  test.describe.configure({ mode: "serial" });

  let employeeCid = "";
  let flipperCid = "";

  test.beforeAll(async () => {
    // The switch must be on for the office's tick box to exist at all.
    const flag = await db!.from("settings").upsert({ key: "employees_enabled", value: { enabled: true } }, { onConflict: "key" });
    if (flag.error) throw new Error(flag.error.message);

    employeeCid = await makePainter(employee, "E2E Money Employee", "employee");
    flipperCid = await makePainter(flipper, "E2E Flip Contractor", "contractor");

    fixture = await createLoopFixture(db!, employeeCid, [{ heading: "Kitchen", labels: ["Walls"] }]);
    await db!.from("work_orders").update({ contractor_id: null, start_date: null, end_date: null, stage: "offered", status: "issued" }).eq("id", fixture.workOrderId);
    const r = await rpcAs(staff!, "assign_job", {
      p_work_order_id: fixture.workOrderId,
      p_painters: [{ contractor_id: employeeCid, start_date: "2026-12-01", end_date: "2026-12-02" }],
      p_lead_contractor_id: employeeCid,
    });
    if (!r.startsWith("ok:")) throw new Error(`assign_job: ${r}`);
  });

  test.afterAll(async () => {
    if (fixture) await destroyLoopFixture(db!, fixture);
    for (const { contractor } of ids) {
      await db!.from("contractor_expenses").delete().eq("contractor_id", contractor);
      const r = await db!.from("contractors").delete().eq("id", contractor);
      if (r.error) throw new Error(`teardown contractors: ${r.error.message}`);
    }
    for (const { user } of ids) {
      const r = await db!.auth.admin.deleteUser(user);
      if (r.error) throw new Error(`teardown user: ${r.error.message}`);
    }
  });

  test("the Expenses tab exists, the invoicing routes do not, and no invoice vocabulary reaches the employee", async ({ page }) => {
    await signIn(page, employee, /\/portal/);
    await expect(page.getByRole("link", { name: /expenses/i })).toBeVisible();
    await expect(page.getByRole("link", { name: /invoicing/i })).toHaveCount(0);
    const res = await page.goto("/portal/money");
    expect(res?.status()).toBe(200);
    await expect(page.getByTestId("expenses-only")).toBeVisible();
    const html = await page.content();
    for (const key of KNOWN_MONEY_KEYS.filter((k) => !/^(amount_cents|thresholdCents)$/.test(k))) expect(html, `leaked ${key}`).not.toContain(key);
    await expect(page.locator("body")).not.toContainText(/invoice|RCTI|your price|contract/i);
    for (const path of [`/portal/money/${crypto.randomUUID()}`, "/portal/requests"]) {
      expect((await page.goto(path))?.status(), path).toBe(404);
    }
  });

  test("a $140 personal-card expense is flagged over the threshold, approved, and lands in Employee reimbursements — on no invoice", async ({ page }) => {
    await signIn(page, employee, /\/portal/);
    await page.goto("/portal/money");
    await page.getByTestId("expense-open").click();
    await page.getByTestId("expense-file").setInputFiles({ name: "receipt.jpg", mimeType: "image/jpeg", buffer: JPEG });
    await page.getByTestId("expense-cat-sundries").click();
    await page.getByTestId("expense-dollars").fill("140.00");
    await page.getByTestId("paid-with-personal").click();
    await expect(page.locator("body")).toContainText(/over \$100\.00 without a pre-approval/i);
    await page.getByTestId("expense-send").click();
    // The radio's own hint also says "pays you back" — wait for the SEND to land.
    await expect(page.locator("body")).toContainText(/Claim sent — once approved the office pays you back/i, { timeout: 30_000 });

    const { data: rows } = await db!.from("contractor_expenses")
      .select("id, amount_cents, status, paid_with, over_threshold_unapproved, invoice_id")
      .eq("contractor_id", employeeCid).order("created_at", { ascending: false });
    const e = (rows as { id: string; amount_cents: number; status: string; paid_with: string; over_threshold_unapproved: boolean; invoice_id: string | null }[])[0];
    expenseId = e.id;
    expect(e.amount_cents).toBe(14_000);
    expect(e.status).toBe("submitted");
    expect(e.paid_with).toBe("personal");
    expect(e.over_threshold_unapproved).toBe(true);

    // And a company-card one, which must never reach the reimbursement list.
    await page.reload();
    await page.getByTestId("expense-open").click();
    await page.getByTestId("expense-file").setInputFiles({ name: "receipt2.jpg", mimeType: "image/jpeg", buffer: JPEG });
    await page.getByTestId("expense-cat-parking").click();
    await page.getByTestId("expense-dollars").fill("12.00");
    await page.getByTestId("paid-with-company_card").click();
    await page.getByTestId("expense-send").click();
    await expect(page.locator("body")).toContainText(/Claim sent — it's with the office as a job cost/i, { timeout: 30_000 });
    const { data: rows2 } = await db!.from("contractor_expenses").select("id, paid_with").eq("contractor_id", employeeCid).eq("paid_with", "company_card");
    companyCardId = (rows2 as { id: string }[])[0].id;

    // The PC approves both.
    for (const id of [expenseId, companyCardId]) {
      expect(await rpcAs(staff!, "contractor_expense_decide", { p_id: id, p_approve: true })).toMatch(/^ok:/);
    }
    // Payables: the personal one is owed back; the company-card one is not.
    const office = await page.context().browser()!.newContext();
    const staffPage = await office.newPage();
    await signIn(staffPage, staff!, /\/(home|estimates)/);
    await staffPage.goto("/invoicing?tab=pay");
    await expect(staffPage.getByTestId("reimbursements")).toBeVisible({ timeout: 30_000 });
    await expect(staffPage.getByTestId(`reimbursement-${expenseId}`)).toContainText("$140.00");
    await expect(staffPage.getByTestId(`reimbursement-${companyCardId}`)).toHaveCount(0);
    await staffPage.getByTestId(`reimburse-${expenseId}`).click();
    await expect(staffPage.getByTestId(`reimbursement-${expenseId}`)).toHaveCount(0, { timeout: 15_000 });
    await office.close();

    const { data: paid } = await db!.from("contractor_expenses").select("status, reimbursed_at, invoice_id").eq("id", expenseId).single();
    expect((paid as { status: string }).status).toBe("paid");
    expect((paid as { reimbursed_at: string | null }).reimbursed_at).not.toBeNull();
    expect((paid as { invoice_id: string | null }).invoice_id).toBeNull();
    const { count } = await db!.from("contractor_invoices").select("id", { count: "exact", head: true }).eq("contractor_id", employeeCid);
    expect(count, "an employee never has an invoice").toBe(0);
  });

  test("the employee's settings page: tickets, not insurance; no company details, no banking", async ({ page }) => {
    await signIn(page, employee, /\/portal/);
    await page.goto("/portal/profile");
    await expect(page.getByTestId("compliance-card")).toContainText(/your tickets/i);
    const options = await page.locator("#dockind option").allTextContents();
    expect(options).toEqual(["White card", "Working at heights"]);
    await expect(page.locator("body")).not.toContainText(/company details|where you get paid|public liability|painters on your crew|ABN/i);
  });

  test("the tick box: refused inline while an offer is open; flips a clean contractor; un-ticking sends them to details needed", async ({ page }) => {
    // Give the contractor an open offer straight in (the board is proven elsewhere).
    const openJob = await createLoopFixture(db!, flipperCid, [{ heading: "Porch", labels: ["Rails"] }]);
    await db!.from("work_orders").update({ stage: "offered", status: "issued" }).eq("id", openJob.workOrderId);
    const offer = await db!.from("booking_offers").insert({
      work_order_id: openJob.workOrderId, contractor_id: flipperCid, state: "offered", start_date: "2026-12-08",
      expires_at: new Date(Date.now() + 86_400_000).toISOString(),
    }).select("id").single();
    if (offer.error) throw new Error(offer.error.message);

    await signIn(page, staff!, /\/(home|estimates)/);
    await page.goto("/contractors");
    const box = page.getByTestId(`employee-${flipperCid}`);
    await expect(box).toBeVisible();
    await expect(box).not.toBeChecked();
    await box.click();
    await expect(page.getByTestId(`employee-refusal-${flipperCid}`)).toContainText(/open offer or booking on WO-/);
    await page.reload();
    await expect(page.getByTestId(`employee-${flipperCid}`)).not.toBeChecked();

    // Clear the offer: now it flips, and the event is on the record.
    await db!.from("booking_offers").update({ state: "withdrawn", responded_at: new Date().toISOString() }).eq("id", (offer.data as { id: string }).id);
    await destroyLoopFixture(db!, openJob);
    await page.reload();
    await page.getByTestId(`employee-${flipperCid}`).click();
    await expect(page.locator("body")).toContainText(/Marked as an employee/, { timeout: 15_000 });
    const { data: c } = await db!.from("contractors").select("employment_type").eq("id", flipperCid).single();
    expect((c as { employment_type: string }).employment_type).toBe("employee");
    const { count } = await db!.from("contractor_events").select("id", { count: "exact", head: true })
      .eq("contractor_id", flipperCid).eq("type", "employment_type_changed");
    expect(count).toBe(1);

    // Their portal switches on the next load.
    const theirs = await page.context().browser()!.newContext();
    const theirPage = await theirs.newPage();
    await signIn(theirPage, flipper, /\/portal/);
    await expect(theirPage.locator("header")).toContainText(/painter portal/i);
    await expect(theirPage.getByRole("link", { name: /invoicing/i })).toHaveCount(0);
    await theirs.close();

    // Un-tick: back to contractor, details needed, not offerable.
    await page.reload();
    await page.getByTestId(`employee-${flipperCid}`).click();
    await expect(page.locator("body")).toContainText(/Marked as a contractor/, { timeout: 15_000 });
    const { data: back } = await db!.from("contractors").select("employment_type, offerable").eq("id", flipperCid).single();
    expect((back as { employment_type: string }).employment_type).toBe("contractor");
    expect((back as { offerable: boolean }).offerable, "no verified insurance → no offers").toBe(false);
  });

  test("changing the lead changes the name the customer's completion report shows", async () => {
    // A second employee joins; the lead moves to them; the signed-off report
    // reads the lead through work_orders.contractor_id — the one read surface.
    const second = { email: `pg.e2e.employee.${run}.second@example.com`, password: `Employee-${run}-pw!` };
    const secondCid = await makePainter(second, "E2E Second Lead", "employee");
    const add = await rpcAs(staff!, "assign_job", {
      p_work_order_id: fixture!.workOrderId,
      p_painters: [{ contractor_id: secondCid, start_date: "2026-12-01", end_date: "2026-12-02" }],
      p_lead_contractor_id: employeeCid, p_override_reason: null,
    });
    expect(add).toMatch(/^ok:/);
    expect(await rpcAs(staff!, "set_lead_painter", { p_work_order_id: fixture!.workOrderId, p_contractor_id: secondCid })).toBe("ok:lead");
    const { data: wo } = await db!.from("work_orders").select("contractor_id, contractors(profiles(name))").eq("id", fixture!.workOrderId).single();
    const name = (wo as unknown as { contractors: { profiles: { name: string } | null } | null }).contractors?.profiles?.name;
    expect(name).toBe("E2E Second Lead");
    void URL;
  });
});
