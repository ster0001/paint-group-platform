import { test, expect } from "@playwright/test";
import { createClient } from "@supabase/supabase-js";
import { MONEY_RANGE, openQuickLook, fillQuickAddress, quickNext } from "./drive";

/**
 * Tom, 15 Sep (late): "Needs work" on the quick look.
 *  - it used to demand photos with nowhere to add them, so "See my guide
 *    range" answered "needs photos" and the customer was stuck;
 *  - now: an optional description and optional photos under the tile, the
 *    estimator-check line there and on the reveal, and the range arrives —
 *    priced with the extra-prep allowance (COND-POOR) and flagged for the
 *    estimator with the note and the photo count.
 */

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

test("needs work: a note and a photo, both optional, and the range still arrives", async ({ page }) => {
  test.setTimeout(240_000);
  await openQuickLook(page);
  await fillQuickAddress(page);
  await quickNext(page);
  await page.getByTestId("ql-kind-house").click();
  await page.getByTestId("ql-bedrooms-2").click();
  await quickNext(page);
  await page.getByTestId("ql-scope-whole").click();
  await quickNext(page);
  await expect(page.locator("[data-quick-step='rooms']")).toBeVisible({ timeout: 30_000 });
  await quickNext(page);
  await expect(page.locator("[data-quick-step='condition']")).toBeVisible();

  // Nothing under the other bands; the boxes appear with "Needs work".
  await expect(page.getByTestId("ql-needs-work")).toHaveCount(0);
  await page.getByTestId("ql-condition-needs_work").click();
  await expect(page.getByTestId("ql-needs-work")).toBeVisible();
  await expect(page.getByTestId("ql-prep-check")).toContainText(/checked by our estimator before/i);
  await page.getByTestId("ql-damage-note").fill("peeling above the shower and a cracked wall in the hall");
  await page.getByTestId("com-photo-input").setInputFiles("e2e/fixtures/condition-photo.png");
  await expect(page.getByTestId("ql-damage-photo-count")).toContainText(/1 photo ready/);
  await page.getByTestId("ql-damage-photos-clear").click();
  await expect(page.getByTestId("ql-damage-photo-count")).toHaveCount(0);
  await page.getByTestId("com-photo-input").setInputFiles("e2e/fixtures/condition-photo.png");
  await expect(page.getByTestId("ql-damage-photo-count")).toContainText(/1 photo ready/);

  await quickNext(page);
  await expect(page.getByTestId("reveal-range")).toContainText(MONEY_RANGE, { timeout: 120_000 });
  await expect(page.getByTestId("reveal-prep-check")).toContainText(/checked by our estimator before/i);
  await page.getByTestId("door-tighten").click();
  await expect(page.locator(".sc-rc[data-room]").first()).toBeVisible({ timeout: 90_000 });
  const id = new URL(page.url()).searchParams.get("id")!;

  if (url && serviceKey) {
    const db = createClient(url, serviceKey);
    const { data } = await db.from("estimates").select("builder_state").eq("id", id).single();
    const bs = data!.builder_state as { modSel?: Record<string, string>; aiDeferred?: Array<{ what: string; needs: string; kind?: string; count?: number }> };
    expect(bs.modSel?.Condition).toBe("COND-POOR");
    const review = bs.aiDeferred?.find((d) => d.kind === "photo_review");
    expect(review?.needs).toMatch(/peeling above the shower/);
    expect(review?.count).toBe(1);
    const { data: photos } = await db.from("estimate_sources").select("id, kind").eq("estimate_id", id).eq("kind", "defect_photo");
    expect((photos ?? []).length).toBeGreaterThanOrEqual(1);
  }
});

test("needs work with nothing added still reaches a range, flagged for the estimator", async ({ page }) => {
  test.setTimeout(240_000);
  await openQuickLook(page);
  await fillQuickAddress(page);
  await quickNext(page);
  await quickNext(page);
  await page.getByTestId("ql-scope-whole").click();
  await quickNext(page);
  await expect(page.locator("[data-quick-step='rooms']")).toBeVisible({ timeout: 30_000 });
  await quickNext(page);
  await page.getByTestId("ql-condition-needs_work").click();
  await quickNext(page);
  await expect(page.locator(".wz-err")).toHaveCount(0);
  await expect(page.getByTestId("reveal-range")).toContainText(MONEY_RANGE, { timeout: 120_000 });
  await expect(page.getByTestId("reveal-prep-check")).toBeVisible();
  if (url && serviceKey) {
    await page.getByTestId("door-tighten").click();
    await expect(page.locator(".sc-rc[data-room]").first()).toBeVisible({ timeout: 90_000 });
    const id = new URL(page.url()).searchParams.get("id")!;
    const db = createClient(url, serviceKey);
    const { data } = await db.from("estimates").select("builder_state").eq("id", id).single();
    const bs = data!.builder_state as { modSel?: Record<string, string>; aiDeferred?: Array<{ what: string; needs: string }> };
    expect(bs.modSel?.Condition).toBe("COND-POOR");
    expect(bs.aiDeferred?.some((d) => d.what === "damage to price" && /no photos/.test(d.needs))).toBe(true);
  }
});
