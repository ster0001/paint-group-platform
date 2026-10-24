import { expect } from "@playwright/test";
import { test } from "../helpers";
import { serviceClient } from "../fixtures/woLoop";

/**
 * Tom, 25 Oct 2026: "go live with the estimator wizard when typing an address
 * (just for painthome), not for Paint Group yet". The public switch is per
 * shopfront: `settings.wizard_public` = { enabled (Paint Group), enabledPaintHome }.
 *
 *  1. Paint Group OFF, Paint Home ON → painthome.localhost/estimate is the
 *     wizard; the platform host's /estimate is the holding page. Anonymous.
 *  2. Paint Home switched OFF too → painthome.localhost/estimate holds.
 *  3. A wizard_public row written before the switch existed (no
 *     enabledPaintHome key) reads as Paint Home LIVE.
 * The row is restored to what the run had (global-setup turns Paint Group on).
 */
const db = serviceClient();

test.describe("Paint Home — the wizard is live on its own switch", () => {
  test.skip(!db, "needs SUPABASE_SERVICE_ROLE_KEY");
  let saved: Record<string, unknown> | null = null;
  let phRoot = "";

  const write = async (value: Record<string, unknown>) => {
    const { error } = await db!.from("settings").upsert({ key: "wizard_public", value }, { onConflict: "key" });
    if (error) throw new Error(`wizard_public write failed: ${error.message}`);
  };

  test.beforeAll(async ({ baseURL }) => {
    const u = new URL(baseURL!);
    phRoot = `${u.protocol}//painthome.localhost${u.port ? `:${u.port}` : ""}`;
    const { data, error } = await db!.from("settings").select("value").eq("key", "wizard_public").maybeSingle();
    if (error) throw new Error(`wizard_public read failed: ${error.message}`);
    saved = (data?.value && typeof data.value === "object" ? data.value : null) as Record<string, unknown> | null;
  });
  test.afterAll(async () => {
    if (!db) return;
    await write(saved ?? { enabled: true, enabledPaintHome: true });
  });

  test("1 · Paint Group holding, Paint Home live — the same /estimate, two answers by host", async ({ page, baseURL }) => {
    await write({ ...(saved ?? {}), enabled: false, enabledPaintHome: true, holdingTitle: "Opening soon", holdingBody: "Leave your details." });
    await page.goto(`${phRoot}/estimate`);
    await expect(page.getByTestId("holding-page")).toHaveCount(0);
    await expect(page.locator("body")).not.toContainText("Opening soon");
    await page.goto(`${baseURL}/estimate`);
    await expect(page.getByTestId("holding-page")).toBeVisible();
    await expect(page.getByTestId("holding-page")).toContainText("Opening soon");
  });

  test("2 · Paint Home switched off holds too", async ({ page }) => {
    await write({ ...(saved ?? {}), enabled: false, enabledPaintHome: false, holdingTitle: "Opening soon", holdingBody: "Leave your details." });
    await page.goto(`${phRoot}/estimate`);
    await expect(page.getByTestId("holding-page")).toBeVisible();
  });

  test("3 · a row from before the switch existed reads as Paint Home live", async ({ page }) => {
    await write({ enabled: false, holdingTitle: "Opening soon", holdingBody: "Leave your details." });
    await page.goto(`${phRoot}/estimate`);
    await expect(page.getByTestId("holding-page")).toHaveCount(0);
  });
});
