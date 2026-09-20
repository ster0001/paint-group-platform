import { test, expect, type Page } from "@playwright/test";
import { createClient } from "@supabase/supabase-js";
import { MONEY_RANGE, openQuickLook, fillQuickAddress, quickNext } from "./drive";
import { credentials, signIn } from "../helpers";

/**
 * Tom, 15 Sep (evening) — four items:
 *  1. rooms added on the quick look's rooms step arrive in the editor with
 *     their OWN ids (they used to reuse Bed 1's and Bed 2's, so the second
 *     one could never be confirmed — "only able to add 1 room");
 *  2. "much lighter or bold: Yes" asks WHICH groups, and only those price
 *     bold — the walls are no longer assumed;
 *  3. the exclusions sit inline under the preset — no popup;
 *  4. the Estimates page has a search box by customer name or address.
 */

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

async function toJob(page: Page) {
  await openQuickLook(page);
  await fillQuickAddress(page);
  await quickNext(page);
  await page.getByTestId("ql-kind-house").click();
  await page.getByTestId("ql-bedrooms-2").click();
  await quickNext(page);
  await expect(page.locator("[data-quick-step='job']")).toBeVisible();
}

const toEditor = async (page: Page) => {
  await expect(page.getByTestId("reveal-range")).toContainText(MONEY_RANGE, { timeout: 90_000 });
  await page.getByTestId("door-tighten").click();
  await expect(page.locator(".sc-rc[data-room]").first()).toBeVisible({ timeout: 90_000 });
  await expect(page.locator("[data-ready='1']")).toBeAttached({ timeout: 30_000 });
  return new URL(page.url()).searchParams.get("id")!;
};

test("3 · the exclusions are inline under the preset, and 2 · bold asks which groups", async ({ page }) => {
  test.setTimeout(240_000);
  await toJob(page);
  await page.getByTestId("ql-scope-whole").click();
  // Inline, not a dialog; a tile says "the lot".
  await expect(page.getByTestId("ql-excl")).toBeVisible();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(page.getByTestId("ql-excl-done")).toHaveCount(0);
  await expect(page.getByTestId("ql-excl-none")).toHaveAttribute("aria-pressed", "true");
  await page.getByTestId("ql-excl-windows").click();
  await expect(page.getByTestId("ql-excl-line")).toContainText(/Not painting: window frames/i);
  await expect(page.getByTestId("ql-excl-none")).toHaveAttribute("aria-pressed", "false");
  await page.getByTestId("ql-excl-none").click();
  await expect(page.getByTestId("ql-excl-line")).toContainText(/Painting everything/i);

  // Bold: nothing asked before; now "Which ones?" over the painted groups.
  await expect(page.getByTestId("ql-bold-which")).toHaveCount(0);
  await page.getByTestId("ql-bold-yes").click();
  await expect(page.getByTestId("ql-bold-which")).toBeVisible();
  for (const k of ["walls", "ceilings", "trims", "windows"]) {
    await expect(page.getByTestId(`ql-bold-which-${k}`)).toHaveAttribute("aria-pressed", "false");
  }
  // Untick the ceilings' colour change → the ceilings leave the bold list.
  await page.getByTestId("ql-changing-ceilings").click();
  await expect(page.getByTestId("ql-bold-which-ceilings")).toHaveCount(0);
  // Yes with nothing ticked is refused — nothing is assumed.
  await page.getByTestId("ql-next").click();
  await expect(page.locator(".wz-err")).toContainText(/Which ones/i);
  await page.getByTestId("ql-bold-which-walls").click();
  await quickNext(page);
  await expect(page.locator("[data-quick-step='rooms']")).toBeVisible({ timeout: 30_000 });
  await quickNext(page);
  await page.getByTestId("ql-condition-good").click();
  await quickNext(page);
  await expect(page.getByTestId("reveal-range")).toContainText(MONEY_RANGE, { timeout: 90_000 });
  await expect(page.getByTestId("reveal-restatement")).toContainText(/a much lighter or bolder colour on the walls and new colours on the doors and trims and window frames/i);
  const doLines = page.getByTestId("what-we-do");
  await expect(doLines).toContainText(/Walls\s*3 coats \+ undercoat/);
  await expect(doLines).not.toContainText(/Skirtings, architraves and doors\s*3 coats/);
  const id = await toEditor(page);
  // The editor's card shows the same ticks.
  await expect(page.getByTestId("darklight-walls")).toHaveAttribute("aria-pressed", "true");
  await expect(page.getByTestId("darklight-doors")).toHaveAttribute("aria-pressed", "false");
  if (url && serviceKey) {
    const db = createClient(url, serviceKey);
    const { data } = await db.from("estimates").select("builder_state").eq("id", id).single();
    const cond = (data!.builder_state as { wizard?: { state?: { condition?: { boldGroups?: Record<string, boolean>; darkToLightSurfaces?: string[] } } } }).wizard?.state?.condition;
    expect(cond?.boldGroups).toEqual({ walls: true, ceilings: false, trims: false, windows: false });
    expect(cond?.darkToLightSurfaces).toEqual(["walls"]);
  }
});

