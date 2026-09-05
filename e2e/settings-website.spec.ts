import { test, expect } from "@playwright/test";
import type { SupabaseClient } from "@supabase/supabase-js";
import { randomBytes } from "node:crypto";
import { credentials, missingCreds, signIn } from "./helpers";
import { serviceClient } from "./fixtures/woLoop";

/**
 * Tom, 5 Sep 2026 — Settings → Company → Website: a painter with a photo,
 * the two variation-card photos and the two story photos, saved from the
 * staff shell, appear on the public homepage; the nav shows logo 1 from
 * Company details. Restores the settings row afterwards.
 */
const staff = credentials("STAFF");
const db: SupabaseClient | null = serviceClient();

test.describe("Settings → Website", () => {
  test.skip(!staff, missingCreds("STAFF"));
  test.skip(!db, "needs SUPABASE_SERVICE_ROLE_KEY to restore the settings row");
  test.use({ viewport: { width: 1280, height: 900 } });

  const run = randomBytes(3).toString("hex");
  let before: unknown = null;
  let logo = "";

  test.beforeAll(async () => {
    const { data } = await db!.from("settings").select("value").eq("key", "website_content").maybeSingle();
    before = data?.value ?? null;
    const { data: cp } = await db!.from("settings").select("value").eq("key", "company_profile").maybeSingle();
    logo = ((cp?.value as { logoUrl?: string } | null)?.logoUrl ?? "").trim();
  });
  test.afterAll(async () => {
    if (!db) return;
    if (before) await db.from("settings").upsert({ key: "website_content", value: before }, { onConflict: "key" });
    else await db.from("settings").delete().eq("key", "website_content");
  });

  test("painter + photos saved in Settings show on the homepage; the nav wears logo 1", async ({ page }) => {
    test.setTimeout(120_000);
    await signIn(page, staff!, /\/estimates/);
    await page.goto("/settings#website");
    const png = await page.screenshot({ clip: { x: 0, y: 0, width: 400, height: 300 } });
    const box = page.getByTestId("website-content");
    await expect(box).toBeVisible();

    // remove anything already there, then one painter
    while (await box.getByText("Remove painter").count()) await box.getByText("Remove painter").first().click();
    await box.getByTestId("painter-add").click();
    await box.getByTestId("painter-0-name").fill(`Felipe M. ${run}`);
    await box.getByTestId("painter-0-specialty").fill("Interiors, heritage");
    await box.getByTestId("painter-0-since").fill("2024");
    await box.getByTestId("painter-0-quote").fill("I'd rather spend the extra hour on prep than come back.");
    await box.getByTestId("painter-0-photo").setInputFiles({ name: "felipe.png", mimeType: "image/png", buffer: png });
    await expect(box.getByTestId("website-status")).toContainText("uploaded", { timeout: 20_000 });
    await box.getByTestId("promise-slot-0-upload").setInputFiles({ name: "v1.png", mimeType: "image/png", buffer: png });
    await expect(box.getByTestId("promise-slot-0").locator("img")).toBeVisible({ timeout: 20_000 });
    await box.getByTestId("story-slot-0-upload").setInputFiles({ name: "s1.png", mimeType: "image/png", buffer: png });
    await expect(box.getByTestId("story-slot-0").locator("img")).toBeVisible({ timeout: 20_000 });
    // Tom, 6 Sep: a testimonial video pasted straight in, no showcase job needed.
    await box.getByTestId("testimonial-url").fill("https://youtu.be/dQw4w9WgXcQ");
    await box.getByTestId("testimonial-caption").fill(`Sarah, Malvern East ${run}`);
    await box.getByTestId("testimonial-transcript").fill("They turned up when they said they would.");
    await box.getByTestId("website-save").click();
    await expect(box.getByTestId("website-status")).toContainText("Saved", { timeout: 20_000 });

    // the public homepage (the action revalidated "/")
    await page.context().clearCookies();
    await page.goto("/");
    await page.getByTestId("consent-decline").click({ timeout: 3_000 }).catch(() => {});
    const painters = page.locator("#painters");
    await expect(painters.getByText(`Felipe M. ${run}`)).toBeVisible();
    await expect(painters.getByText("Interiors, heritage · with Paint Group since 2024")).toBeVisible();
    await expect(painters.locator(".pc[data-todo]")).toHaveCount(0); // real painter → no placeholder marker
    await expect(painters.locator(".pc .av-img")).toHaveCount(1);
    await expect(painters.getByText(/rating|★|jobs done/i)).toHaveCount(0);
    await expect(page.locator("#promise .ph .ph-img img")).toHaveCount(1);
    await expect(page.locator("#promise .ph i")).toHaveCount(1); // the second slot still a placeholder box
    // the pasted video: poster + play in Reviews, its caption, no player until pressed
    const vid = page.locator("#reviews [data-testid=featured-video]");
    await expect(vid.getByText(`Sarah, Malvern East ${run}`)).toBeVisible();
    await expect(vid.locator("iframe")).toHaveCount(0);
    await expect(page.locator("#reviews script[type='application/ld+json']")).toHaveCount(1);
    if (logo) await expect(page.locator("nav .brand img")).toHaveAttribute("src", /.+/);
    else await expect(page.locator("nav").getByText("PAINT GROUP")).toBeVisible();
  });
});
