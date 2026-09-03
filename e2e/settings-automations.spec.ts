import { test, expect } from "@playwright/test";
import type { SupabaseClient } from "@supabase/supabase-js";
import { credentials, missingCreds, signIn } from "./helpers";
import { serviceClient } from "./fixtures/woLoop";

/**
 * Tom, 3 Sep 2026 — Settings in buckets + the Automations screen.
 *
 *   six sections with a jump bar · search narrows the folders ·
 *   #automations deep-links into the folder · every registry row renders ·
 *   a switch + a template edit SAVE to the messaging row and come back ·
 *   the variation switch writes wo_loop.variationRelease (merge, not replace).
 */
const staff = credentials("STAFF");
const db: SupabaseClient | null = serviceClient();

let messagingBefore: unknown = null;
let woLoopBefore: Record<string, unknown> | null = null;

test.describe("settings buckets + automations", () => {
  test.skip(!staff, missingCreds("STAFF"));
  test.skip(!db, "set SUPABASE_SERVICE_ROLE_KEY to restore the settings rows");

  test.beforeAll(async () => {
    const { data: m } = await db!.from("settings").select("value").eq("key", "messaging").maybeSingle();
    messagingBefore = m?.value ?? null;
    const { data: w } = await db!.from("settings").select("value").eq("key", "wo_loop").maybeSingle();
    woLoopBefore = (w?.value as Record<string, unknown>) ?? null;
  });

  test.afterAll(async () => {
    if (messagingBefore) await db!.from("settings").upsert({ key: "messaging", value: messagingBefore }, { onConflict: "key" });
    else await db!.from("settings").delete().eq("key", "messaging");
    if (woLoopBefore) await db!.from("settings").upsert({ key: "wo_loop", value: woLoopBefore }, { onConflict: "key" });
  });

  test("six buckets, a jump bar, and search that narrows the folders", async ({ page }) => {
    await signIn(page, staff!, /\/estimates/);
    await page.goto("/settings");

    for (const id of ["company", "communications", "estimates", "pricing", "scope", "money"]) {
      await expect(page.getByTestId(`bucket-${id}`)).toBeVisible();
    }
    // The folder titles the office knows are all still there.
    for (const title of ["Company details", "Automations", "Pricing & job numbers", "Substrates & production rates", "Invoicing", "Room scope rules"]) {
      await expect(page.getByText(title, { exact: true }).first()).toBeVisible();
    }

    await page.getByTestId("settings-search").fill("colour");
    await expect(page.getByTestId("folder-colours")).toBeVisible();
    await expect(page.getByTestId("folder-invoicing")).toHaveCount(0);
    await page.getByTestId("settings-search").fill("");
    await expect(page.getByTestId("folder-invoicing")).toBeVisible();
  });

  test("#automations opens the folder, lists every automation, and saves a switch + wording", async ({ page }) => {
    await signIn(page, staff!, /\/estimates/);
    await page.goto("/settings#automations");

    const auto = page.getByTestId("automations");
    await expect(auto).toBeVisible();
    // Every audience is represented, automatic rows carry a switch, manual
    // ones do not, planned ones say so.
    await expect(page.getByTestId("automation-contractor_offer")).toBeVisible();
    await expect(page.getByTestId("switch-contractor_offer")).toBeVisible();
    await expect(page.getByTestId("automation-estimate_send")).toContainText("You press send");
    await expect(page.getByTestId("automation-estimate_send").locator("input[role=switch]")).toHaveCount(0);
    await expect(page.getByTestId("automation-signoff_nudges")).toContainText("Not sending yet");
    await expect(page.getByTestId("automation-variation_auto_release")).toBeVisible();

    // Switch QA-fail texts off, reword the job-offer text, flip the variation
    // switch to manual, save.
    await page.getByTestId("switch-contractor_qa_fail").uncheck();
    await page.getByTestId("edit-contractor_offer").click();
    await page.getByTestId("tpl-offerSms").fill("E2E offer wording {{wo_ref}} {{link}}");
    const variationSwitch = page.getByTestId("switch-variation_auto_release");
    await variationSwitch.uncheck();
    await page.getByTestId("automations-save").click();
    await expect(page.getByTestId("automations-msg")).toContainText("Saved ✓", { timeout: 20_000 });

    // The database says the same — and wo_loop kept its other keys.
    const { data: m } = await db!.from("settings").select("value").eq("key", "messaging").single();
    const saved = m!.value as { disabled: string[]; offerSms: string };
    expect(saved.disabled).toContain("contractor_qa_fail");
    expect(saved.offerSms).toBe("E2E offer wording {{wo_ref}} {{link}}");
    const { data: w } = await db!.from("settings").select("value").eq("key", "wo_loop").single();
    const loop = w!.value as Record<string, unknown>;
    expect(loop.variationRelease).toBe("pc");
    for (const k of Object.keys(woLoopBefore ?? {})) if (k !== "variationRelease") expect(loop).toHaveProperty(k);

    // Reload: the state comes back from the row, not from memory.
    await page.reload();
    await expect(page.getByTestId("switch-contractor_qa_fail")).not.toBeChecked();
    await expect(page.getByTestId("switch-variation_auto_release")).not.toBeChecked();
    await expect(page.getByTestId("automations-off-count")).toContainText("2 switched off");
  });
});
