import { test, expect } from "@playwright/test";
import type { SupabaseClient } from "@supabase/supabase-js";
import { randomBytes } from "node:crypto";
import { credentials, missingCreds, signIn } from "./helpers";
import { serviceClient } from "./fixtures/woLoop";

/**
 * Tom's batch of 29 Sep 2026, as staff on the real screens:
 *   1  Payments: views (Final payments outstanding …) + Status / Milestone / Due rows.
 *   2  Estimates opens on All (estimates-home.spec covers the tab itself).
 *   3–5  Contact: Mobile before Company, a Landline, a secondary contact.
 *   6a The leave reminder on unsaved work.
 *   6b Coming out of a folder lands where you were.
 *   7  Search as you type.
 *   8–9 The 4-digit estimate number, left of the address.
 *  11  The chat dock's volume.
 *  13  Materials on a line item.
 * (10 is a webhook — lib/messaging/forwarded.test.ts; 12 is CSS.)
 */
const db: SupabaseClient | null = serviceClient();
const staff = credentials("STAFF");
const run = randomBytes(3).toString("hex");

const surface = (id: number, code: string) => ({
  id, code, coats: 2, count: 0, prepHr: 0, internalLabel: code, clientLabel: code, measureL: null, measureH: null, qtyOverride: null, rateOverride: null,
  paintingHrOverride: null, priceOverride: null, productName: null, color: "", colorHex: "", coverageOverride: null, volumeOverride: null, unitPriceOverride: null,
  crewNote: "", hideQty: false, showCoats: true, showPrice: false, useCustomRate: false, customRate: null, open: false, media: [], hidden: false,
});
const area = (id: number, name: string) => ({
  id, kind: "area", name, type: "Interior", areaType: "room", L: 4, W: 3, H: 2.4, isOption: false, description: "", open: false, media: [],
  surfaces: [surface(id * 10 + 1, "Walls"), surface(id * 10 + 2, "Ceilings"), surface(id * 10 + 3, "Doors")],
});

