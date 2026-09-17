import { test, expect } from "@playwright/test";
import type { SupabaseClient } from "@supabase/supabase-js";
import { signIn } from "./helpers";
import {
  accessTokenFor, createLoopFixture, destroyLoopFixture, serviceClient, type LoopFixture,
} from "./fixtures/woLoop";
import { KNOWN_MONEY_KEYS, findMoneyKeys } from "../lib/painters/money";

/**
 * The golden adversarial money test (employed-painters brief §3.3).
 *
 * As a REAL employee account, fetch every surface an employee can reach and
 * assert that nothing money-shaped is in what came back — not in the rendered
 * HTML, not in the RSC payload behind it, and not in what the database
 * answers when the same session asks it directly. "Not visible" and "not
 * sent" are different things; only the second one is a control.
 *
 * The fixture is adversarial on purpose: the employee is the contractor_id on
 * a work order that carries a contractor payment, an ACCEPTED offer with a
 * price, a priced variation and a priced event. Everything a contractor would
 * see. The assertion is that an employee sees none of it.
 *
 * The account is created for this run (pg.e2e.*, the hygiene marker) and
 * removed at the end — a suite that accumulates data is a defect.
 */

const db: SupabaseClient | null = serviceClient();
const URL = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const ANON = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;

const run = Date.now().toString(36);
const employee = { email: `pg.e2e.employee.${run}@example.com`, password: `Employee-${run}-pw!` };

let userId: string | null = null;
let contractorId: string | null = null;
let fixture: LoopFixture | null = null;
let offerId: string | null = null;
let variationId: string | null = null;

/** A direct PostgREST read under the EMPLOYEE's own token. */
async function readAsEmployee(path: string): Promise<{ rows: unknown[] | null; error: { code?: string; message?: string } | null }> {
  const token = await accessTokenFor(employee);
  const body = await fetch(`${URL}/rest/v1/${path}`, {
    headers: { apikey: ANON, Authorization: `Bearer ${token}` },
  }).then((r) => r.json());
  return Array.isArray(body) ? { rows: body, error: null } : { rows: null, error: body };
}

