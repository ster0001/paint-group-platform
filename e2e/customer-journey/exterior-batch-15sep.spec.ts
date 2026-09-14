import { test, expect, type Page } from "@playwright/test";
import { createClient } from "@supabase/supabase-js";
import { MONEY_RANGE, openQuickLook, fillQuickAddress, quickNext } from "./drive";

/**
 * Tom's exterior batch, 15 Sep 2026 — Part 2, on the sides editor:
 *
 *  - "Which sides are we painting?" is asked ONCE, up top (the quick look's
 *    way), and a side unticked there comes OFF the estimate — no exclusion
 *    line, no amber "side excluded" flag (ruling (b), assumed).
 *  - a typed size mirrors onto the opposite side — pre-written into its
 *    boxes, still orange until that side is confirmed.
 *  - the extras card confirms with nothing ticked; "Nothing else" is gone.
 *  - a double storey on an outside-only job is the Access ×1.15 modifier
 *    (ACC-2STOREY), not the per-side "Working at height" hours line, and the
 *    work order's access note starts as "Additional time has been allowed
 *    for access".
 */

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

async function toEditor(page: Page, storeys: "single" | "double") {
  await openQuickLook(page);
  await fillQuickAddress(page);
  await page.getByTestId("ql-jobtype-exterior").click();
  await quickNext(page);
  await expect(page.locator("[data-quick-step='place']")).toBeVisible();
  await quickNext(page);
  await expect(page.locator("[data-quick-step='outside']")).toBeVisible();
  await page.getByTestId("ql-ext-el-body").click();
  await page.getByTestId("ql-ext-el-fascias").click();
  await page.getByTestId("ql-ext-mat-weatherboards").click();
  await page.getByTestId("ql-ext-colour-new").click();
  await page.getByTestId("ql-ext-condition-good").click();
  await page.getByTestId(`ql-ext-storeys-${storeys}`).click();
  await quickNext(page);
  await expect(page.getByTestId("reveal-range")).toContainText(MONEY_RANGE, { timeout: 90_000 });
  await page.getByTestId("door-tighten").click();
  await expect(page.locator(".sd-card").first()).toBeVisible({ timeout: 90_000 });
  await expect(page.locator("[data-ready='1']")).toBeAttached({ timeout: 30_000 });
  return new URL(page.url()).searchParams.get("id")!;
}

const settled = (page: Page) => expect(page.locator(".sd-saving")).toHaveCount(0, { timeout: 30_000 });

test("which sides? up top: untick removes the side outright, the rest confirm with no per-side question", async ({ page }) => {
  test.setTimeout(240_000);
  const id = await toEditor(page, "single");

  const which = page.getByTestId("sides-which");
  await expect(which).toBeVisible();
  await expect(which).toContainText(/Which sides are we painting/);
  for (const k of ["front", "left", "right", "back"]) {
    await expect(page.getByTestId(`side-which-${k}`)).toHaveAttribute("aria-pressed", "true");
  }
  await expect(page.locator(".sd-prog")).toContainText("0 OF 8");

  // Untick the right side: its card is gone, the loop counts seven.
  await page.getByTestId("side-which-right").click();
  await expect(page.locator(".sd-card", { hasText: "Right" })).toHaveCount(0, { timeout: 20_000 });
  await expect(page.locator(".sd-prog")).toContainText("OF 7");

  // "These are the sides" answers the question for the three that remain —
  // and the cards open straight onto the size, no "Are we painting this side?".
  await page.getByTestId("side-which-confirm").click();
  await expect(page.getByTestId("sides-which-settled")).toBeVisible({ timeout: 30_000 });
  await expect(page.getByTestId("sides-which-settled")).toContainText(/front, left and back/i);
  await settled(page);
  const front = page.locator(".sd-card", { hasText: "Front" }).first();
  await front.locator(".sd-hd").click();
  await expect(front.getByRole("button", { name: "Yes", exact: true })).toHaveCount(0);
  await expect(front.getByPlaceholder("length m")).toBeVisible();

  // No exclusion flag, no option area, no "side excluded" for the estimator.
  if (url && serviceKey) {
    const db = createClient(url, serviceKey);
    const { data: est } = await db.from("estimates").select("builder_state").eq("id", id).single();
    const bs = est!.builder_state as { blocks?: Array<{ name?: string; isOption?: boolean }>; aiDeferred?: Array<{ what: string }> };
    expect(bs.blocks?.some((b) => /Right/i.test(b.name ?? ""))).toBe(false);
    expect(bs.blocks?.some((b) => b.isOption === true)).toBe(false);
    expect(bs.aiDeferred?.some((d) => d.what === "side excluded")).toBe(false);
  }
});