test.describe("Tom's 29 Sep batch", () => {
  test.skip(!db || !staff, missingCreds("STAFF"));
  let builtId = "";
  let builtNumber: number | null = null;

  test.beforeAll(async () => {
    // A tall estimate (eight rooms + a line item) so the page scrolls.
    const blocks = [...Array.from({ length: 8 }, (_, i) => area(i + 1, `Room ${i + 1}`)),
      { id: 90, kind: "line", name: `Feature line ${run}`, type: "Interior", mode: "custom", hours: 0, rate: 85, qty: 1, unitPrice: 0, custom: 250, cost: 0, woHours: 0, description: "", clientNote: "", crewNote: "", hidden: false, isOption: false, subcontractorExpense: false, media: [], open: false, detailsOpen: false }];
    const est = await db!.from("estimates").insert({
      title: `Batch 29 Sep ${run}`, status: "draft", source: "manual", level_of_finish: 3, share_token: `b29${run}${randomBytes(8).toString("hex")}`,
      builder_state: { blocks, modSel: { "Level of Finish": "FIN-3" }, materials: {}, contact: { first_name: "Trillian", last_name: `Astra${run}`, company: "", email: "", phone: "", address: "", city: "", state: "", postal: "" } },
    }).select("id, number").single();
    if (est.error) throw new Error(est.error.message);
    builtId = est.data.id;
    builtNumber = (est.data as { number?: number | null }).number ?? null;
  });
  test.afterAll(async () => {
    if (db && builtId) await db.from("estimates").delete().eq("id", builtId);
  });

  test("8–9: the estimate carries a 4-digit number, shown left of the address and in the list", async ({ page }) => {
    // The trigger (migration 20270204) numbers every insert, whoever made it.
    expect(builtNumber, "estimates.number set by trigger on insert").not.toBeNull();
    await signIn(page, staff!, /\/(home|estimates)/);
    await page.goto(`/quote?id=${builtId}`);
    const padded = String(builtNumber).padStart(4, "0");
    await expect(page.getByTestId("builder-estimate-number")).toHaveText(`#${padded}`);
    // Left of the address: the number precedes the title in the same row.
    // The builder re-renders once after load; poll until both have a box.
    const badge = page.getByTestId("builder-estimate-number");
    const h1 = page.locator("h1", { hasText: `Batch 29 Sep ${run}` }).first();
    await expect(h1).toBeVisible();
    await expect.poll(async () => {
      const b = await badge.boundingBox();
      const t = await h1.boundingBox();
      return b && t ? b.x < t.x : null;
    }, { timeout: 15_000 }).toBe(true);
    // The list shows it, and the search box finds it by number.
    await page.goto(`/estimates?status=all&q=${padded}`);
    await expect(page.getByTestId(`estimate-number-${builtId}`)).toHaveText(`#${padded}`);
  });

  test("7: the Estimates search runs as you type — no Search button", async ({ page }) => {
    await signIn(page, staff!, /\/(home|estimates)/);
    await page.goto("/estimates?status=all");
    await expect(page.getByTestId("estimates-search-go")).toHaveCount(0);
    await page.getByTestId("estimates-search-input").fill(`astra${run}`);
    await expect(page).toHaveURL(new RegExp(`q=astra${run}`), { timeout: 15_000 });
    await expect(page.locator(`a[href="/quote?id=${builtId}"]`).first()).toBeVisible({ timeout: 30_000 });
  });

  test("3–5: Mobile before Company, a Landline, and a secondary contact that must be a full number", async ({ page }) => {
    await signIn(page, staff!, /\/(home|estimates)/);
    await page.goto(`/quote?id=${builtId}`);
    await page.getByRole("button", { name: "Edit Contact" }).click();
    const phone = await page.getByTestId("contact-phone").boundingBox();
    const company = await page.getByTestId("contact-company").boundingBox();
    expect(phone!.x).toBeLessThan(company!.x); // same row, mobile on the left
    await page.getByTestId("contact-landline").fill("03 9555 12");
    await page.getByRole("button", { name: "Use on estimate" }).click();
    await expect(page.getByText(/landline doesn't look like a full Australian number/)).toBeVisible();
    await page.getByTestId("contact-landline").fill("03 9555 1234");
    await page.getByTestId("contact-secondary-name").fill("Ford Prefect");
    await page.getByTestId("contact-secondary-email").fill("ford@example.com");
    await page.getByTestId("contact-secondary-phone").fill("0400 000 000");
    await page.getByRole("button", { name: "Use on estimate" }).click();
    await expect(page.getByTestId("contact-secondary")).toContainText("Ford Prefect");
    await expect(page.getByTestId("contact-secondary")).toContainText("ford@example.com");
    await expect(page.getByText("03 9555 1234")).toBeVisible();
  });

  test("6a: leaving with unsaved work asks first; Stay keeps you here, Save and continue goes", async ({ page }) => {
    await signIn(page, staff!, /\/(home|estimates)/);
    await page.goto(`/quote?id=${builtId}`);
    await expect(page.getByTestId("builder-save")).toBeVisible();
    // An edit: open the line item and change its heading.
    await page.getByText(`Feature line ${run}`, { exact: true }).first().click();
    await page.getByTestId("line-heading").fill(`Feature line ${run} edited`);
    await page.getByRole("button", { name: "Done" }).click();
    await page.getByTestId("builder-back").click();
    await expect(page.getByTestId("leave-prompt")).toBeVisible();
    await page.getByTestId("leave-stay").click();
    await expect(page.getByTestId("leave-prompt")).toHaveCount(0);
    await expect(page).toHaveURL(new RegExp(`/quote\\?id=${builtId}`));
    await page.getByTestId("builder-back").click();
    await page.getByTestId("leave-save").click();
    await expect(page).toHaveURL(/\/estimates/, { timeout: 30_000 });
    const { data } = await db!.from("estimates").select("builder_state").eq("id", builtId).single();
    const blocks = (data!.builder_state as { blocks: Array<{ kind: string; name: string }> }).blocks;
    expect(blocks.find((b) => b.kind === "line")?.name).toBe(`Feature line ${run} edited`);
  });

  test("6b: Done on an area lands back where you were, not at the top", async ({ page }) => {
    await signIn(page, staff!, /\/(home|estimates)/);
    await page.goto(`/quote?id=${builtId}`);
    const row = page.getByText("Room 8", { exact: true }).first();
    await row.scrollIntoViewIfNeeded();
    const before = await page.evaluate(() => window.scrollY);
    expect(before).toBeGreaterThan(200);
    await row.click();
    await expect(page.getByRole("button", { name: "Done" })).toBeVisible();
    await page.getByRole("button", { name: "Done" }).click();
    await expect(page.getByText("Room 8", { exact: true }).first()).toBeVisible();
    await expect.poll(() => page.evaluate(() => window.scrollY)).toBeGreaterThan(before * 0.6);
  });

  test("13: a line item takes a linked material, and it prices on top of the line", async ({ page }) => {
    await signIn(page, staff!, /\/(home|estimates)/);
    await page.goto(`/quote?id=${builtId}`);
    await page.getByText(new RegExp(`Feature line ${run}`)).first().click();
    await expect(page.getByTestId("line-materials")).toContainText("None linked");
    await page.getByTestId("line-material-add").click();
    const select = page.getByTestId("line-material-product-0");
    const options = select.locator("option");
    expect(await options.count()).toBeGreaterThan(1);
    await select.selectOption({ index: 1 });
    await page.getByTestId("line-material-litres-0").fill("10");
    await page.getByTestId("line-material-litres-0").blur();
    await expect(page.getByTestId("line-materials")).toContainText(/Cost \$/);
    await expect(page.getByTestId("line-materials")).not.toContainText("None linked");
  });

  test("1: Payments has views and three filter rows, and a view is a link", async ({ page }) => {
    await signIn(page, staff!, /\/(home|estimates)/);
    await page.goto("/invoicing");
    await expect(page.getByTestId("payments-views")).toBeVisible({ timeout: 30_000 });
    await expect(page.getByTestId("payments-filters")).toBeVisible();
    await expect(page.getByTestId("payments-kinds")).toBeVisible();
    await expect(page.getByTestId("payments-due")).toBeVisible();
    await page.getByTestId("payments-view-final-outstanding").click();
    await expect(page).toHaveURL(/f=outstanding/);
    await expect(page).toHaveURL(/k=final/);
    await expect(page.getByTestId("payments-filter-outstanding")).toHaveClass(/on/);
    await expect(page.getByTestId("payments-kind-final")).toHaveClass(/on/);
    await expect(page.getByTestId("payments-sum-cents")).toBeVisible();
    // A shared link opens on the same view.
    await page.goto("/invoicing?f=outstanding&k=final");
    await expect(page.getByTestId("payments-view-final-outstanding")).toHaveClass(/on/);
    await page.getByTestId("payments-clear-filters").click();
    await expect(page).toHaveURL(/\/invoicing$/);
  });

  test("11: the chat dock has a volume beside the bell", async ({ page }) => {
    await signIn(page, staff!, /\/(home|estimates)/);
    await page.goto("/estimates");
    const dock = page.getByTestId("staff-dock");
    await expect(dock).toBeVisible({ timeout: 30_000 });
    if (await page.getByTestId("dock-pill").count()) await page.getByTestId("dock-pill").click();
    const vol = page.getByTestId("dock-volume");
    await expect(vol).toBeVisible();
    await vol.fill("80");
    await expect(vol).toHaveValue("80");
    await page.reload();
    if (await page.getByTestId("dock-pill").count()) await page.getByTestId("dock-pill").click();
    await expect(page.getByTestId("dock-volume")).toHaveValue("80");
  });
});
