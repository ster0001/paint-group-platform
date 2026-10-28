import { test, expect, type Page } from "@playwright/test";
import { toSidesEditor } from "./exterior-v2-drive";

/**
 * R2b — the exterior confirm-loop editor, BY SIDES (rebuild addendum §0;
 * reference: customer-review-confirm-exterior-v2-sides.html, which
 * supersedes the element-grouped exterior layout).
 *
 * Eight loop items — Front / Left / Right / Back / Freestanding extras /
 * Condition & access / windows-doors totals / sweep. Everything starts
 * AMBER; a side turns CYAN only when its required questions are answered
 * and its wall mix adds to 100%; a skipped side reads NOT PAINTING. The CTA
 * is live throughout (Tom, 8 Sep evening) with a line saying how much is left.
 */

/** Tom, 25 Oct 2026: the old upload route is staff-only — the editor is reached from the drawn house's range (Tighten). */
async function driveExteriorWizard(page: Page) {
  await toSidesEditor(page, { email: `e2e-sides-${Date.now()}@example.com` });
}

// "R2b sides loop: amber to cyan, walls must total 100%, a removed side leaves, the loop tracks what
// remains" walked the OLD route's editor — every side arrived undecided ("Are we painting this
// side?") with the questions pre-answered by the page set. Retired 25 Oct 2026 (Tom: the old
// estimator wizard is removed for customers); the drawn house's editor loop is exterior-v2-tighten.spec.ts.

test("5 Oct: weatherboards alone — the side confirms with no % tapped", async ({ page }) => {
  test.setTimeout(300_000);
  await driveExteriorWizard(page);
  const front = page.locator(".sd-card", { hasText: "Front" }).first();
  await front.locator(".sd-hd").click();
  // Tom, 25 Oct 2026: on the drawn house the side arrives IN — no "Yes" to tap.
  await front.getByPlaceholder("length m").fill("12");
  await front.getByPlaceholder("height m").fill("2.6");
  await front.getByPlaceholder("height m").blur(); // Tom, 28 Oct 2026: saves on blur, no Update button
  await expect(page.locator(".sd-saving")).toHaveCount(0, { timeout: 30_000 });
  await expect(front.locator(".sd-wall")).toHaveCount(1);
  await expect(front.locator(".sd-wall .sd-pc.on")).toHaveText("100");
  await expect(front.locator(".sd-wallsum")).toContainText("Adds up to 100%");
  // No share tapped — straight to confirm.
  await front.getByRole("button", { name: /Confirm front/i }).click();
  await expect(front).toHaveClass(/done/, { timeout: 15_000 });
  await expect(page.locator(".sd-prog")).toContainText("1 OF 8");
});

