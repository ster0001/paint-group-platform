import { test, expect } from "@playwright/test";
import { execFileSync } from "node:child_process";
import { resolve } from "node:path";
import type { SupabaseClient } from "@supabase/supabase-js";
import { credentials, missingCreds, signIn } from "./helpers";
import { serviceClient } from "./fixtures/woLoop";

/**
 * Tom, 4 Nov 2026: "add this property into estimates from Paint Scout … the
 * pricing updated based on the new system pricing, and it is editable".
 *
 * The real import script runs against the test project on synthetic pages
 * (e2e/fixtures/paintscout-draft), then a person opens the draft in the
 * builder: the sides and their lines are there, a count can be changed and
 * saved, and the saved price follows the engine — not PaintScout's figure.
 */
const staff = credentials("STAFF");
const db: SupabaseClient | null = serviceClient();
const FIX = resolve(process.cwd(), "e2e/fixtures/paintscout-draft");
const QUOTE_NO = "9001";

async function removeDrafts() {
  const { data } = await db!.from("estimates").select("id").eq("external_ref->>origin", "paintscout-draft").eq("external_ref->>quote_no", QUOTE_NO);
  for (const r of (data ?? []) as Array<{ id: string }>) await db!.from("estimates").delete().eq("id", r.id);
}

test.describe("PaintScout → an editable draft priced by this system", () => {
  test.skip(!staff, missingCreds("STAFF"));
  test.skip(!db, "set SUPABASE_SERVICE_ROLE_KEY to run the import");
  test.beforeAll(removeDrafts);
  test.afterAll(removeDrafts);

  test("the import writes a draft the builder opens, edits and re-prices", async ({ page }) => {
    test.setTimeout(240_000);
    const out = execFileSync("npx", ["tsx", "scripts/import/paintscout-draft.ts", "run",
      "--quote", `${FIX}/quote.txt`, "--wo", `${FIX}/work-order.txt`, "--lead-source", "other"], { encoding: "utf8", env: process.env });
    expect(out).toMatch(/ok: draft estimate/);
    // Twice is once.
    const again = execFileSync("npx", ["tsx", "scripts/import/paintscout-draft.ts", "run",
      "--quote", `${FIX}/quote.txt`, "--wo", `${FIX}/work-order.txt`, "--lead-source", "other"], { encoding: "utf8", env: process.env });
    expect(again).toMatch(/exists: estimate/);

    const { data: est, error } = await db!.from("estimates").select("id, status, source, total_cents, builder_state")
      .eq("external_ref->>origin", "paintscout-draft").eq("external_ref->>quote_no", QUOTE_NO).single();
    if (error) throw new Error(error.message);
    const row = est as { id: string; status: string; source: string; total_cents: number; builder_state: { blocks: Array<{ kind: string; name: string; surfaces?: Array<{ id: number; code: string; count: number; priceOverride: unknown }> }> } };
    expect(row.status).toBe("draft");
    expect(row.source).toBe("manual");
    expect(row.total_cents).toBeGreaterThan(0);
    const front = row.builder_state.blocks.find((b) => b.name === "Front Side")!;
    const windows = front.surfaces!.find((s) => s.code === "Awning / Casement Window" && s.count === 3)!;
    expect(front.surfaces!.every((s) => s.priceOverride == null)).toBe(true);

    await signIn(page, staff!, /\/(home|estimates)/);
    await page.goto(`/quote?id=${row.id}`);
    await page.waitForLoadState("networkidle");
    // Not the imported-and-signed strip: this one is priced here.
    await expect(page.getByTestId("paintscout-strip")).toHaveCount(0);
    await page.getByText("Front Side", { exact: true }).first().click();
    await page.getByTestId(`surface-row-${windows.id}`).click();
    const count = page.getByLabel("Count (items)");
    await count.fill("5");
    await count.blur();
    await page.getByTestId("builder-save").click();
    await expect(page.getByText("Saved ✓")).toBeVisible({ timeout: 30_000 });

    await expect.poll(async () => {
      const { data } = await db!.from("estimates").select("total_cents").eq("id", row.id).single();
      return (data as { total_cents: number }).total_cents;
    }, { timeout: 20_000 }).toBeGreaterThan(row.total_cents);
  });
});
