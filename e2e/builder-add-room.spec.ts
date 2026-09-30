import { test, expect } from "@playwright/test";
import type { SupabaseClient } from "@supabase/supabase-js";
import { randomBytes } from "node:crypto";
import { credentials, missingCreds, signIn } from "./helpers";
import { serviceClient } from "./fixtures/woLoop";

/**
 * Tom, 30 Sep 2026: in the builder, "+ Add area" — a typed room name is added
 * on Enter and OPENS at once; a picked standard name opens at once too. It
 * used to add silently and leave you on the list.
 */
const db: SupabaseClient | null = serviceClient();
const staff = credentials("STAFF");
const run = randomBytes(3).toString("hex");

test.describe("add a room and land in it", () => {
  test.skip(!db || !staff, missingCreds("STAFF"));
  let id = "";
  test.beforeAll(async () => {
    const r = await db!.from("estimates").insert({
      title: `Add room ${run}`, status: "draft", source: "manual", level_of_finish: 3, share_token: `ar${run}${randomBytes(8).toString("hex")}`,
      builder_state: { blocks: [], modSel: { "Level of Finish": "FIN-3" }, materials: {} },
    }).select("id").single();
    if (r.error) throw new Error(r.error.message);
    id = r.data.id;
  });
  test.afterAll(async () => { if (db && id) await db.from("estimates").delete().eq("id", id); });

  test("a typed name on Enter adds the room and opens it", async ({ page }) => {
    await signIn(page, staff!, /\/(home|estimates)/);
    await page.goto(`/quote?id=${id}`);
    await page.getByRole("button", { name: "+ Add area" }).click();
    const box = page.getByTestId("area-picker-input");
    await box.fill(`Sun room ${run}`);
    await box.press("Enter");
    // The picker is gone and the new room is the open folder.
    await expect(page.getByTestId("area-picker-input")).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Done" })).toBeVisible();
    await expect(page.getByPlaceholder("Area name (e.g. Right Side upper)")).toHaveValue(`Sun room ${run}`);
  });

  test("a picked standard name opens the room straight away", async ({ page }) => {
    await signIn(page, staff!, /\/(home|estimates)/);
    await page.goto(`/quote?id=${id}`);
    await page.getByRole("button", { name: "+ Add area" }).click();
    const first = page.locator('[data-testid^="area-picker-"]:not([data-testid="area-picker-input"]):not([data-testid="area-picker-add-typed"])').first();
    const name = (await first.innerText()).trim();
    await first.click();
    await expect(page.getByTestId("area-picker-input")).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Done" })).toBeVisible();
    await expect(page.getByPlaceholder("Area name (e.g. Right Side upper)")).toHaveValue(name);
  });
});