test("priced extras: condition/access, catalogue chips and sweep items move the range", async ({ page }) => {
  test.setTimeout(240_000);
  await driveExteriorWizard(page);

  const rangeMid = async () => {
    // Tom, 14 Sep (item 1): the price row left the strip — the frozen header's range is the one figure.
    const txt = await page.locator("[data-role='range']").first().innerText();
    const [lo, hi] = [...txt.matchAll(/\$([\d,]+)/g)].map((m) => Number(m[1].replace(/,/g, "")));
    return (lo + hi) / 2;
  };
  const settled = async () => expect(page.locator(".sd-saving")).toHaveCount(0, { timeout: 30_000 });

  // Weathered = the ×1.8 condition modifier — the range moves UP, and the
  // toast names the delta. "Good overall" takes it back off.
  // Tom, 15 Sep (late): the questions are paginated — one at a time, with a
  // Back link to change an earlier answer.
  // The old page set answered "Good overall", so the block opens on the rot
  // question; access is asked after it (Tom, 21 Oct, item 11). Answering both
  // settles the block; an earlier answer is changed from its chip on the
  // settled line (the Back link only moves between OPEN questions).
  const cond = page.getByTestId("sides-q");
  // Tom, 25 Oct 2026: from the drawn house nothing is pre-answered — the block opens on the paintwork.
  await cond.getByRole("button", { name: "Good overall", exact: true }).click();
  await expect(cond.getByTestId("sides-q-step-rot")).toBeVisible({ timeout: 30_000 });
  await cond.getByRole("button", { name: /No, looks solid/ }).click();
  await cond.getByRole("button", { name: "None of these ✓", exact: true }).click();
  await expect(cond.getByTestId("sides-q-settled")).toBeVisible({ timeout: 30_000 });
  await settled();
  await cond.getByTestId("sides-q-change-cond").click();
  const beforeWeathered = await rangeMid();
  await cond.getByRole("button", { name: "Weathered", exact: true }).click();
  await expect(page.locator(".sd-toast")).toContainText(/weathered paintwork.*\+\$[\d,]+/i, { timeout: 30_000 });
  await settled();
  const afterWeathered = await rangeMid();
  expect(afterWeathered).toBeGreaterThan(beforeWeathered);
  await cond.getByRole("button", { name: /Good overall/ }).click();
  await settled();
  expect(await rangeMid()).toBeLessThan(afterWeathered);
  await cond.getByTestId("sides-q-done").click();

  // Minor rot and access price as allowance lines, both ways. "A little" opens
  // the where question; "Not sure" answers it.
  const beforeRot = await rangeMid();
  await cond.getByTestId("sides-q-change-rot").click();
  await cond.getByRole("button", { name: "A little", exact: true }).click();
  await settled();
  expect(await rangeMid()).toBeGreaterThan(beforeRot);
  await expect(cond.getByTestId("sides-q-step-rotWhere")).toBeVisible({ timeout: 30_000 });
  await cond.getByTestId("rot-where").getByRole("button", { name: "Not sure", exact: true }).click();
  // The reopened rot question stays on show with Done once its follow-up is answered.
  await cond.getByTestId("sides-q-done").click();
  await expect(cond.getByTestId("sides-q-settled")).toBeVisible({ timeout: 30_000 });
  await cond.getByTestId("sides-q-change-rot").click();
  await cond.getByRole("button", { name: /No, looks solid/ }).click();
  await settled();
  expect(await rangeMid()).toBeLessThanOrEqual(beforeRot);
  await cond.getByTestId("sides-q-done").click();
  await cond.getByTestId("sides-q-change-acc").click();
  await cond.getByRole("button", { name: /Steep block/ }).click();
  await settled();
  expect(await rangeMid()).toBeGreaterThan(beforeRot);
  await cond.getByTestId("sides-q-done").click();

  // The add-panel offers the priced catalogue; adding puts a steppable tile
  // on THIS side and moves the range.
  const front = page.locator(".sd-card", { hasText: "Front" }).first();
  await front.locator(".sd-hd").click();
  // Tom, 25 Oct 2026: on the drawn house the side arrives IN — no "Yes" to tap.
  // Batch 2: out-of-range dims CLAMP and proceed (3–40 × 2–8) — the gentle
  // clamp, never a refusal; the toast names the recorded size.
  await front.getByPlaceholder("length m").fill("50");
  await front.getByPlaceholder("height m").fill("9");
  await front.getByPlaceholder("height m").blur(); // Tom, 28 Oct 2026: saves on blur, no Update button
  await expect(page.locator(".sd-toast")).toContainText(/40 × 8.*3–40/, { timeout: 30_000 });
  await settled();
  await front.getByRole("button", { name: /Add a surface/ }).click();
  const doorChip = front.getByRole("button", { name: /Security door — \$[\d,]+/ });
  await expect(doorChip).toBeVisible();
  const beforeDoor = await rangeMid();
  await doorChip.click();
  await settled();
  expect(await rangeMid()).toBeGreaterThan(beforeDoor);
  await expect(front.locator(".sd-tl", { hasText: "Security door" })).toBeVisible();
  // Added once — the chip leaves the panel; the tile's stepper owns count.
  await front.getByRole("button", { name: /Add a surface/ }).click();
  await expect(front.getByRole("button", { name: /Security door — \$/ })).toHaveCount(0);

  // The sweep: Shed prices on (✓) and off again; Rear fence is gone;
  // Carport stays the amber visit flag.
  // The sweep sits behind the counts tick in the last checks.
  const sweep = page.getByTestId("sides-last");
  await sweep.getByTestId("check-dw-ok").click();
  await expect(sweep.getByTestId("sides-last-step-sweep")).toBeVisible({ timeout: 30_000 });
  await expect(sweep.getByRole("button", { name: /Rear fence/ })).toHaveCount(0);
  const shedChip = sweep.getByRole("button", { name: /Shed — \$[\d,]+/ });
  const beforeShed = await rangeMid();
  await shedChip.click();
  await settled();
  expect(await rangeMid()).toBeGreaterThan(beforeShed);
  await expect(sweep.getByRole("button", { name: /✓ Shed/ })).toBeVisible();
  await sweep.getByRole("button", { name: /✓ Shed/ }).click();
  await settled();
  await expect(sweep.getByRole("button", { name: /\+ Shed/ })).toBeVisible();
  await sweep.getByRole("button", { name: "+ Carport", exact: true }).click();
  await expect(page.locator(".sd-toast")).toContainText(/carport.*site visit/i, { timeout: 30_000 });
  await settled();
  // Tom, 14 Sep (item 1): the tier sentence left the strip; the toast carried the reason above.
  await expect(page.locator(".sd-tier")).toHaveCount(0);
});
