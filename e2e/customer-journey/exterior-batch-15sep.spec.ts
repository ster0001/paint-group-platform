import { test, expect, type Page } from "@playwright/test";
import { createClient } from "@supabase/supabase-js";
import { MONEY_RANGE, quickNext, passGateIfShown, passDetailsSheetIfShown, lookAtEverySide } from "./drive";
import { toSides } from "./exterior-v2-drive";

/**
 * Tom's exterior batch, 15 Sep 2026 — rewritten to the drawn house (Exterior
 * wizard v2, S6). What still holds, now on the new screens:
 *
 *  - a side left not painting (Each side, §7.4) comes OFF the estimate — no
 *    exclusion line, no amber "side excluded", no Right card, no way back
 *    from the editor (ruling (b), 8 Sep);
 *  - (21 Oct, item 8) Tighten opens the customer editor; the walk-around is
 *    retired, so the sides' sizes and the paintwork are asked THERE (the
 *    tighten spec covers them) — the two walk-only tests here are retired;
 *  - the extras card confirms with nothing ticked; "Nothing else" is gone;
 *  - a double storey on an outside-only job is the Access ×1.15 modifier
 *    (ACC-2STOREY), not the per-side hours line, and the work order's access
 *    note starts as "Additional time has been allowed for access" — the shape
 *    says double storey; nobody is asked.
 *
 * Retired, with the ruling (listed in the S6 PR): "condition first on the
 * editor, peeling asks which sides with a photo box" (⚑ 1: asked per side on
 * the walk; the photo box stays on the editor for anyone who changes the
 * answer there); "a typed size mirrors onto the opposite side" (§7.6: each
 * side is asked in turn on the walk, Not sure keeps its own typical — the
 * editor's mirror still works for sizes typed THERE, but the walk answers
 * them first); "the sides are unticked on a Which-sides screen" (§7.4: each
 * side's Not painting).
 */

const FLAG_ON = process.env.NEXT_PUBLIC_EXTERIOR_V2 !== "0"; // on by default since 21 Oct; "0" is the off switch
test.skip(!FLAG_ON, "exteriorV2 is switched off in this environment (NEXT_PUBLIC_EXTERIOR_V2=0)");

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

async function toEditor(page: Page, shape: "wb" | "ds", dropSides: Array<"front" | "left" | "back" | "right"> = []) {
  await toSides(page, shape, ["walls", "fascias"]);
  for (const k of dropSides) { await page.getByTestId(`ql-ext-side-${k}`).click(); await page.getByTestId("ext-side-np").click(); }
  await lookAtEverySide(page);
  await quickNext(page);
  await passGateIfShown(page);
  await expect(page.getByTestId("reveal-range")).toContainText(MONEY_RANGE, { timeout: 90_000 });
  // 21 Oct (item 8): Tighten opens the customer editor; the walk-around step is retired.
  await page.getByTestId("door-tighten").click();
  await passDetailsSheetIfShown(page);
  await expect(page.locator(".sd-card").first()).toBeVisible({ timeout: 90_000 });
  await expect(page.locator("[data-ready='1']")).toBeAttached({ timeout: 30_000 });
  return new URL(page.url()).searchParams.get("id")!;
}


test("a side not painting is off the estimate altogether; the editor's sides open with the which-side question already answered", async ({ page }) => {
  test.setTimeout(300_000);
  const id = await toEditor(page, "wb", ["right"]);

  // No "Which sides?" card, no Right card, no "+ Right side" chip; the loop counts seven.
  await expect(page.getByTestId("sides-which")).toHaveCount(0);
  await expect(page.locator('[data-side="right"]')).toHaveCount(0);
  await expect(page.locator(".sd-prog")).toContainText("OF 7");
  // The front: no "Are we painting this side?" (ticked before the gate); its size is asked here, from the drawn house's typical.
  const front = page.locator('[data-side="front"]');
  await front.locator(".sd-hd").click();
  await expect(front.getByRole("button", { name: "Yes", exact: true })).toHaveCount(0);
  await expect(front.getByTestId("side-assumed-front")).toContainText(/Your guide range used/);
  // No way back for the side left off; a confirmed side still has its ×.
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



test("double storey, outside only: the shape says so — the Access ×1.15 modifier, no working-at-height line, the WO access note seeded", async ({ page }) => {
  test.setTimeout(300_000);
  test.skip(!url || !serviceKey, "needs the service key to read builder_state");
  const id = await toEditor(page, "ds");
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
