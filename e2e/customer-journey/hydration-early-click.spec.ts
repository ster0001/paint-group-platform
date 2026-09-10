import { test, expect } from "@playwright/test";

/**
 * Production killer #2 from the 20 Aug audit: a tap in the first moments
 * after load hit a live-looking but unhydrated page and was SILENTLY LOST —
 * the customer's first impression was a dead button.
 *
 * The fix is the wz-waking hydration gate (WizardApp + both editors):
 * pointer events stay off until React hydrates, and data-ready="1" marks
 * the page live. An early tap now WAITS on the gate instead of vanishing —
 * Playwright's actionability check queues on pointer-events:none exactly
 * the way a real finger's second tap lands once the page wakes.
 *
 * This spec clicks within 500ms of navigation, under 6× CPU throttle so
 * hydration reliably lags the tap. WITHOUT the gate the click lands on
 * dead DOM, "Exterior" never selects, and this spec FAILS (verified by
 * stripping the gate wiring and watching it fail).
 */
test("a tap within 500ms of load is never lost — the hydration gate holds it", async ({ page }) => {
  test.setTimeout(120_000);
  const cdp = await page.context().newCDPSession(page);
  await cdp.send("Emulation.setCPUThrottlingRate", { rate: 6 });

  await page.goto("/estimate", { waitUntil: "commit" });

  // The premise, proven not assumed: the page has NOT hydrated when the
  // click begins (data-ready absent) — this IS the early tap that was
  // silently lost before the gate. Under 6× throttle hydration reliably
  // takes longer than these two statements.
  expect(await page.locator("[data-ready='1']").count()).toBe(0);
  // v2 phase 2: the first tap on the screen is the job-type chip ("Outside"),
  // which is the same test — a control that looks live before React has
  // hydrated, tapped at the worst possible moment.
  const outside = page.getByTestId("ql-jobtype-exterior");
  await outside.click({ timeout: 60_000 });

  // The early tap must have COUNTED: Outside is selected, page is live.
  await expect(outside).toHaveClass(/on/, { timeout: 15_000 });
  await expect(page.locator("[data-ready='1']")).toBeAttached();
});
