import { test, expect } from "@playwright/test";
import type { SupabaseClient } from "@supabase/supabase-js";
import { randomBytes } from "node:crypto";
import { credentials, missingCreds, signIn } from "./helpers";
import { serviceClient } from "./fixtures/woLoop";

/**
 * Homepage v2 · session 3 — Settings → Showcase, the staff journey
 * (brief §4.4b AC): create → photograph → price → preview → publish, the
 * public sees it; take rank 1 off the job that holds it through the
 * "replace which job?" dialog; unpublish → the public no longer sees it.
 * Cleanup restores the displaced job's rank and deletes what was made.
 */
const staff = credentials("STAFF");
const db: SupabaseClient | null = serviceClient();
const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;


async function anonSlugs(filter: string): Promise<string[]> {
  const r = await fetch(`${url}/rest/v1/showcase_jobs?select=slug,featured_rank&${filter}`, {
    headers: { apikey: anonKey!, Authorization: `Bearer ${anonKey}` },
  });
  return ((await r.json()) as Array<{ slug: string }>).map((x) => x.slug);
}

test.describe("Settings → Showcase editor", () => {
  test.skip(!staff, missingCreds("STAFF"));
  test.skip(!db || !url || !anonKey, "needs SUPABASE_SERVICE_ROLE_KEY + supabase env");
  test.use({ viewport: { width: 1400, height: 1000 } });

  const run = randomBytes(3).toString("hex");
  const title = `E2E showcase ${run}`;
  let rankOneHolder: { id: string; slug: string } | null = null;
  let createdId: string | null = null;

  test.beforeAll(async () => {
    const probe = await db!.from("showcase_jobs").select("id, slug").eq("featured_rank", 1).maybeSingle();
    if (probe.error) throw new Error("migration 20270101 (showcase_jobs) not applied on this stack");
    rankOneHolder = probe.data ? { id: probe.data.id as string, slug: probe.data.slug as string } : null;
  });

  test.afterAll(async () => {
    if (!db) return;
    if (createdId) await db.from("showcase_jobs").delete().eq("id", createdId);
    await db.from("showcase_jobs").delete().ilike("slug", `e2e-showcase-${run}%`);
    if (rankOneHolder) await db.from("showcase_jobs").update({ featured_rank: 1 }).eq("id", rankOneHolder.id);
  });

  test("create → photo → price → preview → publish → public → replace rank 1 → unpublish", async ({ page }) => {
    await signIn(page, staff!, /\/estimates/);

    // Settings folder → list → new
    await page.goto("/settings#showcase");
    await page.getByTestId("open-showcase").click();
    await expect(page.getByTestId("showcase-list")).toBeVisible();
    await page.getByTestId("showcase-new").click();
    await expect(page.getByRole("heading", { name: "New showcase job" })).toBeVisible();

    // The form, in page order. The photo fixture is a real PNG — a screenshot
    // of the page itself — so the browser can decode and downscale it.
    const PNG = await page.screenshot({ clip: { x: 0, y: 0, width: 640, height: 480 } });
    await page.getByTestId("showcase-hero-upload").setInputFiles({ name: "hero.png", mimeType: "image/png", buffer: PNG });
    await expect(page.getByTestId("showcase-hero-img")).toBeVisible({ timeout: 20_000 });
    await page.getByTestId("showcase-consent").check();
    await page.getByTestId("showcase-title").fill(title);
    await page.getByTestId("showcase-type").selectOption("exterior");
    await page.getByTestId("showcase-property").selectOption("home");
    await page.getByTestId("showcase-suburb").fill("Northcote");
    await page.getByTestId("showcase-slug").fill(`e2e-showcase-${run}`);
    await page.getByTestId("showcase-month").fill("2026-07");
    await page.getByTestId("showcase-days").fill("4");
    await page.getByTestId("showcase-price-low").fill("8400");
    await page.getByTestId("showcase-price-high").fill("9600");
    await page.getByTestId("showcase-scope").fill("Whole exterior, 2 coats");
    await page.getByTestId("showcase-summary").fill("A weatherboard exterior brought back to life over four days.");
    await page.getByTestId("wwd-add").click();
    await page.getByLabel("Area").last().fill("Weatherboards");
    await page.getByLabel("Work").last().fill("Wash, sand, prime, 2 coats");

    // Live preview is the real template, fed the form
    const preview = page.getByTestId("showcase-preview-pane").getByTestId("showcase-preview");
    await expect(preview.getByRole("heading", { level: 1 })).toHaveText(title);
    await expect(preview.getByText("$8,400 – $9,600")).toBeVisible();
    await expect(preview.getByText("Weatherboards")).toBeVisible();

    // Publish blocked until the checklist is clear — the client shows it live
    await page.getByTestId("showcase-published").check();
    await expect(page.getByTestId("showcase-checklist")).toHaveCount(0);

    await page.getByTestId("showcase-save").click();
    await expect(page.getByTestId("showcase-status")).toContainText("Published", { timeout: 20_000 });
    await expect(page).toHaveURL(/\/settings\/showcase\/[0-9a-f-]{36}$/);
    createdId = page.url().split("/").pop()!;

    // The public sees it
    expect(await anonSlugs(`slug=eq.e2e-showcase-${run}`)).toEqual([`e2e-showcase-${run}`]);

    // Featured rank 1 — taken → the dialog names the holder → replace
    await page.getByTestId("showcase-rank").selectOption("1");
    await page.getByTestId("showcase-save").click();
    if (rankOneHolder) {
      await expect(page.getByTestId("rank-dialog")).toBeVisible();
      await page.getByTestId("rank-replace").click();
    }
    await expect(page.getByTestId("showcase-status")).toContainText("Published", { timeout: 20_000 });
    expect(await anonSlugs("featured_rank=eq.1")).toEqual([`e2e-showcase-${run}`]);

    // Slug locked once published
    await expect(page.getByText("locked once published")).toBeVisible();

    // Unpublish → gone from the public
    await page.getByTestId("showcase-published").uncheck();
    await page.getByTestId("showcase-save").click();
    await expect(page.getByTestId("showcase-status")).toContainText("draft", { timeout: 20_000 });
    expect(await anonSlugs(`slug=eq.e2e-showcase-${run}`)).toEqual([]);

    // …but still in the staff list, as a draft, with Edit / Remove
    await page.goto("/settings/showcase");
    const row = page.getByTestId(`showcase-row-e2e-showcase-${run}`);
    await expect(row).toBeVisible();
    await expect(row.getByText("Draft")).toBeVisible();
    await expect(row.getByTestId(`showcase-edit-${createdId}`)).toHaveAttribute("href", `/settings/showcase/${createdId}`);

    // Remove asks first, then the row is gone and the public never sees it (Tom, 5 Sep)
    await row.getByTestId(`showcase-remove-${createdId}`).click();
    await expect(row.getByTestId(`showcase-remove-confirm-${createdId}`)).toContainText("Remove");
    await row.getByTestId(`showcase-remove-yes-${createdId}`).click();
    await expect(page.getByTestId(`showcase-row-e2e-showcase-${run}`)).toHaveCount(0, { timeout: 15_000 });
    const gone = await db!.from("showcase_jobs").select("id").eq("id", createdId);
    expect(gone.data ?? []).toHaveLength(0);
    createdId = null;
  });

  test("publish is refused with the checklist when the photo consent is missing", async ({ page }) => {
    await signIn(page, staff!, /\/estimates/);
    await page.goto("/settings/showcase/new");
    await page.getByTestId("showcase-title").fill(`E2E unready ${run}`);
    await page.getByTestId("showcase-suburb").fill("Preston");
    await page.getByTestId("showcase-slug").fill(`e2e-showcase-${run}-unready`);
    await page.getByTestId("showcase-published").check();
    await expect(page.getByTestId("showcase-checklist")).toContainText("Needs a hero photo");
    await expect(page.getByTestId("showcase-checklist")).toContainText("Photo consent not confirmed");
    await page.getByTestId("showcase-save").click();
    await expect(page.getByTestId("showcase-issues")).toContainText("Needs a price range");
    expect(await anonSlugs(`slug=eq.e2e-showcase-${run}-unready`)).toEqual([]);
  });
});
