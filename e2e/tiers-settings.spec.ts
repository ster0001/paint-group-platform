import { test, expect } from "@playwright/test";
import type { SupabaseClient } from "@supabase/supabase-js";
import { serviceClient } from "./fixtures/woLoop";

/**
 * PR 1 of reward-tiers-plan.md: the thresholds, the caps and the rewards
 * have a Settings screen (they were SQL-only). Driven as staff; the rows are
 * put back afterwards so the ladder specs see the numbers they expect.
 */
const db: SupabaseClient | null = serviceClient();
const staff = { email: process.env.E2E_STAFF_EMAIL ?? "", password: process.env.E2E_STAFF_PASSWORD ?? "" };

test.describe("Settings → Estimates → Tiers & rewards", () => {
  test.skip(!db || !staff.email, "needs SUPABASE_SERVICE_ROLE_KEY + E2E_STAFF_* creds");
  let before: Record<string, unknown> = {};

  test.beforeAll(async () => {
    const { data } = await db!.from("settings").select("key, value").in("key", ["wizard_bands", "wizard_policy", "wizard_rewards"]);
    for (const r of data ?? []) before[r.key as string] = r.value;
  });
  test.afterAll(async () => {
    for (const key of ["wizard_bands", "wizard_policy", "wizard_rewards"]) {
      if (before[key] != null) await db!.from("settings").upsert({ key, value: before[key] }, { onConflict: "key" });
      else await db!.from("settings").delete().eq("key", key);
    }
  });

  test("the Silver threshold, the interior cap and a Gold reward line save as three rows", async ({ page }) => {
    test.setTimeout(120_000);
    await page.goto("/login");
    await page.fill('input[type="email"]', staff.email);
    await page.fill('input[type="password"]', staff.password);
    await page.getByRole("button", { name: /sign in/i }).click();
    await page.waitForURL(/estimates/);
    await page.goto("/settings");
    await page.getByRole("button", { name: /^Estimates$/ }).first().click().catch(() => undefined);
    await page.getByText("Tiers & rewards").first().click();
    const panel = page.getByTestId("tiers-settings");
    await expect(panel).toBeVisible({ timeout: 20_000 });

    await panel.getByTestId("tier-mid-min").fill("72");
    await panel.getByTestId("cap-interior").fill("6500");
    await panel.getByTestId("reward-gold-add").click();
    const goldLabels = panel.locator('[data-testid^="reward-gold-label-"]');
    await goldLabels.last().fill("A touch-up kit at hand-over");
    await panel.getByTestId("tiers-save").click();
    await expect(panel).toContainText(/Saved/, { timeout: 15_000 });

    const { data } = await db!.from("settings").select("key, value").in("key", ["wizard_bands", "wizard_policy", "wizard_rewards"]);
    const row = (k: string) => (data ?? []).find((r) => r.key === k)?.value as Record<string, unknown> | undefined;
    expect(row("wizard_bands")?.midMin).toBe(72);
    expect(row("wizard_policy")?.interiorSelfServeCapCents).toBe(650_000);
    const gold = row("wizard_rewards")?.gold as Array<{ label: string }>;
    expect(gold.some((g) => g.label === "A touch-up kit at hand-over")).toBe(true);
    expect(row("wizard_rewards")?.goldSkipVisit).toBe(false);
  });
});
