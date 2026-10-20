import { test, expect, type Page } from "@playwright/test";
import { createClient } from "@supabase/supabase-js";
import { MONEY_RANGE, quickNext, passGateIfShown, passDetailsSheetIfShown } from "./drive";
import { toSides } from "./exterior-v2-drive";

/**
 * Tom's exterior batch, 15 Sep 2026 — rewritten to the drawn house (Exterior
 * wizard v2, S6). What still holds, now on the new screens:
 *
 *  - a side left not painting (Each side, §7.4) comes OFF the estimate — no
 *    exclusion line, no amber "side excluded", no Right card, no way back
 *    from the editor (ruling (b), 8 Sep);
 *  - the editor's sides open already answered: the walk's size is recorded,
 *    nothing is re-asked (§7.7);
 *  - the condition is answered per side on the walk (⚑ 1) — the editor's card
 *    opens on the one question the walk never asked (the rot), and the
 *    estimator's amber lines say where;
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

/** The walk: every painted side checked (Looks right, or the given size on the front), the condition as given, then the range. */
async function walkAll(page: Page, opts: { frontDims?: { w: number; h: number }; cond?: Record<string, "good" | "weathered" | "peeling"> } = {}) {
  await page.getByTestId("door-tighten").click();
  await passDetailsSheetIfShown(page);
  await expect(page.getByTestId("ext-walk")).toBeVisible({ timeout: 60_000 });
  for (let i = 0; i < 4; i++) {
    if (await page.getByTestId("ext-walk-done").count()) break;
    const side = (await page.getByTestId("ext-side-name").textContent())?.trim() ?? "";
    const key = /Front/.test(side) ? "front" : /Right/.test(side) ? "right" : /Back/.test(side) ? "back" : "left";
    if (key === "front" && opts.frontDims) {
      await page.getByTestId("ext-size-adj").click();
      // Steppers: across in 0.5 m, high in 0.3 m — walk from the typical to the target.
      const n = async (id: string) => Number(((await page.getByTestId(`${id}-n`).textContent()) ?? "0").replace(/[^\d.]/g, ""));
      while (Math.abs((await n("ext-dim-w")) - opts.frontDims.w) > 0.01) await page.getByTestId((await n("ext-dim-w")) > opts.frontDims.w ? "ext-dim-w-minus" : "ext-dim-w-plus").click();
      while (Math.abs((await n("ext-dim-h")) - opts.frontDims.h) > 0.15) await page.getByTestId((await n("ext-dim-h")) > opts.frontDims.h ? "ext-dim-h-minus" : "ext-dim-h-plus").click();
    } else {
      await page.getByTestId("ext-size-yes").click();
    }
    await page.getByTestId(`ext-cond-${opts.cond?.[key] ?? "good"}`).click();
    await page.getByTestId("ext-check-side").click();
  }
  await expect(page.getByTestId("ext-walk-done")).toBeVisible();
  await page.getByTestId("ext-see-range").click();
  await expect(page.getByTestId("reveal-tier")).toHaveAttribute("data-tier", "detailed", { timeout: 90_000 });
}

async function toEditor(page: Page, shape: "wb" | "ds", dropSides: Array<"front" | "left" | "back" | "right"> = [], walk: Parameters<typeof walkAll>[1] = {}) {
  await toSides(page, shape, ["walls", "fascias"]);
  for (const k of dropSides) { await page.getByTestId(`ql-ext-side-${k}`).click(); await page.getByTestId("ext-side-np").click(); }
  await page.getByTestId("ql-ext-side-front").click();
  for (let i = 0; i < 4 && !(await page.getByTestId("ext-sides-done").count()); i++) await page.getByTestId("ext-confirm-side").click();
  await quickNext(page);
  await passGateIfShown(page);
  await expect(page.getByTestId("reveal-range")).toContainText(MONEY_RANGE, { timeout: 90_000 });
  await walkAll(page, walk);
  await page.getByTestId("door-editor").click();
  await passDetailsSheetIfShown(page);
  await expect(page.locator(".sd-card").first()).toBeVisible({ timeout: 90_000 });
  await expect(page.locator("[data-ready='1']")).toBeAttached({ timeout: 30_000 });
  return new URL(page.url()).searchParams.get("id")!;
}