test("a typed size mirrors onto the opposite side, pre-written and still to confirm; extras confirm empty", async ({ page }) => {
  test.setTimeout(240_000);
  await toEditor(page, "single");
  await page.getByTestId("side-which-confirm").click();
  await expect(page.getByTestId("sides-which-settled")).toBeVisible({ timeout: 30_000 });
  await settled(page);

  const front = page.locator('[data-side="front"]');
  await front.locator(".sd-hd").click();
  await front.getByPlaceholder("length m").fill("13");
  await front.getByPlaceholder("height m").fill("2.7");
  await front.getByTestId("side-dims-front").getByRole("button", { name: "Update", exact: true }).click();
  await settled(page);
  await expect(front.getByTestId("side-assumed-front")).toContainText(/Recorded: 13 m long × 2.7 m high/);

  // The back took the front's numbers — pre-written, orange, and it says so.
  // data-side, not hasText: the side note's help says "comes back", so a
  // text filter for "Back" matches whichever card is open.
  const back = page.locator('[data-side="back"]');
  await expect(back).not.toHaveClass(/done/);
  await back.locator(".sd-hd").click();
  await expect(back.getByTestId("side-assumed-back")).toContainText(/Same as the front — 13 m × 2.7 m/);
  await expect(back.getByPlaceholder("length m")).toHaveValue("13");
  await expect(back.getByPlaceholder("height m")).toHaveValue("2.7");
  await expect(back.getByTestId("side-dims-back")).toHaveAttribute("data-mirrored", "front");
  // The left is not the front's opposite — untouched.
  const left = page.locator('[data-side="left"]');
  await left.locator(".sd-hd").click();
  await expect(left.getByTestId("side-assumed-left")).toContainText(/Your guide range used/);
  await expect(left.getByPlaceholder("length m")).toHaveValue("");
  // Tapping Update on the back with the pre-written numbers records them.
  await back.locator(".sd-hd").click();
  await back.getByTestId("side-dims-back").getByRole("button", { name: "Update", exact: true }).click();
  await settled(page);
  await expect(back.getByTestId("side-assumed-back")).toContainText(/Recorded: 13 m long × 2.7 m high/);

  // Extras: nothing ticked, no "Nothing else" chip, confirms as it is.
  const extras = page.locator(".sd-card", { hasText: "Freestanding extras" });
  await extras.locator(".sd-hd").click();
  await expect(extras.getByRole("button", { name: /Nothing else/ })).toHaveCount(0);
  await extras.getByRole("button", { name: /Confirm extras/i }).click();
  await expect(extras).toHaveClass(/done/, { timeout: 20_000 });
});

test("double storey, outside only: the Access ×1.15 modifier, no working-at-height line, the WO access note seeded", async ({ page }) => {
  test.setTimeout(240_000);
  test.skip(!url || !serviceKey, "needs the service key to read builder_state");
  const id = await toEditor(page, "double");
  const db = createClient(url!, serviceKey!);
  const { data: est } = await db.from("estimates").select("builder_state").eq("id", id).single();
  const bs = est!.builder_state as {
    modSel?: Record<string, string>; accessNote?: string;
    blocks?: Array<{ name?: string; surfaces?: Array<{ code?: string; internalLabel?: string }> }>;
    aiDeferred?: Array<{ what: string }>;
  };
  expect(bs.modSel?.Access).toBe("ACC-2STOREY");
  expect(bs.accessNote).toBe("Additional time has been allowed for access");
  expect(bs.blocks?.some((b) => b.name === "Exterior - Access")).toBe(false);
  expect(bs.blocks?.some((b) => b.surfaces?.some((s) => /Working at height/.test(s.internalLabel ?? "")))).toBe(false);
  expect(bs.aiDeferred?.some((d) => d.what === "double storey")).toBe(false);
  await expect(page.locator(".sd-geo")).toContainText(/DOUBLE STOREY/);
});
