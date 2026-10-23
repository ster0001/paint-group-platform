import { createClient } from "@supabase/supabase-js";
import { expect } from "@playwright/test";
import { credentials, signIn, test } from "./helpers";

/**
 * Tom, 23 Oct 2026: "the search bar crashes and retypes as you are typing in
 * the estimates tab". Each pause used to navigate to a fresh `?q=`, the page
 * gave way to the loading skeleton, and a NEW box came back holding the needle
 * from a moment ago — focus gone, the letters typed meanwhile gone.
 *
 * Typed one letter at a time with a pause longer than the old debounce, the
 * box must keep every letter and its focus, the URL must carry the whole
 * needle, and the planted row must be the one left in the list — with no
 * page request between keystrokes.
 */
const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

test("typing slowly into the Estimates search keeps every letter, the focus and the page", async ({ page }) => {
  test.setTimeout(180_000);
  const staff = credentials("STAFF");
  test.skip(!staff || !url || !serviceKey, "needs the staff login and the service key");
  const db = createClient(url!, serviceKey!);
  const run = Date.now().toString(36);
  const needle = `vogon${run}`;
  const { data: ins, error } = await db.from("estimates").insert({
    title: `Typing Probe ${run}`, status: "draft",
    builder_state: { blocks: [], contact: { first_name: "Prostetnic", last_name: `Vogon${run}` }, jobAddress: { address: "1 Bypass Road", city: "Brunswick" } },
  }).select("id").single();
  expect(error).toBeNull();
  const id = ins!.id as string;
  try {
    await signIn(page, staff!, /\/(home|estimates|crm|quote|$)/);
    await page.goto("/estimates?status=all");
    const box = page.getByTestId("estimates-search-input");
    await expect(page.getByTestId("estimates-search")).toHaveAttribute("data-ready", "1");
    await expect(page.locator(`a[href="/quote?id=${id}"]`).first()).toBeVisible({ timeout: 30_000 });

    // Count page fetches made FOR the needle while typing (a document or RSC
    // request carrying `q=`): the filter must not re-render the page. Link
    // prefetches of the tabs carry no `q`, so they do not count.
    let pageFetches = 0;
    page.on("request", (r) => { if (/[?&]q=/.test(r.url()) && (r.resourceType() === "document" || r.headers()["rsc"] === "1")) pageFetches += 1; });

    await box.click();
    // 450 ms between letters: longer than the old 350 ms pause, so every letter
    // used to fire its own navigation and the box lost what came after it.
    await box.pressSequentially(needle, { delay: 450 });
    await expect(box).toHaveValue(needle);
    await expect(box).toBeFocused();
    await expect(page).toHaveURL(new RegExp(`[?&]q=${needle}`));
    // Still the same box, never remounted into the skeleton.
    await expect(page.getByTestId("estimates-search")).toHaveAttribute("data-ready", "1");
    expect(pageFetches).toBe(0);

    // The list is filtered to the planted row, straight away.
    await expect(page.locator(`a[href="/quote?id=${id}"]`).first()).toBeVisible();
    await expect(page.getByTestId("estimate-customer").first()).toContainText(`Prostetnic Vogon${run}`);
    await expect(page.getByTestId("estimate-customer")).toHaveCount(1);

    // Typing on past a match says so, deleting back brings the row back.
    await box.pressSequentially("zz", { delay: 100 });
    await expect(page.getByTestId("estimates-search-empty")).toBeVisible();
    await box.press("Backspace"); await box.press("Backspace");
    await expect(page.locator(`a[href="/quote?id=${id}"]`).first()).toBeVisible();

    // A deep link still paints filtered on the server, and Clear takes the needle off.
    await page.goto(`/estimates?status=all&q=${needle}`);
    await expect(box).toHaveValue(needle);
    await expect(page.getByTestId("estimate-customer")).toHaveCount(1);
    await expect(page.getByTestId("estimates-search")).toHaveAttribute("data-ready", "1");
    await page.getByTestId("estimates-search-clear").click();
    await expect(page).toHaveURL(/\/estimates\?status=all$/);
    await expect(box).toHaveValue("");
    expect(await page.getByTestId("estimate-customer").count()).toBeGreaterThan(1);
  } finally {
    await db.from("estimates").delete().eq("id", id);
  }
});
