import { test, expect } from "@playwright/test";
import { createClient } from "@supabase/supabase-js";
import { driveNoPlanWizard } from "./drive";

/**
 * C15 · the drop-out funnel's spine, as an anonymous customer.
 *
 * Three promises, each of which broke at least once before this spec existed:
 *
 *   1. Abandoning mid-wizard leaves a DRAFT — progress recorded, open.
 *      (Before C15, a drop-out left nothing at all.)
 *   2. Finishing marks the draft CONVERTED — settled by the SERVER, because a
 *      customer who closes the tab during the processing screen still
 *      finished. (Found live: Tom's own first run stayed "abandoned".)
 *   3. No trailing autosave resurrects a finished run as an open draft.
 *      (Found live: the debounce raced conversion and re-opened at 83%.)
 *
 * ⚑ REWRITTEN for estimator journey v2 phase 2, and the change is a real
 * trade rather than test churn. This spec used to key on the EMAIL typed on
 * the contact page, and asserted the funnel captured a name and phone before
 * the price. ⚑1 moved that gate to after the range, so an anonymous customer
 * who leaves before the reveal now leaves **no contact at all** — the funnel
 * keeps its visibility (an open draft, the progress, the suburb, the CRM
 * bucket) and loses its reachability. That is the trade §2.6 describes:
 * "reasonable for retargeting; costly for conversion". The draft is keyed
 * here by the suburb the run typed, which is what identifies an anonymous
 * walk now.
 */
const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const missing = !url || !serviceKey;

test.describe("the wizard drop-out funnel", () => {
  test.skip(missing, "Needs the test project's SUPABASE_SERVICE_ROLE_KEY (see .env.test.local)");

  const db = missing ? null : createClient(url!, serviceKey!);
  const stamp = Date.now();
  // An anonymous quick look has no email to be known by, so the suburb it
  // typed is the handle — the same column the CRM board reads.
  const dropSuburb = `E2E Dropout ${stamp}`;
  const finishSuburb = `E2E Finisher ${stamp}`;

  test.afterAll(async () => {
    if (!db) return;
    await db.from("wizard_drafts").delete().in("suburb", [dropSuburb, finishSuburb]);
  });

  test("abandoning the quick look leaves an open draft — with progress, and no contact", async ({ page }) => {
    await page.goto("/estimate");
    await expect(page.locator("[data-quick-step='start']")).toBeVisible({ timeout: 20_000 });
    await page.getByPlaceholder(/Your address/).fill("14 Acacia Street, Northcote");
    await page.getByPlaceholder("Suburb").fill(dropSuburb);
    await page.getByPlaceholder("Postcode").fill("3163");
    await page.getByTestId("ql-next").click();
    await expect(page.locator("[data-quick-step='place']")).toBeVisible();
    await page.getByTestId("ql-bedrooms-4").click();
    await page.getByTestId("ql-next").click();
    await expect(page.locator("[data-quick-step='job']")).toBeVisible();

    // Walk away here. The autosave debounces at 2.5s, so wait past it before
    // calling anything saved.
    await page.waitForTimeout(4_000);

    const { data: draft } = await db!.from("wizard_drafts")
      .select("name, email, phone, progress_pct, converted_at, state")
      .eq("suburb", dropSuburb).maybeSingle();
    expect(draft, "abandoning must leave a draft — it is the funnel's only record").toBeTruthy();
    expect(draft!.converted_at, "an abandoned run is OPEN").toBeNull();
    expect(draft!.progress_pct).toBeGreaterThan(0);
    // ⚑1's trade, asserted rather than assumed: no contact was asked for, so
    // none was captured. If this ever starts passing with a name in it,
    // something has put a contact field back in front of the price.
    expect(draft!.email ?? "").toBe("");
    expect(draft!.name ?? "").toBe("");
    // The answers they DID give are on the draft, so a resume puts them back.
    const ql = (draft!.state as { quickLook?: { bedrooms?: number } })?.quickLook;
    expect(ql?.bedrooms, "the quick look's answers ride the draft").toBe(4);
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
    await driveNoPlanWizard(page, { suburb: finishSuburb, settleAfterContactMs: 3_500 });

    // The trailing-autosave race fired ~2.5s after the last answer; give it
    // room to lose before asserting the state it used to corrupt.
    await page.waitForTimeout(5_000);

    const { data: drafts } = await db!.from("wizard_drafts")
      .select("progress_pct, converted_at, estimate_id")
      .eq("suburb", finishSuburb);
    expect(drafts!.length,
      `one run, one draft — the race must not mint a second (draft POSTs: ${JSON.stringify(saves)})`,
    ).toBe(1);
    expect(drafts![0].converted_at, "the SERVER converts; the client is a backup").not.toBeNull();
    expect(drafts![0].estimate_id, "a converted draft names the estimate it became").not.toBeNull();
  });
});
