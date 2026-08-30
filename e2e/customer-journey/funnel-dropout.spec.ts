import { test, expect } from "@playwright/test";
import { createClient } from "@supabase/supabase-js";
import { driveNoPlanWizard } from "./drive";

/**
 * C15 · the drop-out funnel's spine, as an anonymous customer.
 *
 * Three promises, each of which broke at least once before this spec existed:
 *
 *   1. Abandoning mid-wizard leaves a DRAFT — contact captured, progress
 *      recorded, open. (Before C15, a drop-out left nothing at all.)
 *   2. Finishing marks the draft CONVERTED — settled by the SERVER, because a
 *      customer who closes the tab during the processing screen still
 *      finished. (Found live: Tom's own first run stayed "abandoned".)
 *   3. No trailing autosave resurrects a finished run as an open draft.
 *      (Found live: the debounce raced conversion and re-opened at 83%.)
 */

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const missing = !url || !serviceKey;

test.describe("the wizard drop-out funnel", () => {
  test.skip(missing, "Needs the test project's SUPABASE_SERVICE_ROLE_KEY (see .env.test.local)");

  const db = missing ? null : createClient(url!, serviceKey!);
  const stamp = Date.now();
  const dropEmail = `e2e-dropout-${stamp}@example.com`;
  const finishEmail = `e2e-finisher-${stamp}@example.com`;

  test.afterAll(async () => {
    if (!db) return;
    await db.from("wizard_drafts").delete().in("email", [dropEmail, finishEmail]);
  });

  test("abandoning mid-wizard leaves an open draft with the contact on it", async ({ page }) => {
    await page.goto("/estimate");
    await page.getByRole("button", { name: /There isn't a floorplan to hand/ }).click();
    await page.getByPlaceholder("Suburb").fill("Murrumbeena");
    await page.getByPlaceholder("Postcode").fill("3163");
    await page.getByRole("button", { name: /Continue/ }).first().click();

    // The contact sub-step — the earliest moment a drop-out becomes reachable.
    const contact = page.locator(".wz-crow input");
    await expect(contact.first()).toBeVisible();
    await contact.nth(0).fill("Dana Dropout");
    await contact.nth(1).fill(dropEmail);
    await contact.nth(2).fill("0400 222 333");
    await page.getByRole("button", { name: /Continue/ }).first().click();

    // One answer past the contact, then walk away. The autosave debounces at
    // 2.5s, so wait past it before calling the person saved.
    await expect(page.getByRole("heading", { name: /What.s being painted/ })).toBeVisible();
    await page.waitForTimeout(4_000);

    const { data: draft } = await db!.from("wizard_drafts")
      .select("name, email, phone, progress_pct, converted_at")
      .eq("email", dropEmail).maybeSingle();
    expect(draft, "abandoning must leave a draft — it is the funnel's only record").toBeTruthy();
    expect(draft!.name).toBe("Dana Dropout");
    expect(draft!.phone).toContain("0400");
    expect(draft!.converted_at, "an abandoned run is OPEN").toBeNull();
    expect(draft!.progress_pct).toBeGreaterThan(0);
    expect(draft!.progress_pct, "one page in must not read as nearly done").toBeLessThan(50);
  });

  test("finishing converts the draft server-side, and nothing re-opens it", async ({ page }) => {
    // Every autosave verdict, so a silent saved:false has a paper trail.
    const saves: string[] = [];
    page.on("response", async (r) => {
      if (r.url().includes("/api/wizard/draft")) {
        saves.push(`${r.status()} ${await r.text().catch(() => "?")}`);
      }
    });
    // Paced like a person: the autosave debounces 2.5s behind the keyboard,
    // and a spec that outruns it tests a customer who cannot exist.
    await driveNoPlanWizard(page, { email: finishEmail, settleAfterContactMs: 3_500 });

    // The trailing-autosave race fired ~2.5s after the last answer; give it
    // room to lose before asserting the state it used to corrupt.
    await page.waitForTimeout(5_000);

    const { data: drafts } = await db!.from("wizard_drafts")
      .select("progress_pct, converted_at, estimate_id")
      .eq("email", finishEmail);
    expect(drafts!.length,
      `one run, one draft — the race must not mint a second (draft POSTs: ${JSON.stringify(saves)})`,
    ).toBe(1);
    expect(drafts![0].converted_at, "the SERVER converts; the client is a backup").not.toBeNull();
    expect(drafts![0].estimate_id, "a converted draft names the estimate it became").not.toBeNull();
  });
});
