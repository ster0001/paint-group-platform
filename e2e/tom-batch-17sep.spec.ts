import { test, expect, type Page } from "@playwright/test";
import type { SupabaseClient } from "@supabase/supabase-js";
import { randomBytes } from "node:crypto";
import { credentials, missingCreds, pickDay, signIn } from "./helpers";
import { contractorIdForEmail, createLoopFixture, destroyLoopFixture, serviceClient, type LoopFixture } from "./fixtures/woLoop";
import { PREPARATION_DESCRIPTION } from "../lib/customer/snapshot";

/**
 * Tom's batch of 17 Sep 2026 — eleven items, as staff on the real screens:
 *   1  Invoicing: search by customer name or property address.
 *   2  Builder: Admin notes above Job settings.
 *   3  Builder: the Preparation wording says "time/ materials".
 *   4  Builder: contractor time on the Preparation line → the work order.
 *   5  Autosave before another page opens.
 *   6  Walls: Room L×W×H or Single wall W×H, priced on its own.
 *   8  CRM: a mini calendar behind every date box.
 *   9  CRM: the saved follow-up date shows again when you come back.
 *  10  PC Command: Variations for approval.
 *  11  The customer's Chat with us sits clear of the tab bar on a phone.
 * (7, the email reply relay, is a webhook — lib/messaging + the inbound route.)
 */
const db: SupabaseClient | null = serviceClient();
const staff = credentials("STAFF");
const contractor = credentials("CONTRACTOR");
const customer = credentials("CUSTOMER");
const run = randomBytes(3).toString("hex");


