import { test, expect } from "@playwright/test";
import { credentials, missingCreds, signIn } from "./helpers";
import { driveNoPlanWizard } from "./customer-journey/drive";
import { serviceClient } from "./fixtures/woLoop";

/**
 * C7b — the estimates page is the home of estimating.
 *
 * Tom's check, as the brief wrote it: open Estimates and land on "Waiting on
 * you"; select two rows, the bulk bar appears and Clear works; open a wizard
 * estimate from its Pack link and land on the Pack tab; switch to Scope and
 * it is the editor with green and amber edges; open an in-house estimate and
 * there is no Pack tab at all.
 *
 * The wizard estimate is driven for real (no seeded state), the in-house one
 * is a plain row with blocks and no wizard key — the two shapes the Pack gate
 * has to tell apart.
 */

test.describe("C7b — estimates home", () => {
  const staff = credentials("STAFF");
  const db = serviceClient();
  let inhouseId: string | null = null;

  test.beforeAll(async () => {
    if (!db) return;
    const r = await db.from("estimates").insert({
      title: `C7b in-house ${Date.now()}`, status: "draft", builder_state: { blocks: [] },
    }).select("id").single();
    if (r.error) throw new Error(r.error.message);
    inhouseId = r.data.id as string;
  });
  test.afterAll(async () => {
    if (db && inhouseId) await db.from("estimates").delete().eq("id", inhouseId);
  });

  test("lands on Waiting on you, which is the work queue and nothing else", async ({ page }) => {
    test.skip(!staff, missingCreds("STAFF"));
    await signIn(page, staff!, /estimates/);
    await page.goto("/estimates");
    // The default tab is the first one, and it is the queue's cut: either rows
    // from the evaluator or its own empty line — never a status list.
    await expect(page.getByTestId("estimates-tab-waiting")).toHaveClass(/border-gray-900/);
    const table = page.getByTestId("waiting-table");
    const empty = page.getByTestId("waiting-empty");
    await expect(table.or(empty)).toBeVisible({ timeout: 30_000 });
    if (await table.count()) {
      // Every row carries the evaluator's bucket and its own action.
      const first = table.locator("tbody tr").first();
      await expect(first).toHaveAttribute("data-bucket", /overdue|today|waiting/);
      await expect(first.locator("a")).toHaveCount(1);
    }
  });

  test("a wizard estimate: Pack → lands on the Pack tab; Scope is the editor with edges", async ({ page }) => {
    test.skip(!staff, missingCreds("STAFF"));
    test.setTimeout(300_000);
    await signIn(page, staff!, /estimates/);
    await driveNoPlanWizard(page);
    const wizardId = new URL(page.url()).searchParams.get("id");
    expect(wizardId).toBeTruthy();

    await page.goto("/estimates?status=all&built=customers");
    const row = page.locator(`tr:has([data-testid="pack-link-${wizardId}"])`);
    await expect(row).toBeVisible({ timeout: 30_000 });
    // The pill is derived from records: a fresh, unsent drive has no request
    // and (on the test project) no linked wizard_drafts row, so it reads "—";
    // when a session IS linked it is a wizard state. Either way nothing is stored.
    const pill = row.getByTestId(`estimate-pill-${wizardId}`);
    if (await pill.count()) await expect(pill).toHaveAttribute("data-state", /wizard|abandoned/);
    // The value is a range while it is a range.
    await expect(row.getByTestId(`value-${wizardId}`)).toHaveAttribute("data-kind", "range");
    await expect(row.getByTestId(`value-${wizardId}`)).toContainText("–");

    // The source filter: in-house hides it.
    await page.goto("/estimates?status=all&built=inhouse");
    await expect(page.getByTestId(`pack-link-${wizardId}`)).toHaveCount(0);
    await expect(page.getByTestId("source-inhouse")).toHaveAttribute("aria-pressed", "true");

    // Pack → opens the Pack tab, with the strip above it.
    await page.goto("/estimates?status=draft");
    await page.getByTestId(`pack-link-${wizardId}`).click();
    await page.waitForURL(/tab=pack/);
    await expect(page.getByTestId("estimate-tab-pack")).toHaveClass(/border-gray-900/);
    await expect(page.getByTestId("desk-check")).toBeVisible({ timeout: 60_000 });
    await expect(page.getByTestId("estimate-strip")).toBeVisible();
    await expect(page.getByTestId("strip-figures")).toContainText(/±\d+%/);
    // No request has been sent, so the buttons are not offered — only the figures.
    await expect(page.getByTestId("strip-no-request")).toBeVisible();

    // Scope is the existing editor — same strip, and the edges are the one addition.
    await page.getByTestId("estimate-tab-scope").click();
    await page.waitForURL((u) => !u.searchParams.has("tab"));
    await expect(page.getByTestId("estimate-strip")).toBeVisible({ timeout: 60_000 });
    const edged = page.locator("section[data-provenance]");
    await expect(edged.first()).toBeVisible({ timeout: 60_000 });
    // Nothing was confirmed by the customer, so every edge is amber.
    expect(await edged.locator('[data-provenance="confirmed"]').count()).toBe(0);
    await expect(edged.first()).toHaveAttribute("data-provenance", "assumed");
  });

  test("an in-house estimate: no Pack link, no Pack tab, no strip, no edges", async ({ page }) => {
    test.skip(!staff, missingCreds("STAFF"));
    test.skip(!db || !inhouseId, "needs SUPABASE_SERVICE_ROLE_KEY");
    await signIn(page, staff!, /estimates/);

    await page.goto("/estimates?status=draft&built=inhouse");
    const row = page.locator(`tr:has(a[href="/quote?id=${inhouseId}"])`);
    await expect(row).toBeVisible({ timeout: 30_000 });
    await expect(row.getByTestId(`pack-link-${inhouseId}`)).toHaveCount(0);
    await expect(row.getByTestId(`estimate-pill-${inhouseId}`)).toHaveCount(0); // "—"
    await expect(row.getByTestId(`row-action-${inhouseId}`)).toHaveCount(0);

    // Bulk select still works: tick it, the bar appears, Clear removes it.
    await row.getByRole("checkbox").check();
    await expect(page.locator("[data-bulkbar]")).toContainText("1 selected");
    await page.locator("[data-bulkbar]").getByRole("button", { name: "Clear" }).click();
    await expect(page.locator("[data-bulkbar]")).toHaveCount(0);

    await page.goto(`/quote?id=${inhouseId}`);
    await expect(page.getByTestId("estimate-tabs")).toHaveCount(0);
    await expect(page.getByTestId("estimate-strip")).toHaveCount(0);
    // Asking for the pack tab by URL still lands on Scope.
    await page.goto(`/quote?id=${inhouseId}&tab=pack`);
    await expect(page.getByTestId("estimate-tabs")).toHaveCount(0);
    await expect(page.locator("section[data-provenance]")).toHaveCount(0);
  });
  /**
   * Tom, 15 Sep: tick a row on Waiting on you and remove it from THIS list.
   * The fact is a draft estimate with condition photos awaiting sign-off —
   * the cheapest thing the evaluator turns into a waiting row. Removing it
   * hides it here (and stays hidden across a reload) while CRM Today still
   * shows the same item, because this is a screen tidy, not a dismissal.
   */
  test("Waiting on you: tick + Remove takes a row off this list only — Today keeps it", async ({ page }) => {
    test.skip(!staff, missingCreds("STAFF"));
    test.skip(!db, "needs SUPABASE_SERVICE_ROLE_KEY");
    const title = `Waiting hide ${Date.now()}`;
    const r = await db!.from("estimates").insert({
      title, status: "draft",
      builder_state: { blocks: [], aiDeferred: [{ kind: "photo_review", count: 1 }] },
    }).select("id").single();
    if (r.error) throw new Error(r.error.message);
    const id = r.data.id as string;
    const key = `photo_review:estimate:${id}:photos`;
    try {
      await signIn(page, staff!, /estimates/);
      await page.goto("/estimates");
      const row = page.getByTestId(`waiting-row-${id}`);
      await expect(row).toBeVisible({ timeout: 30_000 });
      await expect(page.getByTestId("waiting-bulk-bar")).toHaveCount(0);

      // Tick → the bar appears with the count; Remove → the row is gone at once.
      await page.getByTestId(`waiting-tick-${id}`).check();
      await expect(page.getByTestId("waiting-bulk-bar")).toContainText("1 selected");
      await page.getByTestId("waiting-remove").click();
      await expect(row).toHaveCount(0);
      await expect(page.getByTestId("waiting-removed-line")).toContainText("1 row removed");

      // Undo brings it back — in the list and in the table.
      await page.getByTestId("waiting-undo").click();
      await expect(page.getByTestId(`waiting-row-${id}`)).toBeVisible();
      await expect(page.getByTestId("waiting-notice")).toHaveCount(0);
      await page.reload();
      await expect(page.getByTestId(`waiting-row-${id}`)).toBeVisible({ timeout: 30_000 });

      // Remove for real, and it survives a reload.
      await page.getByTestId(`waiting-tick-${id}`).check();
      await page.getByTestId("waiting-remove").click();
      await expect(page.getByTestId(`waiting-row-${id}`)).toHaveCount(0);
      await expect(page.getByTestId("waiting-removed-line")).toBeVisible();
      await page.reload();
      await expect(page.getByTestId("waiting-table").or(page.getByTestId("waiting-empty"))).toBeVisible({ timeout: 30_000 });
      await expect(page.getByTestId(`waiting-row-${id}`)).toHaveCount(0);

      // The row is in the hidden table under its own key, by the signed-in staff member...
      const hid = await db!.from("estimates_waiting_hidden").select("item_key, hidden_by").eq("item_key", key).maybeSingle();
      expect(hid.data?.item_key).toBe(key);
      expect(hid.data?.hidden_by).toBeTruthy();
      // ...and NOT in work_item_dismissals: the CRM was not told anything.
      const dis = await db!.from("work_item_dismissals").select("id").eq("item_key", key);
      expect(dis.data ?? []).toHaveLength(0);

      // CRM Today still shows the item — this is the whole ruling. Photo
      // sign-offs sit in the Approvals group; the test project carries
      // hundreds of open items, so walk that group's pages (50 a page).
      let found = false;
      for (let p = 1; p <= 12 && !found; p++) {
        await page.goto(`/crm/today?who=all&f=approvals&page=${p}`);
        await expect(page.getByTestId("who-chips")).toBeVisible({ timeout: 30_000 });
        found = (await page.getByText(title, { exact: false }).count()) > 0;
        if (!found && (await page.locator(`a[href*="page=${p + 1}"]`).count()) === 0) break;
      }
      expect(found, "the removed row must still be on CRM Today").toBe(true);
    } finally {
      await db!.from("estimates_waiting_hidden").delete().eq("item_key", key);
      await db!.from("estimates").delete().eq("id", id);
    }
  });
});
