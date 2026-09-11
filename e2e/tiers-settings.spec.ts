import { test, expect } from "@playwright/test";
import type { SupabaseClient } from "@supabase/supabase-js";
import { serviceClient } from "./fixtures/woLoop";

/**
 * C1 (audit 9.2): the two thresholds and the two caps were SQL-only, and a
 * second dead copy of the caps sat in `scope_editor` that three call sites
 * re-applied. This proves the screen writes the two rows the ONE ladder reads.
 * Driven as staff; the rows are put back afterwards so the ladder specs see the
 * numbers they expect.
 *
 * No rewards row: ruling G removed the tier benefits, so the tiers are accuracy
 * labels and nothing else (lib/wizard/ladder.ts).
 */
const db: SupabaseClient | null = serviceClient();
const staff = { email: process.env.E2E_STAFF_EMAIL ?? "", password: process.env.E2E_STAFF_PASSWORD ?? "" };

test.describe("Settings → Estimates → Accuracy tiers & online cap", () => {
  test.skip(!db || !staff.email, "needs SUPABASE_SERVICE_ROLE_KEY + E2E_STAFF_* creds");
  const before: Record<string, unknown> = {};

  test.beforeAll(async () => {
    const { data } = await db!.from("settings").select("key, value").in("key", ["wizard_bands", "wizard_policy"]);
    for (const r of data ?? []) before[r.key as string] = r.value;
  });
  test.afterAll(async () => {
    for (const key of ["wizard_bands", "wizard_policy"]) {
      if (before[key] != null) await db!.from("settings").upsert({ key, value: before[key] }, { onConflict: "key" });
      else await db!.from("settings").delete().eq("key", key);
    }
  });

  test("the Detailed threshold and the interior cap save as the two rows the ladder reads", async ({ page }) => {
    test.setTimeout(120_000);
    await page.goto("/login");
    await page.fill('input[type="email"]', staff.email);
    await page.fill('input[type="password"]', staff.password);
    await page.getByRole("button", { name: /sign in/i }).click();
    await page.waitForURL(/estimates/);
    await page.goto("/settings");
    await page.getByRole("button", { name: /^Estimates$/ }).first().click().catch(() => undefined);
    await page.getByText("Accuracy tiers & online cap").first().click();
    const panel = page.getByTestId("tiers-settings");
    await expect(panel).toBeVisible({ timeout: 20_000 });

    await panel.getByTestId("tier-mid-min").fill("72");
    await panel.getByTestId("cap-interior").fill("6500");
    await panel.getByTestId("tiers-save").click();
    await expect(panel).toContainText(/Saved/, { timeout: 15_000 });

    const { data } = await db!.from("settings").select("key, value").in("key", ["wizard_bands", "wizard_policy"]);
    const row = (k: string) => (data ?? []).find((r) => r.key === k)?.value as Record<string, unknown> | undefined;
    expect(row("wizard_bands")?.midMin).toBe(72);
    expect(row("wizard_policy")?.interiorSelfServeCapCents).toBe(650_000);
    // Ruling G: the screen must not write a rewards row at all.
    expect((data ?? []).some((r) => r.key === "wizard_rewards")).toBe(false);
  });
});
