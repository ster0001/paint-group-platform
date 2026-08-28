import { test, expect } from "@playwright/test";
import type { SupabaseClient } from "@supabase/supabase-js";
import { credentials, missingCreds, signIn } from "./helpers";
import { rpcAsJson, serviceClient } from "./fixtures/woLoop";

/**
 * A2-02 · Saving settings rows is one transaction, or it is nothing.
 *
 * `EditableTable` used to loop in the BROWSER — insert or update per row, each
 * its own round trip, failures collected per row and reported in red. A failure
 * partway left the rate card half saved: some rows at the new prices, some at
 * the old, no rollback, and every estimate priced afterwards using the mixture.
 *
 * CLAUDE.md: "Multi-step money operations … run in a single Postgres
 * transaction via an RPC — never as sequential client calls." Editing the rate
 * card is a repricing operation.
 *
 * The test that matters is the SECOND one. A happy-path save proves the RPC
 * works; only a deliberate mid-batch failure proves it is atomic, and atomicity
 * is the entire reason the RPC exists.
 */

const staff = credentials("STAFF");
const db: SupabaseClient | null = serviceClient();
const MARK = `A2-02 atomicity ${Math.random().toString(36).slice(2, 8)}`;

test.describe("settings rows save atomically", () => {
  test.skip(!staff || !db, missingCreds("STAFF"));

  test.afterAll(async () => {
    if (db) await db.from("area_names").delete().like("area", "A2-02 atomicity%");
  });

  test("a clean batch inserts every row", async () => {
    const res = await rpcAsJson<{ inserted: number; updated: number }>(
      staff!, "save_settings_rows",
      { p_table: "area_names", p_rows: [
        { area: `${MARK} one`, type: "interior" },
        { area: `${MARK} two`, type: "interior" },
      ] },
    );
    expect(res.inserted, `RPC returned ${JSON.stringify(res)}`).toBe(2);

    const { data } = await db!.from("area_names").select("area").like("area", `${MARK}%`);
    expect(data?.length).toBe(2);
  });

  test("a failure mid-batch saves NOTHING — the half-saved rate card is the bug", async () => {
    const before = await db!.from("area_names").select("id", { count: "exact", head: true })
      .like("area", "A2-02 atomicity%");

    // Row 1 is perfectly good. Row 2 updates an id that does not exist, so the
    // function raises. Under the old browser loop, row 1 would already be
    // written and only row 2 would show red.
    const res = await rpcAsJson<{ message?: string; inserted?: number }>(
      staff!, "save_settings_rows",
      { p_table: "area_names", p_rows: [
        { area: `${MARK} SHOULD NOT EXIST`, type: "interior" },
        { id: "00000000-0000-0000-0000-000000000000", area: "nope", type: "interior" },
      ] },
    );
    expect(JSON.stringify(res)).toMatch(/row_not_found/);

    const after = await db!.from("area_names").select("id", { count: "exact", head: true })
      .like("area", "A2-02 atomicity%");
    expect(after.count, "the good row from a failed batch must NOT be saved").toBe(before.count);

    const { data: orphan } = await db!.from("area_names").select("area").like("area", `${MARK} SHOULD NOT EXIST`);
    expect(orphan?.length ?? 0).toBe(0);
  });

  test("the table name is an allowlist, not a parameter", async () => {
    // The RPC takes a table name from the client. That is only safe because it
    // is compared against a fixed set before being used through format(%I).
    const res = await rpcAsJson<{ message?: string }>(
      staff!, "save_settings_rows",
      { p_table: "estimates", p_rows: [{ status: "accepted" }] },
    );
    expect(JSON.stringify(res)).toMatch(/table_not_allowed/);
  });

  test("a non-staff caller cannot save at all", async () => {
    const contractor = credentials("CONTRACTOR");
    test.skip(!contractor, missingCreds("CONTRACTOR"));
    const res = await rpcAsJson<{ message?: string }>(
      contractor!, "save_settings_rows",
      { p_table: "area_names", p_rows: [{ area: `${MARK} contractor`, type: "interior" }] },
    );
    expect(JSON.stringify(res)).toMatch(/not_staff/);
  });
});

/**
 * The RPC being right is not the same as the SCREEN being right. This drives
 * the real Settings table — the memory note is explicit: never call UI work
 * done without driving the real screen.
 */

/**
 * The RPC being right is not the same as the SCREEN being right. This drives
 * the real Settings table, because the house rule is to never call UI work done
 * without driving the real screen.
 */
test.describe("the Settings table saves through the boundary", () => {
  test.skip(!staff || !db, missingCreds("STAFF"));

  test("adding a row and saving persists it, and says so", async ({ page }) => {
    test.setTimeout(120_000);
    await signIn(page, staff!, /\/estimates|\/quote|\/pc/);
    await page.goto("/settings");

    // The tables live inside collapsible <SettingsFolder> sections. "Areas" is
    // the smallest EditableTable on the page and carries no money, so a stray
    // save here cannot misprice anything.
    const folder = page.getByText("Areas", { exact: true }).first();
    await expect(folder).toBeVisible({ timeout: 30_000 });
    await folder.click();

    const addBtn = page.getByRole("button", { name: "+ Add area" });
    await expect(addBtn).toBeVisible({ timeout: 15_000 });
    await addBtn.click();

    const label = `A2-02 ui ${Math.random().toString(36).slice(2, 7)}`;
    const newInput = page.locator('input[type="text"]').last();
    await expect(newInput).toBeVisible({ timeout: 15_000 });
    await newInput.fill(label);

    const save = page.getByRole("button", { name: /Save changes/ }).last();
    await expect(save).toBeEnabled();
    await save.click();

    // The message is the contract: it must not say "Saved" unless the row is
    // actually there. That is the whole failure mode this batch removes.
    await expect(page.getByText(/Saved \d+ ✓/).first()).toBeVisible({ timeout: 30_000 });

    const { data } = await db!.from("area_names").select("area").eq("area", label);
    expect(data?.length, "the screen said Saved — the row must exist").toBe(1);

    await db!.from("area_names").delete().eq("area", label);
  });
});
