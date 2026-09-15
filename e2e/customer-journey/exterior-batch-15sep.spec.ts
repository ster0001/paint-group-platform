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

async function toEditor(page: Page, storeys: "single" | "double", dropSides: Array<"front" | "left" | "back" | "right"> = []) {
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
  await page.getByTestId(`ql-ext-storeys-${storeys}`).click();
  await quickNext(page);
  // Tom, 15 Sep (late, item 3): "Which sides?" is its own screen before the gate.
  await expect(page.locator("[data-quick-step='sides']")).toBeVisible({ timeout: 20_000 });
  for (const k of dropSides) await page.getByTestId(`ql-ext-side-${k}`).click();
  await quickNext(page);
  await expect(page.getByTestId("reveal-range")).toContainText(MONEY_RANGE, { timeout: 90_000 });
  await page.getByTestId("door-tighten").click();
  await expect(page.locator(".sd-card").first()).toBeVisible({ timeout: 90_000 });
  await expect(page.locator("[data-ready='1']")).toBeAttached({ timeout: 30_000 });
  return new URL(page.url()).searchParams.get("id")!;
}

const settled = (page: Page) => expect(page.locator(".sd-saving")).toHaveCount(0, { timeout: 30_000 });

test("which sides? before the gate: an unticked side is not on the tighten screen at all; the rest open straight onto their size", async ({ page }) => {
  test.setTimeout(240_000);
  // Tom, 15 Sep (late, items 3–4): the sides are asked on their own screen
  // just before the range; the right side is unticked there.
  const id = await toEditor(page, "single", ["right"]);

  // No "Which sides?" card, no Right card, no "+ Right side" chip; the loop counts seven.
  await expect(page.getByTestId("sides-which")).toHaveCount(0);
  await expect(page.locator('[data-side="right"]')).toHaveCount(0);
  await expect(page.locator(".sd-prog")).toContainText("OF 7");

  // The first questions are condition & access, one at a time, above the sides.
  const q = page.getByTestId("sides-q");
  await expect(q).toBeVisible();
  await expect(q.getByTestId("sides-q-step-cond")).toContainText(/holding up overall/);

  // Each side left opens straight onto the size — no "Are we painting this side?".
  const front = page.locator('[data-side="front"]');
  await front.locator(".sd-hd").click();
  await expect(front.getByRole("button", { name: "Yes", exact: true })).toHaveCount(0);
  await expect(front.getByPlaceholder("length m")).toBeVisible();

  // No way back for the unticked side; a confirmed side still has its ×.
  await expect(page.getByRole("button", { name: /Add the right side/ })).toHaveCount(0);
  await expect(page.getByTestId("side-delete-front")).toBeVisible();

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

test("condition first: peeling asks which sides (with a photo box); rot asks where; the counts and the last check confirm with a tick", async ({ page }) => {
  test.setTimeout(240_000);
  await toEditor(page, "single");
  const q = page.getByTestId("sides-q");
  const settledQ = () => expect(page.locator(".sd-saving")).toHaveCount(0, { timeout: 30_000 });

  // Q1 condition → peeling → Q2 which sides, with the photo box.
  await q.getByRole("button", { name: /Peeling & flaking/ }).click();
  await expect(q.getByTestId("sides-q-step-peeling")).toBeVisible({ timeout: 30_000 });
  await expect(q.getByTestId("peeling-photo-label")).toBeVisible();
  await q.getByTestId("peeling-sides").getByRole("button", { name: /\+ Front/ }).click();
  await settledQ();
  // Q3 rot → a little → Q4 where (the ticked substrates: weatherboards, fascias).
  await expect(q.getByTestId("sides-q-step-rot")).toBeVisible({ timeout: 30_000 });
  await expect(q.getByTestId("sides-q-step-rot")).toContainText(/Any timber rot anywhere/);
  await q.getByRole("button", { name: "A little", exact: true }).click();
  await expect(q.getByTestId("sides-q-step-rotWhere")).toBeVisible({ timeout: 30_000 });
  await expect(q.getByTestId("rot-where")).toContainText(/Fascias/i);
  await q.getByTestId("rot-where").getByRole("button", { name: /Fascia/i }).first().click();
  await settledQ();
  // Access was answered on the quick look ("nothing tricky" is the default), so
  // the block settles here and the card behind it confirms itself.
  await expect(q.getByTestId("sides-q-settled")).toBeVisible({ timeout: 30_000 });
  await expect(q.getByTestId("sides-q-settled")).toContainText(/nothing tricky about access/);
  await expect(q.getByTestId("sides-q-settled")).toContainText(/Peeling & flaking \(front\)/);
  await expect(q).toHaveClass(/done/, { timeout: 30_000 });

  // Last checks: a tick confirms the counts; a tick confirms nothing missing, with nothing else ticked.
  const last = page.getByTestId("sides-last");
  await expect(last.getByRole("button", { name: /That.s right/ })).toHaveCount(0);
  await last.getByTestId("check-dw-ok").click();
  await expect(last.getByTestId("sides-last-step-sweep")).toBeVisible({ timeout: 30_000 });
  await expect(last.getByRole("button", { name: /that.s everything/ })).toHaveCount(0);
  await last.getByTestId("check-sweep-ok").click();
  await expect(last.getByTestId("sides-last-settled")).toBeVisible({ timeout: 30_000 });
  await expect(last).toHaveClass(/done/, { timeout: 30_000 });

  // The estimator's amber lines say where.
  if (url && serviceKey) {
    const id = new URL(page.url()).searchParams.get("id")!;
    const db = createClient(url, serviceKey);
    const { data: est } = await db.from("estimates").select("builder_state").eq("id", id).single();
    const bs = est!.builder_state as { aiDeferred?: Array<{ what: string; needs: string }> };
    expect(bs.aiDeferred?.find((d) => d.what === "peeling & flaking paint")?.needs).toMatch(/peeling on the front/);
    expect(bs.aiDeferred?.find((d) => /rot/.test(d.what))?.needs).toMatch(/fascia/i);
  }
});

test("a typed size mirrors onto the opposite side, pre-written and still to confirm; extras confirm empty", async ({ page }) => {
  test.setTimeout(240_000);
  await toEditor(page, "single");
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