test.describe("an employed painter never sees money", () => {
  test.skip(!db, "set SUPABASE_SERVICE_ROLE_KEY to provision the employee account");

  test.beforeAll(async () => {
    // 1. The account: a contractor-role login whose contractors row is an
    //    EMPLOYEE (migration 20270153). Same path the office's tick box will
    //    take in Session 5, minus the RPC.
    const created = await db!.auth.admin.createUser({
      email: employee.email, password: employee.password, email_confirm: true,
      user_metadata: { name: "E2E Employee" },
    });
    if (created.error || !created.data.user) throw new Error(`create employee: ${created.error?.message}`);
    userId = created.data.user.id;

    const role = await db!.from("profiles").update({ role: "contractor" }).eq("id", userId);
    if (role.error) throw new Error(`profile role: ${role.error.message}`);

    const c = await db!.from("contractors")
      .insert({ profile_id: userId, tier: "B", active: true, company_name: "", employment_type: "employee" })
      .select("id, employment_type").single();
    if (c.error) throw new Error(`contractors row: ${c.error.message}`);
    contractorId = (c.data as { id: string }).id;
    expect((c.data as { employment_type: string }).employment_type).toBe("employee");

    // 2. The adversarial fixture: money everywhere a contractor would find it.
    fixture = await createLoopFixture(db!, contractorId, [{ heading: "Lounge", labels: ["Walls", "Ceiling"] }]);
    const wo = await db!.from("work_orders")
      .update({ contractor_payment_cents: 123_456, wo_snapshot: { ...(await snapshotOf(fixture.workOrderId)), contractorPaymentCents: 123_456 } })
      .eq("id", fixture.workOrderId);
    if (wo.error) throw new Error(`wo money: ${wo.error.message}`);

    const offer = await db!.from("booking_offers").insert({
      work_order_id: fixture.workOrderId, contractor_id: contractorId, state: "accepted",
      start_date: "2026-10-05", end_date: "2026-10-07", hours_allowance: 16, payment_cents: 98_765,
      expires_at: new Date(Date.now() + 86_400_000).toISOString(), responded_at: new Date().toISOString(),
    }).select("id").single();
    if (offer.error) throw new Error(`offer: ${offer.error.message}`);
    offerId = (offer.data as { id: string }).id;

    const v = await db!.from("wo_variations").insert({
      work_order_id: fixture.workOrderId, raised_kind: "contractor", category: "extra_scope",
      comment: "E2E priced variation", est_hours: 3, status: "customer_approved",
      price_cents: 45_000, contractor_delta_cents: 18_000, priced_lines: [{ label: "Extra wall", cents: 45_000 }],
    }).select("id").single();
    if (v.error) throw new Error(`variation: ${v.error.message}`);
    variationId = (v.data as { id: string }).id;

    const ev = await db!.from("wo_events").insert({
      work_order_id: fixture.workOrderId, type: "variation_priced", actor_kind: "staff",
      meta: { variation_id: variationId, price_cents: 45_000 },
    });
    if (ev.error) throw new Error(`event: ${ev.error.message}`);
  });

  test.afterAll(async () => {
    // Everything this run created goes, checked. Offer, variation and events
    // cascade from the work order, which cascades from the estimate.
    if (fixture) await destroyLoopFixture(db!, fixture);
    if (contractorId) {
      const r = await db!.from("contractors").delete().eq("id", contractorId);
      if (r.error) throw new Error(`teardown contractors: ${r.error.message}`);
    }
    if (userId) {
      const r = await db!.auth.admin.deleteUser(userId);
      if (r.error) throw new Error(`teardown user: ${r.error.message}`);
    }
  });

  test("the fixture really carries money (so the assertions below are not vacuous)", async () => {
    const { data } = await db!.from("work_orders").select("contractor_payment_cents").eq("id", fixture!.workOrderId).single();
    expect((data as { contractor_payment_cents: number }).contractor_payment_cents).toBe(123_456);
    const { data: o } = await db!.from("booking_offers").select("payment_cents").eq("id", offerId!).single();
    expect((o as { payment_cents: number }).payment_cents).toBe(98_765);
  });

  test("the employee signs in and lands in the portal, with no offers or invoicing tab", async ({ page }) => {
    await signIn(page, employee, /\/portal/);
    await expect(page.getByRole("link", { name: /jobs/i }).first()).toBeVisible();
    await expect(page.getByRole("link", { name: /invoicing/i })).toHaveCount(0);
    await expect(page.getByRole("link", { name: /requests/i })).toHaveCount(0);
    await expect(page.locator("header")).toContainText(/painter portal/i);
  });

  test("no money-shaped key or dollar figure reaches the employee's browser", async ({ page }) => {
    await signIn(page, employee, /\/portal/);
    for (const path of ["/portal", "/portal/jobs", "/portal/calendar", "/portal/profile", "/portal/help"]) {
      const response = await page.goto(path);
      expect(response?.status(), `${path} should render`).toBeLessThan(400);
      const html = (await response?.text()) ?? "";
      // The concrete names this codebase gives painter money (session-0 §4),
      // checked against the WHOLE response — RSC payload included.
      for (const key of KNOWN_MONEY_KEYS) {
        expect(html, `${path} leaked ${key}`).not.toContain(key);
      }
      // Dollar figures are checked on the rendered TEXT — the RSC payload
      // uses `$1`, `$L2` as reference markers, which are not money.
      const text = await page.locator("body").innerText();
      expect(text, `${path} renders a dollar figure`).not.toMatch(/\$\s?\d/);
      expect(text, `${path} mentions a rate`).not.toMatch(/\/\s?hr\b|per hour/i);
      expect(html, `${path} mentions their price`).not.toMatch(/your price/i);
      expect(html, `${path} talks about offers`).not.toMatch(/send you an offer|offered work/i);
    }
  });

  test("the self-invoicing and offer routes do not exist for an employee; the money tab is expenses only", async ({ page }) => {
    await signIn(page, employee, /\/portal/);
    for (const path of ["/portal/requests", `/portal/money/${crypto.randomUUID()}`]) {
      const response = await page.goto(path);
      expect(response?.status(), path).toBe(404);
    }
    // Session 5: /portal/money IS a page for an employee — expenses only. No
    // invoice, offer or price vocabulary on it; the receipt amounts are the
    // painter's own figures and are the one money-shaped thing allowed here.
    const res = await page.goto("/portal/money");
    expect(res?.status()).toBe(200);
    await expect(page.getByTestId("expenses-only")).toBeVisible();
    await expect(page.locator("body")).not.toContainText(/invoice|RCTI|your price|contract|\/hr/i);
  });

  test("every direct read of a money table as the employee is denied — zero rows, and nothing else", async () => {
    // These rows EXIST and are keyed to this very painter; a contractor would
    // read every one of them.
    const denied = [
      `work_orders?id=eq.${fixture!.workOrderId}&select=id,contractor_payment_cents`,
      `booking_offers?id=eq.${offerId}&select=id,payment_cents`,
      `wo_variations?id=eq.${variationId}&select=id,price_cents,contractor_delta_cents`,
      `wo_events?work_order_id=eq.${fixture!.workOrderId}&select=id,meta`,
      `contractor_invoices?select=id,total_inc_cents`,
      `estimates?id=eq.${fixture!.estimateId}&select=id,total_cents`,
      `invoices?select=id`,
      `rate_items?select=id&limit=1`,
      // S6: the office's cost rate and the labour line it posts — staff-only tables.
      `employee_cost_rates?select=id,cents_per_hour`,
      `job_costs?work_order_id=eq.${fixture!.workOrderId}&select=id,amount_ex_cents`,
    ];
    for (const path of denied) {
      const { rows, error } = await readAsEmployee(path);
      // A denial is either RLS filtering to nothing or a permission error —
      // both are "no data". What must never happen is a row.
      if (rows) expect(rows, `${path} returned rows to an employee`).toEqual([]);
      else expect(error?.code, `${path} should be a permission refusal, got ${JSON.stringify(error)}`).toMatch(/^42501$|^PGRST/);
    }
  });

  test("the same session still reads the job's surfaces — the exclusion is money, not the job", async () => {
    // wo_visible_jobs (owner-rights view) still lists the job for its painter,
    // so the tick list, photos and checklists carry on working for employees.
    const { rows, error } = await readAsEmployee(`wo_surfaces?work_order_id=eq.${fixture!.workOrderId}&select=id,label`);
    expect(error).toBeNull();
    expect(rows?.length).toBe(2);
    expect(findMoneyKeys(rows)).toEqual([]);
  });
});

async function snapshotOf(workOrderId: string): Promise<Record<string, unknown>> {
  const { data, error } = await db!.from("work_orders").select("wo_snapshot").eq("id", workOrderId).single();
  if (error) throw new Error(`snapshot: ${error.message}`);
  return ((data as { wo_snapshot: Record<string, unknown> }).wo_snapshot) ?? {};
}
