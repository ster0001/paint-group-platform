import { test, expect } from "@playwright/test";
import { randomBytes } from "node:crypto";
import { serviceClient } from "./fixtures/woLoop";
import { credentials, missingCreds, signIn } from "./helpers";

/**
 * Tom, 3 Sep 2026: "I made a presentation called Residential Exterior…it
 * isn't showing up in the estimate when ticked; make sure future ones do."
 *
 * Two things were wrong. Ticking a presentation never marked the estimate
 * as changed, so nothing saved it and the Estimate tab kept showing the
 * last PUBLISHED copy — without the presentation. And the builder only
 * learned the list of presentations when the page loaded, so one made in
 * Settings a minute earlier was not offered.
 *
 *   an estimate WITH a published snapshot (no presentation) → tick one →
 *   NO Save click → Estimate tab shows it, DB carries it in the snapshot;
 *   a presentation created while the page is open appears in the picker
 *   the next time the tab regains focus.
 */
const db = serviceClient();
const staff = credentials("STAFF");

const block = (presentation_id: string, kind: string, position: number, content: unknown) =>
  ({ presentation_id, kind, position, enabled: true, content });

test.describe("presentation tick → the customer's copy", () => {
  test.skip(!db || !staff, missingCreds("STAFF"));
  const run = randomBytes(3).toString("hex");
  let presId = ""; let laterId = ""; let estimateId = "";

  test.beforeAll(async () => {
    const pres = await db!.from("presentations").insert({ name: `Residential Exterior ${run}`, description: "", is_default: false }).select("id").single();
    if (pres.error) throw new Error(pres.error.message);
    presId = pres.data.id;
    await db!.from("presentation_blocks").insert([
      block(presId, "video", 0, { title: "See what our clients have to say", description: "", videos: [{ url: "https://youtu.be/xGF-NOa4LLg", caption_sub: "Sandringham", poster_path: "", storage_path: "", caption_title: "Residential Exterior Repaint", duration_label: "1.14" }] }),
      block(presId, "review_set", 1, { title: "What exterior clients say", footer_line: "", reviews: [{ body: "Great job", source: "Google", company_name: "Bentleigh East", reviewer_title: "Adi Singer" }] }),
      block(presId, "capability_panel", 2, { title: "A few extra details", cards: [{ icon: "🛡", heading: "$20M public liability", body: "Certificate supplied." }] }),
    ]);
    const est = await db!.from("estimates").insert({
      title: `Presentation tick ${run}`, status: "draft", source: "manual",
      builder_state: { blocks: [], modSel: { "Level of Finish": "FIN-3" }, materials: {} },
    }).select("id").single();
    if (est.error) throw new Error(est.error.message);
    estimateId = est.data.id;
  });
  test.afterAll(async () => {
    if (estimateId) await db!.from("estimates").delete().eq("id", estimateId);
    for (const id of [presId, laterId]) if (id) await db!.from("presentations").delete().eq("id", id);
  });

  test("ticked, it saves itself and shows on the Estimate tab — no Save click", async ({ page }) => {
    test.setTimeout(120_000);
    await signIn(page, staff!, /\/estimates/);
    await page.goto(`/quote?id=${estimateId}`);
    await page.waitForLoadState("networkidle");
    // Publish once WITHOUT a presentation — the real builder writes the real
    // snapshot, which is what the Estimate tab then shows instead of the live build.
    await page.getByRole("button", { name: /^save/i }).first().click();
    await expect(page.getByText("Saved ✓")).toBeVisible({ timeout: 20_000 });

    // Before: the published copy has no presentation.
    await page.getByRole("button", { name: /^ESTIMATE$/i }).click();
    await expect(page.locator(".cv .pres")).toHaveCount(0);
    await page.getByRole("button", { name: /^BUILDER$/i }).click();

    await page.getByTestId("presentation-picker").selectOption(presId);
    // The tick is the instruction to publish: the row updates without Save.
    await expect.poll(async () => {
      const { data } = await db!.from("estimates").select("presentation_id, sent_snapshot").eq("id", estimateId).single();
      const snap = data?.sent_snapshot as { presentation?: { blocks?: unknown[] } } | null;
      return `${data?.presentation_id === presId}:${snap?.presentation?.blocks?.length ?? 0}`;
    }, { timeout: 20_000 }).toBe("true:3");

    await page.getByRole("button", { name: /^ESTIMATE$/i }).click();
    await expect(page.locator(".cv .pres")).toHaveCount(3);
    await expect(page.getByText("See what our clients have to say")).toBeVisible();

    // And it survives a reload — the published copy carries it now.
    await page.reload();
    await page.waitForLoadState("networkidle");
    await page.getByRole("button", { name: /^ESTIMATE$/i }).click();
    await expect(page.locator(".cv .pres")).toHaveCount(3);
  });

  test("a presentation made while the builder is open is offered on the next focus", async ({ page }) => {
    await signIn(page, staff!, /\/estimates/);
    await page.goto(`/quote?id=${estimateId}`);
    await page.waitForLoadState("networkidle");
    const picker = page.getByTestId("presentation-picker");
    await expect(picker.locator(`option[value="${presId}"]`)).toHaveCount(1);

    const later = await db!.from("presentations").insert({ name: `Made later ${run}`, description: "", is_default: false }).select("id").single();
    if (later.error) throw new Error(later.error.message);
    laterId = later.data.id;
    await db!.from("presentation_blocks").insert([block(laterId, "capability_panel", 0, { title: "Later", cards: [{ icon: "", heading: "Later card", body: "x" }] })]);

    await expect(picker.locator(`option[value="${laterId}"]`)).toHaveCount(0);
    // Coming back to the tab (or opening the picker) refreshes the list.
    await page.evaluate(() => window.dispatchEvent(new Event("focus")));
    await expect(picker.locator(`option[value="${laterId}"]`)).toHaveCount(1, { timeout: 10_000 });
    await expect(picker.locator(`option[value="${laterId}"]`)).toHaveText(`Made later ${run}`);
  });
});