test.describe("Tom's 17 Sep batch", () => {
  test.skip(!db || !staff, missingCreds("STAFF"));

  // ---------- fixtures ----------
  let builtId = "";
  let invoiceEstimateId = "";
  let invoiceId = "";
  let fixture: LoopFixture | null = null;
  let variationId = "";
  let accountId = "";
  const CUSTOMER_NAME = `Zaphod Searchable${run}`;
  const ADDRESS = `${Number.parseInt(run, 16) % 900 + 1} Probe Lane ${run}`;

  test.beforeAll(async () => {
    // A built estimate for the builder items (2, 3, 4, 5, 6).
    const est = await db!.from("estimates").insert({
      title: `Batch 17 Sep ${run}`, status: "draft", source: "manual", level_of_finish: 3, share_token: `b17${run}${randomBytes(8).toString("hex")}`,
      builder_state: {
        blocks: [{ id: 1, kind: "area", name: "Living room", type: "Interior", areaType: "room", L: 4, W: 3, H: 2.4, isOption: false, description: "", open: false, media: [],
          surfaces: [{ id: 11, code: "Walls", coats: 2, count: 0, prepHr: 0, internalLabel: "Walls", clientLabel: "Walls", measureL: null, measureH: null, qtyOverride: null, rateOverride: null, paintingHrOverride: null, priceOverride: null, productName: null, color: "", colorHex: "", coverageOverride: null, volumeOverride: null, unitPriceOverride: null, crewNote: "", hideQty: false, showCoats: true, showPrice: false, useCustomRate: false, customRate: null, open: false, media: [], hidden: false }] }],
        modSel: { "Level of Finish": "FIN-3" }, materials: {},
      },
    }).select("id").single();
    if (est.error) throw new Error(est.error.message);
    builtId = est.data.id;

    // An accepted job with an issued invoice for the search (1).
    const inv = await db!.from("estimates").insert({
      title: ADDRESS, status: "accepted", source: "manual", level_of_finish: 3, accepted_name: CUSTOMER_NAME, accepted_total_cents: 550_000,
      sent_snapshot: { version: 1, jobAddress: ADDRESS, areas: [], lineItems: [], options: [] },
    }).select("id").single();
    if (inv.error) throw new Error(inv.error.message);
    invoiceEstimateId = inv.data.id;
    const row = await db!.from("invoices").insert({
      estimate_id: invoiceEstimateId, kind: "deposit", status: "issued", number: `INV-B17${run}`, token: `b17tok${run}${randomBytes(6).toString("hex")}`,
      subtotal_ex_cents: 50_000, gst_cents: 5_000, total_inc_cents: 55_000,
      issued_on: new Date().toISOString().slice(0, 10), due_on: new Date(Date.now() + 7 * 86_400_000).toISOString().slice(0, 10),
    }).select("id").single();
    if (row.error) throw new Error(row.error.message);
    invoiceId = row.data.id;

    // A job with a raised variation for PC Command (10).
    if (contractor) {
      const contractorId = await contractorIdForEmail(db!, contractor.email);
      if (contractorId) {
        fixture = await createLoopFixture(db!, contractorId, [{ heading: "Front", labels: ["Walls"] }]);
        const v = await db!.from("wo_variations").insert({
          work_order_id: fixture.workOrderId, category: "rot",
          comment: `Sill rotten ${run}`, est_hours: 2, status: "raised",
        }).select("id").single();
        if (v.error) throw new Error(v.error.message);
        variationId = v.data.id;
      }
    }

    // A CRM customer for the date picker (8, 9).
    const acc = await db!.from("accounts").insert({ name: `Dated Customer ${run}`, phone: `04${String(Number.parseInt(run, 16)).padStart(8, "0").slice(0, 8)}` }).select("id").single();
    if (acc.error) throw new Error(acc.error.message);
    accountId = acc.data.id;
  });

  test.afterAll(async () => {
    if (!db) return;
    if (fixture) { await db.from("wo_variations").delete().eq("work_order_id", fixture.workOrderId); await destroyLoopFixture(db, fixture); }
    if (invoiceId) await db.from("invoices").delete().eq("id", invoiceId);
    for (const id of [builtId, invoiceEstimateId]) {
      if (!id) continue;
      await db.from("invoices").delete().eq("estimate_id", id);
      await db.from("work_orders").delete().eq("estimate_id", id);
      await db.from("estimates").delete().eq("id", id);
    }
    if (accountId) await db.from("accounts").delete().eq("id", accountId);
  });

  const rowValue = (page: Page, label: string) =>
    page.locator("dl div", { has: page.locator("dt", { hasText: new RegExp(`^${label}$`) }) }).first().locator("dd");

  test("1 · Invoicing finds a job by the customer's name or the address, on both invoice screens", async ({ page }) => {
    await signIn(page, staff!, /\/(estimates|crm|quote|$)/);
    // The Invoicing list (?q=).
    await page.goto(`/invoices?f=all&q=searchable${run}`);
    await expect(page.getByTestId("invoices-search-input")).toHaveValue(`searchable${run}`);
    await expect(page.getByTestId(`job-${invoiceEstimateId}`)).toBeVisible({ timeout: 30_000 });
    await expect(page.getByTestId(`customer-${invoiceEstimateId}`)).toContainText(CUSTOMER_NAME);
    await page.goto(`/invoices?f=all&q=probe%20lane%20${run}`);
    await expect(page.getByTestId(`job-${invoiceEstimateId}`)).toBeVisible({ timeout: 30_000 });
    // The tab links keep the needle; a no-match says so; Clear takes it off.
    await page.getByRole("link", { name: "awaiting" }).click();
    await expect(page).toHaveURL(/f=awaiting/);
    await expect(page).toHaveURL(new RegExp(`q=probe`));
    await page.goto("/invoices?f=all&q=zzz-no-such-customer");
    await expect(page.getByTestId("invoices-search-empty")).toBeVisible();
    await page.getByTestId("invoices-search-clear").click();
    await expect(page).toHaveURL(/\/invoices\?f=all$/);

    // The Payments dashboard (client-side, live).
    await page.goto("/invoicing");
    const rows = page.getByTestId("receivable-rows").locator(".r");
    await expect(rows.first()).toBeVisible({ timeout: 30_000 });
    await page.getByTestId("payments-search-input").fill(`searchable${run}`);
    await expect(rows).toHaveCount(1);
    await expect(rows.first()).toContainText(ADDRESS);
    await expect(rows.first()).toContainText(CUSTOMER_NAME);
    await page.getByTestId("payments-search-input").fill("zzz-no-such-customer");
    await expect(rows).toHaveCount(0);
    await expect(page.getByTestId("receivable-rows")).toContainText("No invoice matches");
    await page.getByTestId("payments-search-clear").click();
    await expect(rows.first()).toBeVisible();
  });

  test("2 · 3 · 4 · 6 · the builder: admin notes, the wording, contractor time on the work order, and a single wall", async ({ page }) => {
    test.setTimeout(180_000);
    await signIn(page, staff!, /\/(estimates|crm|quote|$)/);
    await page.goto(`/quote?id=${builtId}`);
    await page.waitForLoadState("networkidle");

    // 2 — Admin notes sits ABOVE Job settings.
    const notes = page.getByTestId("admin-notes");
    await expect(notes).toBeVisible();
    const notesBox = await notes.boundingBox();
    const settingsBox = await page.getByText("Job settings", { exact: false }).first().boundingBox();
    expect(notesBox!.y).toBeLessThan(settingsBox!.y);
    await page.getByTestId("admin-notes-input").fill(`Customer mentioned the hallway ceiling is stained — check on site. ${run}`);

    // 3 — the wording.
    const card = page.getByTestId("preparation-line");
    await expect(card).toContainText("Allowance for time/ materials for job site set up, fillers and consumables");
    await expect(card).toContainText(PREPARATION_DESCRIPTION);

    // 4 — contractor time: the line and the subtotal move by hours × charge-out.
    const prepBefore = Number((await rowValue(page, "Preparation").textContent() ?? "").replace(/[^0-9.]/g, ""));
    const hours = page.getByTestId("preparation-hours");
    await hours.click();
    await hours.fill("2");
    await expect(page.getByTestId("preparation-hours-hint")).toContainText("Adds 2 h to the contractor");
    await expect.poll(async () => Number((await rowValue(page, "Preparation").textContent() ?? "").replace(/[^0-9.]/g, ""))).toBeGreaterThan(prepBefore);

    // 6 — a walls row switched to a single wall: W × H is the quantity, coats its own.
    await page.getByText("Living room", { exact: true }).first().click();
    const measure = page.getByTestId("wall-measure-11");
    await expect(measure).toBeVisible();
    await page.getByTestId("wall-measure-wall-11").click();
    await expect(page.getByTestId("wall-height-11")).toHaveValue("2.4");
    await page.getByTestId("wall-width-11").fill("3");
    await page.getByTestId("wall-coats-11").selectOption("3");
    // 3 m × 2.4 m = 7.2 m² → shown as 7 m² on the row.
    await expect(page.getByTestId("surface-row-11")).toContainText(/7 m²/);
    await page.getByTestId("wall-measure-room-11").click();
    await expect(page.getByTestId("wall-width-11")).toHaveCount(0);
    // Back to the room: perimeter 14 m × 2.4 m = 33.6 → 34 m².
    await expect(page.getByTestId("surface-row-11")).toContainText(/34 m²/);
    await page.getByTestId("wall-measure-wall-11").click();
    await page.getByTestId("wall-width-11").fill("3");
    await page.getByRole("button", { name: /^← / }).first().click().catch(() => undefined);

    // Save, and read back everything the batch wrote.
    await page.getByTestId("builder-save").click();
    await expect.poll(async () => {
      const { data } = await db!.from("estimates").select("builder_state").eq("id", builtId).single();
      const bs = data?.builder_state as { adminNotes?: string; preparationHours?: number | null } | null;
      return bs?.preparationHours ?? null;
    }, { timeout: 20_000 }).toBe(2);
    const { data } = await db!.from("estimates").select("builder_state, sent_snapshot").eq("id", builtId).single();
    const bs = data!.builder_state as {
      adminNotes: string; preparationHours: number;
      blocks: { surfaces: { id: number; measureMode?: string | null; measureL: number | null; measureH: number | null; coats: number }[] }[];
      woDoc: { areas: { id: string; title: string; surfaces: { key: string; label: string; hours: number | null }[] }[] };
    };
    expect(bs.adminNotes).toContain(`stained — check on site. ${run}`);
    // The work order carries the time as its own Preparation area, first.
    expect(bs.woDoc.areas[0].id).toBe("preparation");
    expect(bs.woDoc.areas[0].title).toBe("Preparation");
    expect(bs.woDoc.areas[0].surfaces[0].hours).toBe(2);
    expect(bs.woDoc.areas.reduce((n, a) => n + a.surfaces.reduce((m, s) => m + (s.hours ?? 0), 0), 0)).toBeGreaterThanOrEqual(2);
    const wall = bs.blocks[0].surfaces.find((s) => s.id === 11)!;
    expect(wall.measureMode).toBe("wall");
    expect(wall.measureL).toBe(3);
    expect(wall.measureH).toBe(2.4);
    expect(wall.coats).toBe(3);
    // The customer's copy: the admin notes are NOT on it; the Preparation line carries the time.
    const snap = data!.sent_snapshot as { preparation: { priceCents: number; descriptionHtml: string } };
    expect(JSON.stringify(snap)).not.toContain("check on site");
    expect(snap.preparation.descriptionHtml).toContain("time/ materials");
    expect(snap.preparation.priceCents).toBeGreaterThan(prepBefore * 100);
  });

  test("5 · clicking away with unsaved work saves first, then opens the page", async ({ page }) => {
    await signIn(page, staff!, /\/(estimates|crm|quote|$)/);
    await page.goto(`/quote?id=${builtId}`);
    await page.waitForLoadState("networkidle");
    const note = `Autosaved on the way out ${run}`;
    await page.getByTestId("admin-notes-input").fill(note);
    // Unsaved — and the sidebar's Estimates link is clicked, not Save.
    await page.locator("nav a[href='/estimates'], a[href='/estimates']").first().click();
    await expect(page).toHaveURL(/\/estimates/, { timeout: 30_000 });
    await expect.poll(async () => {
      const { data } = await db!.from("estimates").select("builder_state").eq("id", builtId).single();
      return (data?.builder_state as { adminNotes?: string } | null)?.adminNotes ?? "";
    }, { timeout: 20_000 }).toBe(note);
  });

  test("8 · 9 · the CRM date box opens a calendar, and the saved follow-up shows again on a revisit", async ({ page }) => {
    await signIn(page, staff!, /\/(estimates|crm|quote|$)/);
    await page.goto(`/crm/customers/${accountId}`);
    await expect(page.getByTestId("followup-date-button")).toBeVisible({ timeout: 30_000 });
    // Three weeks out, so it is never "tomorrow" by accident.
    const target = new Date(Date.now() + 21 * 86_400_000).toLocaleDateString("en-CA");
    await pickDay(page, "followup-date", target);
    await expect(page.getByTestId("followup-date-button")).toHaveAttribute("data-value", target);
    await page.getByRole("button", { name: "Set date" }).first().click();
    await expect(page.getByTestId("clear-followup")).toBeVisible({ timeout: 20_000 });
    // Leave and come back: the box shows the SAVED date, not tomorrow.
    await page.goto("/crm/today");
    await page.goto(`/crm/customers/${accountId}`);
    await expect(page.getByTestId("followup-date-button")).toHaveAttribute("data-value", target, { timeout: 30_000 });
    const { data } = await db!.from("accounts").select("followup_due_at").eq("id", accountId).single();
    const saved = new Intl.DateTimeFormat("en-CA", { timeZone: "Australia/Melbourne" }).format(new Date(data!.followup_due_at as string));
    expect(saved).toBe(target);
    // The calendar itself: today is marked, days before the minimum are disabled.
    await page.getByTestId("followup-date-button").click();
    const cal = page.getByTestId("followup-date-calendar");
    await expect(cal).toBeVisible();
    await expect(cal.locator(".dp-day.on")).toHaveAttribute("data-day", target);
    await page.keyboard.press("Escape");
    await expect(cal).toBeHidden();
  });

  test("10 · PC Command lists every open variation under Variations for approval", async ({ page }) => {
    test.skip(!fixture, "needs the contractor login to build the job");
    await signIn(page, staff!, /\/(estimates|crm|quote|$)/);
    await page.goto("/pc");
    const sect = page.getByTestId("variations-for-approval");
    await expect(sect).toBeVisible({ timeout: 30_000 });
    const row = page.getByTestId(`variation-approval-${variationId}`);
    await expect(row).toBeVisible();
    await expect(row).toContainText("Rot / substrate");
    await expect(row).toContainText("Waiting on you — price it");
    await expect(row).toContainText(`Sill rotten ${run}`);
    await expect(page.getByTestId("variations-for-approval-count")).toContainText("waiting on you");
    await expect(page.getByTestId(`variation-approval-open-${variationId}`)).toHaveAttribute("href", `/pc/wo/${fixture!.workOrderId}#variation-${variationId}`);
    // Declined → gone from the list.
    await db!.from("wo_variations").update({ status: "declined" }).eq("id", variationId);
    await page.reload();
    await expect(page.getByTestId(`variation-approval-${variationId}`)).toHaveCount(0);
  });

  test("11 · on a phone, the customer's Chat with us sits above the tab bar", async ({ page }) => {
    test.skip(!customer, missingCreds("CUSTOMER"));
    await page.setViewportSize({ width: 390, height: 844 });
    await signIn(page, customer!, /\/account/);
    await page.goto("/account");
    const launch = page.getByTestId("assistant-widget-launch");
    await expect(launch).toBeVisible({ timeout: 30_000 });
    const tabbar = page.locator(".acct .tabbar");
    await expect(tabbar).toBeVisible();
    const l = (await launch.boundingBox())!;
    const t = (await tabbar.boundingBox())!;
    // The launcher's bottom edge is above the bar's top edge — no overlap.
    expect(l.y + l.height).toBeLessThanOrEqual(t.y + 1);
  });
});