test("1 · two bedrooms added on the rooms step arrive as two rooms with their own ids", async ({ page }) => {
  test.setTimeout(240_000);
  await toJob(page);
  await page.getByTestId("ql-scope-whole").click();
  await quickNext(page);
  await expect(page.locator("[data-quick-step='rooms']")).toBeVisible({ timeout: 30_000 });
  for (let i = 0; i < 2; i++) {
    await page.getByTestId("ql-add-room-open").click();
    await page.getByTestId("ql-add-room-type-bedroom").click();
    await page.getByTestId("ql-add-room-go").click();
  }
  await expect(page.getByTestId("ql-room-added-1")).toBeVisible();
  await quickNext(page);
  await page.getByTestId("ql-condition-good").click();
  await quickNext(page);
  const id = await toEditor(page);
  const added = page.locator(".sc-rc[data-room]", { hasText: /^Bedroom/ });
  await expect(added).toHaveCount(2);
  const ids = await page.locator(".sc-rc[data-room]").evaluateAll((els) => els.map((e) => e.getAttribute("data-room")));
  expect(new Set(ids).size).toBe(ids.length);
  // Both can be confirmed — the second used to share Bed 2's id and bounce.
  for (const card of [added.nth(0), added.nth(1)]) {
    await card.locator(".il-hd").click();
    await card.getByRole("button", { name: /Looks right/ }).click();
    for (let c = 0; c < 4 && (await card.locator(".il-cup:not(.ok)").count()); c++) {
      await card.locator(".il-cup:not(.ok)").first().getByRole("button", { name: "No", exact: true }).click();
      await page.waitForTimeout(300);
    }
    await card.locator(".il-confirm").click();
    await expect(card).toHaveClass(/done/, { timeout: 20_000 });
  }
  if (url && serviceKey) {
    const db = createClient(url, serviceKey);
    const { data } = await db.from("estimates").select("builder_state").eq("id", id).single();
    const blocks = ((data!.builder_state as { blocks?: Array<{ id: number; name?: string; surfaces?: Array<{ id: number }> }> }).blocks) ?? [];
    const all = blocks.flatMap((b) => [b.id, ...(b.surfaces ?? []).map((s) => s.id)]);
    expect(new Set(all).size).toBe(all.length);
    expect(blocks.filter((b) => /^Bedroom/.test(b.name ?? "")).length).toBe(2);
  }
});

test("4 · the Estimates page searches by customer name or address", async ({ page }) => {
  test.setTimeout(240_000);
  const staff = credentials("STAFF");
  test.skip(!staff || !url || !serviceKey, "needs the staff login and the service key");
  // A row with a known name and address, inserted straight in (no customer
  // walk to depend on) and deleted at the end.
  const db = createClient(url!, serviceKey!);
  const run = Date.now().toString(36);
  const { data: ins, error } = await db.from("estimates").insert({
    title: `Probe Lane ${run}`, status: "draft",
    builder_state: { blocks: [], contact: { first_name: "Zaphod", last_name: `Beeble${run}` }, jobAddress: { address: "99 Probe Lane", city: "Northcote" } },
  }).select("id").single();
  expect(error).toBeNull();
  const id = ins!.id as string;
  try {
    await signIn(page, staff!, /\/(estimates|crm|quote|$)/);
    // By the customer's name.
    await page.goto(`/estimates?status=all&q=beeble${run}`);
    await expect(page.getByTestId("estimates-search-input")).toHaveValue(`beeble${run}`);
    const link = page.locator(`a[href="/quote?id=${id}"]`).first();
    await expect(link).toBeVisible({ timeout: 30_000 });
    await expect(page.getByTestId("estimate-customer").first()).toContainText(`Zaphod Beeble${run}`);
    // By the address.
    await page.goto("/estimates?status=all&q=probe%20lane");
    await expect(page.locator(`a[href="/quote?id=${id}"]`).first()).toBeVisible({ timeout: 30_000 });
    // No match → the empty line, and the row is not there.
    await page.goto("/estimates?status=all&q=zzz-no-such-customer");
    await expect(page.getByTestId("estimates-search-empty")).toBeVisible();
    await expect(page.locator(`a[href="/quote?id=${id}"]`)).toHaveCount(0);
    // The box is on the other tabs too, and Clear takes the needle off.
    await page.goto("/estimates?q=zzz-no-such-customer");
    await expect(page.getByTestId("estimates-search-empty")).toBeVisible();
    // Clear is inert until React attaches, and an inert click reports as a URL
    // that never changed rather than as a missing button — which is how this
    // read as a product bug on CI (slower runner) while passing locally.
    await expect(page.getByTestId("estimates-search")).toHaveAttribute("data-ready", "1");
    await page.getByTestId("estimates-search-clear").click();
    // The URL changes when the App Router COMMITS the navigation — after the
    // Waiting tab has rendered, which is ~4 s on a dev server against the test
    // project (64k estimates) and longer on CI's runner. CI #693 attempt 2
    // (20 Sep) failed here twice with the click landing and the URL simply
    // not there within 10 s. Same allowance as the visibility waits above.
    await expect(page).toHaveURL(/\/estimates$/, { timeout: 30_000 });
  } finally {
    await db.from("estimates").delete().eq("id", id);
  }
});
