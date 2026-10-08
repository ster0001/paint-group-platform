import { test, expect, type Page } from "@playwright/test";
import type { SupabaseClient } from "@supabase/supabase-js";
import { credentials, missingCreds, signIn } from "./helpers";
import { serviceClient } from "./fixtures/woLoop";

/**
 * Tom, 8 Oct 2026: "when choosing paint in the materials section … choose from
 * all materials, not just pigeon-holed to interior or exterior", and a search
 * bar both in the Materials box at the top of the estimate and inside the
 * substrate. An interior wall must be able to take an exterior product, and
 * typing narrows either list to what matches.
 */
const staff = credentials("STAFF");
const db: SupabaseClient | null = serviceClient();
const run = Date.now().toString(36);

const optionNames = (page: Page, testId: string) =>
  page.getByTestId(testId).locator("option").evaluateAll((o) =>
    o.map((x) => x.textContent?.trim() ?? "").filter((t) => t && !t.startsWith("—")));

test.describe("Materials · every paint, searchable", () => {
  test.skip(!staff, missingCreds("STAFF"));
  test.skip(!db, "set SUPABASE_SERVICE_ROLE_KEY to plant the estimate");

  let estimateId = "";
  let exteriorPaint = "";
  let interiorPaint = "";

  test.beforeAll(async () => {
    const { data: prods, error: pErr } = await db!.from("products").select("name, type").in("type", ["Interior", "Exterior"]);
    if (pErr) throw new Error(`products: ${pErr.message}`);
    const list = (prods ?? []) as Array<{ name: string; type: string }>;
    exteriorPaint = list.find((p) => p.type === "Exterior")?.name ?? "";
    interiorPaint = list.find((p) => p.type === "Interior")?.name ?? "";
    if (!exteriorPaint || !interiorPaint) throw new Error("the catalogue needs one Interior and one Exterior product");

    const { data: est, error } = await db!.from("estimates").insert({
      title: `All paints ${run}`, status: "draft", source: "manual", level_of_finish: 3,
      builder_state: {
        blocks: [{
          id: 1, kind: "area", name: "Hall", type: "Interior", areaType: "room", L: 4, W: 2, H: 2.4,
          isOption: false, description: "", open: false, media: [], surfaces: [{
            id: 2, code: "Walls", internalLabel: "Walls", clientLabel: "Walls", coats: 2, count: 1,
            hidden: false, media: [], measureL: null, measureH: null, qtyOverride: null,
            rateOverride: null, paintingHrOverride: null, prepHr: 0, priceOverride: null,
            productName: null, color: "", colorHex: "", coverageOverride: null, volumeOverride: null,
            unitPriceOverride: null, crewNote: "", hideQty: false, showCoats: true, showPrice: false,
            useCustomRate: false, customRate: null, open: false,
          }],
        }],
        modSel: { "Level of Finish": "FIN-3" }, materials: {}, materialColours: {},
        colourMatches: {}, contact: { first_name: "All", last_name: "Paints", email: "", phone: "" },
      },
    }).select("id").single();
    if (error) throw new Error(error.message);
    estimateId = (est as { id: string }).id;
  });
  test.afterAll(async () => { if (estimateId) await db!.from("estimates").delete().eq("id", estimateId); });

  test("the Materials row on an interior wall offers exterior paints too, and its search narrows it", async ({ page }) => {
    test.setTimeout(180_000);
    await signIn(page, staff!, /\/(home|estimates)/);
    await page.goto(`/quote?id=${estimateId}`);
    await page.waitForLoadState("networkidle");
    if ((await page.getByTestId("materials-toggle").getAttribute("aria-expanded")) !== "true") await page.getByTestId("materials-toggle").click();
    const row = "paint-pick-Interior::Walls";
    await expect(page.getByTestId(row)).toBeVisible({ timeout: 30_000 });

    const all = await optionNames(page, row);
    expect(all, "an interior wall lists an exterior paint").toContain(exteriorPaint);
    expect(all).toContain(interiorPaint);

    // Choose the exterior paint on the interior wall: it takes, and stays.
    await page.getByTestId(row).selectOption(exteriorPaint);
    await expect(page.getByTestId(row)).toHaveValue(exteriorPaint);

    // The box at the top narrows the list by what was typed.
    await page.getByTestId("paint-search").fill(interiorPaint);
    const narrowed = await optionNames(page, row);
    expect(narrowed).toContain(interiorPaint);
    expect(narrowed.length).toBeLessThan(all.length);
    expect(narrowed, "the paint already chosen is never filtered away").toContain(exteriorPaint);
  });

  test("the substrate has its own search box over every paint", async ({ page }) => {
    test.setTimeout(180_000);
    await signIn(page, staff!, /\/(home|estimates)/);
    await page.goto(`/quote?id=${estimateId}`);
    await page.waitForLoadState("networkidle");
    await page.getByText("Hall", { exact: true }).first().click();
    await page.getByTestId("surface-row-2").click();

    const pick = "surface-paint-pick";
    const search = page.getByTestId("surface-paint-search");
    await expect(search).toBeVisible({ timeout: 30_000 });
    const all = await optionNames(page, pick);
    expect(all).toContain(exteriorPaint);
    expect(all).toContain(interiorPaint);
    const sorted = [...all].sort((a, b) => a.localeCompare(b, "en-AU", { sensitivity: "base" }));
    expect(all, "A-Z").toEqual(sorted);

    await search.fill(exteriorPaint);
    const narrowed = await optionNames(page, pick);
    expect(narrowed).toContain(exteriorPaint);
    expect(narrowed.length).toBeLessThan(all.length);

    await page.getByTestId(pick).selectOption(exteriorPaint);
    await expect(page.getByTestId(pick)).toHaveValue(exteriorPaint);
    await search.fill("");
    expect(await optionNames(page, pick)).toEqual(all);
  });
});
