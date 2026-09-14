/**
 * 14 Sep — the guide range is an ENVELOPE: best case to worst case over the
 * questions the quick look did not ask. Answering one can only narrow it —
 * the low end never falls, the high end never rises. (Tom's complaint: one
 * detail answer used to lift the low end $750 because a percentage band
 * narrowed around a midpoint.)
 *
 * Also the job screen (Tom, 14 Sep): every colour tile starts ticked, and
 * the preset decides which tiles exist.
 */
import { test, expect } from "@playwright/test";
import { fillQuickAddress, MONEY_RANGE, openQuickLook, quickNext } from "./drive";

const parseRange = (text: string): [number, number] => {
  const m = text.match(/\$([\d,]+)\s*–\s*\$([\d,]+)/);
  if (!m) throw new Error(`no range in "${text}"`);
  return [Number(m[1].replace(/,/g, "")), Number(m[2].replace(/,/g, ""))];
};

test("the colour tiles follow the job preset and start ticked", async ({ page }) => {
  test.setTimeout(120_000);
  await openQuickLook(page);
  await fillQuickAddress(page);
  await quickNext(page);
  await quickNext(page); // the place, defaults
  await expect(page.locator("[data-quick-step='job']")).toBeVisible({ timeout: 30_000 });
  for (const k of ["walls", "ceilings", "trims"]) await expect(page.getByTestId(`ql-changing-${k}`)).toHaveAttribute("aria-pressed", "true");
  await page.getByTestId("ql-scope-walls_ceilings").click();
  await expect(page.getByTestId("ql-changing-trims")).toHaveCount(0);
  await expect(page.getByTestId("ql-changing-walls")).toHaveAttribute("aria-pressed", "true");
  await page.getByTestId("ql-scope-trims_doors").click();
  await expect(page.getByTestId("ql-changing-walls")).toHaveCount(0);
  await expect(page.getByTestId("ql-changing-ceilings")).toHaveCount(0);
  await expect(page.getByTestId("ql-changing-trims")).toHaveAttribute("aria-pressed", "true");
  await page.getByTestId("ql-scope-whole").click();
  for (const k of ["walls", "ceilings", "trims"]) await expect(page.getByTestId(`ql-changing-${k}`)).toHaveAttribute("aria-pressed", "true");
});

test("answering a detail question narrows the range and never lifts the low end past the old high", async ({ page }) => {
  test.setTimeout(300_000);
  await openQuickLook(page);
  await fillQuickAddress(page);
  await quickNext(page);
  await quickNext(page);
  await quickNext(page);
  await expect(page.locator("[data-quick-step='condition']")).toBeVisible({ timeout: 30_000 });
  await quickNext(page);
  await expect(page.getByTestId("reveal-range")).toContainText(MONEY_RANGE, { timeout: 90_000 });
  const [lo0, hi0] = parseRange((await page.getByTestId("reveal-range").textContent()) ?? "");
  // The reveal says which assumptions still hold the envelope open.
  await page.getByTestId("reveal-assumed-toggle").click();
  await expect(page.locator("[data-testid^='reveal-open-']").first()).toBeVisible();

  await page.getByTestId("door-tighten").click();
  await expect(page).toHaveURL(/\/estimate\/scope\?id=/, { timeout: 60_000 });
  const id = page.url().match(/id=([0-9a-f-]{36})/)![1];
  const post = (body: Record<string, unknown>) => page.evaluate(async ({ id, body }) => {
    const r = await fetch(`/api/estimates/${id}/wizard-edit`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ...body, view: "customer" }) });
    const j = await r.json();
    return { lo: j.rangeLoCents / 100, hi: j.rangeHiCents / 100, open: j.openQuestions as string[] };
  }, { id, body });

  const before = await post({ action: "room_size_ok", areaId: 1 });
  expect(before.lo).toBeGreaterThanOrEqual(lo0 - 50); // same envelope the reveal showed (one room size confirmed since)
  expect(before.hi).toBeLessThanOrEqual(hi0 + 50);
  expect(before.open).toContain("doors");

  // The dear answer: the low end may rise, the high end may not.
  const panel = await post({ action: "set_door_style", style: "panel" });
  expect(panel.open).not.toContain("doors");
  expect(panel.lo).toBeGreaterThanOrEqual(before.lo);
  expect(panel.hi).toBeLessThanOrEqual(before.hi);
  expect(panel.lo).toBeLessThanOrEqual(before.hi);

  // Confirming rooms only ever narrows: the residual is a slope.
  let prev = panel;
  for (const areaId of [5, 9, 13]) {
    const next = await post({ action: "room_size_ok", areaId });
    expect(Number.isFinite(next.lo), `room ${areaId} answered`).toBe(true);
    expect(next.lo).toBeGreaterThanOrEqual(prev.lo);
    expect(next.hi).toBeLessThanOrEqual(prev.hi);
    prev = next;
  }
});