const settled = (page: Page) => expect(page.locator(".sd-saving")).toHaveCount(0, { timeout: 30_000 });

test("a side not painting is off the estimate altogether; the editor's sides open already answered", async ({ page }) => {
  test.setTimeout(300_000);
  const id = await toEditor(page, "wb", ["right"]);

  // No "Which sides?" card, no Right card, no "+ Right side" chip; the loop counts seven.
  await expect(page.getByTestId("sides-which")).toHaveCount(0);
  await expect(page.locator('[data-side="right"]')).toHaveCount(0);
  await expect(page.locator(".sd-prog")).toContainText("OF 7");
  // The front: no "Are we painting this side?", and its size is already recorded from the walk.
  const front = page.locator('[data-side="front"]');
  await front.locator(".sd-hd").click();
  await expect(front.getByRole("button", { name: "Yes", exact: true })).toHaveCount(0);
  await expect(front.getByTestId("side-assumed-front")).toContainText(/Recorded:/);
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

test("the condition came from the walk: the editor's card opens on the rot; where it is; the last checks confirm with a tick", async ({ page }) => {
  test.setTimeout(300_000);
  await toEditor(page, "wb", [], { cond: { front: "peeling", right: "good", back: "good", left: "good" } });
  const q = page.getByTestId("sides-q");
  const settledQ = () => expect(page.locator(".sd-saving")).toHaveCount(0, { timeout: 30_000 });

  // The paintwork and where it is peeling are answered already (⚑ 1) — the card opens on the rot.
  await expect(q.getByTestId("sides-q-step-cond")).toHaveCount(0);
  await expect(q.getByTestId("sides-q-step-peeling")).toHaveCount(0);
  await expect(q.getByTestId("sides-q-step-rot")).toBeVisible({ timeout: 30_000 });
  await expect(q.getByTestId("sides-q-step-rot")).toContainText(/Any timber rot anywhere/);
  await q.getByRole("button", { name: "A little", exact: true }).click();
  await expect(q.getByTestId("sides-q-step-rotWhere")).toBeVisible({ timeout: 30_000 });
  await expect(q.getByTestId("rot-where")).toContainText(/Fascias/i);
  await q.getByTestId("rot-where").getByRole("button", { name: /Fascia/i }).first().click();
  await settledQ();
  // Access was answered on About it ("nothing tricky" is the default), so the block settles.
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
    const bs = est!.builder_state as { aiDeferred?: Array<{ what: string; needs: string }>; sidesLoop?: { cond?: { cond?: string; peelingSides?: string[] } } };
    expect(bs.aiDeferred?.find((d) => d.what === "peeling & flaking paint")?.needs).toMatch(/peeling on the front/);
    expect(bs.aiDeferred?.find((d) => /rot/.test(d.what))?.needs).toMatch(/fascia/i);
    expect(bs.sidesLoop?.cond?.cond).toBe("peeling");
    expect(bs.sidesLoop?.cond?.peelingSides).toEqual(["front"]);
  }
});

test("a size adjusted on the walk is recorded in the editor; the other sides keep their own typical; extras confirm empty", async ({ page }) => {
  test.setTimeout(300_000);
  await toEditor(page, "wb", [], { frontDims: { w: 13, h: 2.7 } });
  await settled(page);

  const front = page.locator('[data-side="front"]');
  await front.locator(".sd-hd").click();
  await expect(front.getByTestId("side-assumed-front")).toContainText(/Recorded: 13 m long × 2.7 m high/);
  // The back is its own side (Looks right on the walk): recorded at its typical, not the front's numbers.
  const back = page.locator('[data-side="back"]');
  await back.locator(".sd-hd").click();
  await expect(back.getByTestId("side-assumed-back")).toContainText(/Recorded:/);
  await expect(back.getByTestId("side-assumed-back")).not.toContainText(/13 m/);

  // Extras: nothing ticked, no "Nothing else" chip, confirms as it is.
  const extras = page.locator(".sd-card", { hasText: "Freestanding extras" });
  await extras.locator(".sd-hd").click();
  await expect(extras.getByRole("button", { name: /Nothing else/ })).toHaveCount(0);
  await extras.getByRole("button", { name: /Confirm extras/i }).click();
  await expect(extras).toHaveClass(/done/, { timeout: 20_000 });
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
