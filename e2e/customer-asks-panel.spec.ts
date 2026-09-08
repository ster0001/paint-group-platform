import { test, expect } from "@playwright/test";
import type { SupabaseClient } from "@supabase/supabase-js";
import { randomBytes } from "node:crypto";
import { serviceClient } from "./fixtures/woLoop";

/**
 * Tom, 8 Sep 2026: "when I added in the line item something that wasn't
 * included in the list (security bars) it hasn't mentioned it anywhere in the
 * estimate as an unpriced option for me to pick up. This should be listed as
 * an unpriced option, in a different colour, to be confirmed in the staff view
 * of the estimate builder."
 *
 * `customerCustom` has ridden on the area block since R2b and was read by
 * NOTHING a person could see. This drives the panel that now reads it.
 */

const db: SupabaseClient | null = serviceClient();
const staff = {
  email: process.env.E2E_STAFF_EMAIL ?? "",
  password: process.env.E2E_STAFF_PASSWORD ?? "",
};

test.describe("a customer's own item reaches the staff builder", () => {
  test.skip(!db || !staff.email, "needs SUPABASE_SERVICE_ROLE_KEY + E2E_STAFF_* creds");

  const run = randomBytes(4).toString("hex");
  let estimateId = "";

  test.afterAll(async () => {
    if (db && estimateId) await db.from("estimates").delete().eq("id", estimateId);
  });

  test("it is listed as unpriced, in its own amber panel, and clears when priced", async ({ page }) => {
    test.setTimeout(180_000);
    // An estimate exactly as the online estimate leaves one: a side with the
    // customer's own words on it, and the review-gate entry that goes with it.
    const { data, error } = await db!.from("estimates").insert({
      title: `Customer asks ${run}`,
      status: "draft",
      builder_state: {
        blocks: [{
          id: 1, kind: "area", name: "Exterior - Left", type: "Exterior", areaType: "surface",
          L: 12, W: 0, H: 2.6, isOption: false, description: "", open: false, media: [],
          surfaces: [],
          customerCustom: ["security bars"],
        }],
        aiDeferred: [{
          room: "Exterior - Left", areaId: null, count: 1, kind: "custom_surface",
          what: 'custom surface: "security bars"',
          needs: "price this WITH the customer on the visit — never silently",
        }],
      },
    }).select("id").single();
    expect(error, error?.message).toBeNull();
    estimateId = (data as { id: string }).id;

    await page.goto("/login");
    await page.fill('input[type="email"]', staff.email);
    await page.fill('input[type="password"]', staff.password);
    await page.getByRole("button", { name: /sign in/i }).click();
    await page.waitForURL(/estimates/);

    await page.goto(`/quote?id=${estimateId}`);
    const panel = page.getByTestId("customer-asks-panel");
    await expect(panel).toBeVisible({ timeout: 60_000 });
    await expect(panel).toContainText(/1 unpriced/i);
    await expect(panel).toContainText("security bars");
    await expect(panel).toContainText("Exterior - Left");
    // A different colour, so it cannot be mistaken for a normal section.
    await expect(panel).toHaveClass(/amber/);
    await expect(panel.getByTestId("customer-ask-price")).toBeVisible();

    // Priced or not needed → it goes, and so does its review-gate entry.
    await panel.getByTestId("customer-ask-clear").click();
    await expect(page.getByTestId("customer-asks-panel")).toHaveCount(0, { timeout: 20_000 });
  });
});
