import { expect } from "@playwright/test";
import { serviceClient } from "../fixtures/woLoop";
import { credentials, signIn, test } from "../helpers";

/**
 * A‑C (17 Nov 2026): Campaigns › Automations is where staff see every message
 * a customer gets, in the plan's order with its code and its sends; switching
 * one on there saves it; Settings → Automations keeps the rest and links across.
 * The switch the spec flips is put back.
 */
const db = serviceClient();
const staff = credentials("STAFF");

test.describe("Campaigns › Automations", () => {
  test.skip(!db, "set SUPABASE_SERVICE_ROLE_KEY");
  test.skip(!staff, "set E2E_STAFF_EMAIL / E2E_STAFF_PASSWORD");
  let saved: Record<string, unknown> | null = null;
  let touched = false;

  test.afterAll(async () => {
    if (!db || !touched) return;
    if (saved === null) await db.from("settings").delete().eq("key", "messaging");
    else await db.from("settings").upsert({ key: "messaging", value: saved }, { onConflict: "key" });
  });

  test("the funnel in order, a switch that saves, and Settings linking across", async ({ page }) => {
    test.setTimeout(120_000);
    const { data, error } = await db!.from("settings").select("value").eq("key", "messaging").maybeSingle();
    if (error) throw new Error(error.message);
    saved = (data as { value: Record<string, unknown> } | null)?.value ?? null;
    touched = true;

    await signIn(page, staff!, /\/(home|estimates|dashboard|crm|pc)/);
    await page.goto("/crm/campaigns");
    await page.getByTestId("subnav-automations").click();
    await page.waitForURL(/\/crm\/campaigns\/automations/);
    for (const stage of ["lead", "estimate", "won", "after"]) await expect(page.getByTestId(`funnel-${stage}`)).toBeVisible({ timeout: 30_000 });
    await expect(page.getByTestId("code-lead_range_reminder")).toHaveText("L1");
    await expect(page.getByTestId("code-cold_nurture")).toHaveText("R5");
    await expect(page.getByTestId("stat-estimate_unopened")).toContainText("30 days");
    await expect(page.getByTestId("funnel-note-L8")).toContainText("call card on Today");

    // Switch E2 on here and save; the settings row says so.
    const row = page.getByTestId("automation-estimate_unopened");
    const sw = row.locator("input[role=switch]");
    const wasOn = await sw.isChecked();
    await sw.click();
    await page.getByTestId("automations-save").click();
    await expect(page.getByText("Saved ✓")).toBeVisible({ timeout: 20_000 });
    const after = await db!.from("settings").select("value").eq("key", "messaging").single();
    const enabled = ((after.data as { value: { enabled?: string[] } }).value.enabled ?? []);
    expect(enabled.includes("estimate_unopened")).toBe(!wasOn);

    // Settings keeps the rest, and points here.
    await page.goto("/settings#automations");
    await expect(page.getByTestId("funnel-link")).toBeVisible({ timeout: 30_000 });
    await expect(page.getByTestId("automation-estimate_unopened")).toHaveCount(0);
    await expect(page.getByTestId("automation-contractor_offer")).toBeVisible();
  });
});
