import { test, expect } from "@playwright/test";
import type { SupabaseClient } from "@supabase/supabase-js";
import { randomBytes } from "node:crypto";
import { serviceClient, createLoopFixture, destroyLoopFixture, type LoopFixture } from "./fixtures/woLoop";
import { deleteUserByEmail, destroyAccountChain, magicLinkFor } from "./fixtures/portal";
import { defaultCustomer, defaultWizardState, wizardStateSchema } from "../lib/wizard/state";

/**
 * 3a-7 · The commercial workspace, as the signed-in trade customer.
 *
 * What must hold: a trade account gets the portfolio Home (tiles, the
 * attention queue with one action each, jobs underway) and the trade tabs;
 * Properties carries the register and the ONE-TAP REBOOK whose link seeds
 * the wizard with the prior answers; Money shows the month's consolidated
 * total and the statement; and a residential account sees none of it.
 */

const db: SupabaseClient | null = serviceClient();

test.describe("portal commercial (3a-7)", () => {
  test.skip(!db, "set SUPABASE_SERVICE_ROLE_KEY to run the commercial suite");

  const run = randomBytes(4).toString("hex");
  const email = `pg.e2e.trade.${run}@example.com`;
  let accountId = "";
  let fixture: LoopFixture | null = null;
  let clarkeId = "";
  let westgarthId = "";
  let rebookEstimateId = "";
  const today = new Intl.DateTimeFormat("en-CA", { timeZone: "Australia/Melbourne" }).format(new Date());
  const day = (n: number) =>
    new Intl.DateTimeFormat("en-CA", { timeZone: "Australia/Melbourne" }).format(new Date(Date.now() + n * 86_400_000));

  test.beforeAll(async () => {
    const sb = db!;
    const acct = await sb.from("accounts")
      .insert({ email, name: "Harcourts Northcote", account_type: "trade" }).select("id").single();
    if (acct.error) throw new Error(acct.error.message);
    accountId = acct.data.id;

    const propA = await sb.from("properties").insert({
      account_id: accountId, address: "8/22 Clarke St", suburb: "Northcote", postcode: "3070",
      address_norm: "8 22 clarke st northcote 3070",
    }).select("id").single();
    const propB = await sb.from("properties").insert({
      account_id: accountId, address: "6/31 Westgarth St", suburb: "Northcote", postcode: "3070",
      address_norm: "6 31 westgarth st northcote 3070",
    }).select("id").single();
    if (propA.error || propB.error) throw new Error("property fixtures failed");
    clarkeId = propA.data.id;
    westgarthId = propB.data.id;

    // The live job at Clarke St: accepted estimate + WO in progress with a
    // priced variation waiting on the client.
    fixture = await createLoopFixture(sb, null as unknown as string, [
      { heading: "Interior", labels: ["Walls"] },
    ]);
    await sb.from("estimates").update({
      account_id: accountId, property_id: clarkeId, title: "8/22 Clarke St, Northcote",
    }).eq("id", fixture.estimateId);
    await sb.from("work_orders").update({ start_date: day(-1), end_date: day(2) }).eq("id", fixture.workOrderId);
    const vn = await sb.from("wo_variations").insert({
      work_order_id: fixture.workOrderId, category: "damage", comment: "Water-damaged ceiling patch",
      status: "priced", price_cents: 34_000, customer_token: `trvt${run}`,
    });
    if (vn.error) throw new Error(vn.error.message);

    // Money this month.
    const inv = await sb.from("invoices").insert({
      estimate_id: fixture.estimateId, kind: "deposit", status: "issued",
      number: `INV-TR${run}`, token: `trtok${run}`,
      subtotal_ex_cents: 90_910, gst_cents: 9_090, total_inc_cents: 100_000,
      issued_on: today, due_on: day(14),
    });
    if (inv.error) throw new Error(inv.error.message);

    // The rebookable prior job at Westgarth: an accepted estimate carrying a
    // VALID wizard state (self-verified against the schema, so the fixture
    // can never silently rot).
    const priorState = {
      ...defaultWizardState(),
      mode: "customer" as const,
      jobType: "interior" as const,
      noPlan: true,
      basics: { bedrooms: 3, storeys: "single" as const, sizeBand: "s120_200" as const, openPlanKitchenLiving: true },
      customer: { ...defaultCustomer(), email, suburb: "Northcote", postcode: "3070" },
    };
    wizardStateSchema.parse(priorState);
    const rebook = await sb.from("estimates").insert({
      title: "6/31 Westgarth St", status: "accepted", level_of_finish: 3, source: "manual",
      account_id: accountId, property_id: westgarthId, total_cents: 398_000,
      builder_state: { blocks: [], wizard: { version: 1, state: priorState } },
    }).select("id").single();
    if (rebook.error) throw new Error(rebook.error.message);
    rebookEstimateId = rebook.data.id;

    // A draft for the tile.
    const draft = await sb.from("estimates").insert({
      title: "14 Herbert St", status: "draft", account_id: accountId, builder_state: { blocks: [] },
    });
    if (draft.error) throw new Error(draft.error.message);
  });

  test.afterAll(async () => {
    const sb = db!;
    if (fixture) {
      const { data: invs } = await sb.from("invoices").select("id").eq("estimate_id", fixture.estimateId);
      const ids = (invs ?? []).map((i) => i.id);
      if (ids.length) await sb.from("payments").delete().in("invoice_id", ids);
      await destroyLoopFixture(sb, fixture);
    }
    await destroyAccountChain(sb, email);
    await deleteUserByEmail(sb, email);
  });

  test("the portfolio Home: tiles, one-action attention queue, jobs underway", async ({ page }) => {
    const sb = db!;
    await page.goto(await magicLinkFor(sb, email));

    await expect(page.locator("h1")).toHaveText("Your properties, at a glance");
    await expect(page.getByText("Trade account")).toBeVisible();
    await expect(page.getByText("Harcourts Northcote").first()).toBeVisible();

    // Tiles: 1 underway · 1 draft · $1,000 invoiced this month.
    const tiles = page.locator(".tile");
    await expect(tiles.nth(0).locator(".num")).toHaveText("1");
    await expect(tiles.nth(2).locator(".num")).toHaveText("1");
    await expect(tiles.nth(3).locator(".num")).toHaveText("$1,000.00");

    // The variation card leads with its price and the one action.
    const attn = page.locator(".job.attn", { hasText: "8/22 Clarke St" });
    await expect(attn).toContainText("$340.00");
    await expect(attn.getByRole("link", { name: "Review & approve" })).toHaveAttribute("href", `/v/trvt${run}`);

    // Jobs underway with the day chip.
    await expect(page.locator(".job", { hasText: "Day 2 of 4" })).toBeVisible();

    // Trade tabs.
    for (const label of ["Properties", "New estimate", "Money"]) {
      await expect(page.locator(".tab", { hasText: label })).toBeVisible();
    }
    expect(await page.getByRole("link", { name: "My colours" }).count()).toBe(0);

    await page.setViewportSize({ width: 390, height: 900 });
    await page.screenshot({ path: "test-results/look-portal/phone-trade-home.png", fullPage: true });
  });

  test("Properties: registers on file and the one-tap rebook link", async ({ page }) => {
    const sb = db!;
    await page.goto(await magicLinkFor(sb, email));
    await page.goto("/account/properties");

    await expect(page.locator("h1")).toHaveText("Properties");
    const clarke = page.locator(".job", { hasText: "8/22 Clarke St" });
    await expect(clarke.locator(".chip")).toHaveText("Job underway");

    const westgarth = page.locator(".job", { hasText: "6/31 Westgarth St" });
    await expect(westgarth.getByRole("link", { name: "Rebook — same spec" }))
      .toHaveAttribute("href", `/estimate?property=${westgarthId}&rebook=${rebookEstimateId}`);
  });

  test("one-tap rebook seeds the wizard with the prior answers", async ({ page }) => {
    const sb = db!;
    await page.goto(await magicLinkFor(sb, email));
    await page.goto(`/estimate?property=${westgarthId}&rebook=${rebookEstimateId}`);
    if (await page.getByText(/nearly here/i).count()) test.skip(true, "wizard unavailable here");

    // Seeded: the no-plan basics are ALREADY the screen (no floorplan
    // question), with the prior answers and the property address in place.
    await expect(page.getByText(/thirty seconds of basics/i)).toBeVisible();
    await expect(page.getByPlaceholder("Suburb")).toHaveValue("Northcote");
    await expect(page.locator("input.wz-field").first()).toHaveValue(/6\/31 Westgarth St/);
    expect(await page.locator("input[type=email]").count()).toBe(0);
  });

  test("consolidated Money: the month's total and the statement", async ({ page }) => {
    const sb = db!;
    await page.goto(await magicLinkFor(sb, email));
    await page.goto("/account/money");

    await expect(page.getByText("Invoiced this month")).toBeVisible();
    await expect(page.getByText("14-day terms")).toBeVisible();
    const month = today.slice(0, 7);
    await page.getByRole("link", { name: "Monthly statement (PDF)" }).click();
    await expect(page).toHaveURL(new RegExp(`/account/statement/${month}`));
    await expect(page.locator("h1")).toContainText("Statement");
    await expect(page.getByText(`INV-TR${run}`)).toBeVisible();
    await expect(page.getByText("Invoiced, inc GST")).toBeVisible();
  });
});
