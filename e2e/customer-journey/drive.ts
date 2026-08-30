import { expect, type Page } from "@playwright/test";

/** A money range like "$5,120 – $5,560". */
export const MONEY_RANGE = /\$[\d,]+\s*–\s*\$[\d,]+/;

export type DriveOptions = {
  /** Page-4 door style to pick; omit to leave it untouched ("unsure"). */
  doorStyle?: "Panel" | "Flat";
  /** Page-4 window style to pick; omit to leave it untouched ("unsure"). */
  windowStyle?: "Casement" | "Sash" | "Colonial" | "Winder";
  /** Page-4 "what gets painted with each door"; omit to leave the default
   * ("Door + frame", which is what every pre-21-Aug estimate means). */
  doorScope?: "Door only" | "Door + frame" | "+ architrave";
  /** Email for the gate; defaults to a throwaway e2e address. */
  email?: string;
  /** Linger after the contact step so the 2.5s autosave debounce fires.
   *  Playwright outruns it — no human answers four pages in two seconds —
   *  so a spec asserting on the DRAFT must pace like a person. */
  settleAfterContactMs?: number;
};

/**
 * Drive the no-plan customer wizard from /estimate to the result screen.
 * The no-plan path prices from typical sizes, so it needs no fixture files
 * and completes in seconds — the workhorse for every journey spec.
 */
export async function driveNoPlanWizard(page: Page, opts: DriveOptions = {}) {
  await page.goto("/estimate");
  await page.getByRole("button", { name: /There isn't a floorplan to hand/ }).click();
  await expect(page.getByText(/thirty seconds of basics/i)).toBeVisible();

  await page.getByPlaceholder("Suburb").fill("Murrumbeena");
  await page.getByPlaceholder("Postcode").fill("3163");
  const answer = async (heading: string | RegExp, label: string) => {
    const row = page
      .locator(".wz-qhead", { hasText: heading })
      .locator("xpath=following-sibling::div[1]")
      .getByRole("button", { name: label, exact: true });
    if (await row.count()) await row.first().click();
  };
  await answer("Heritage listed", "No");
  await answer("What kind of property", "House");

  const next = async () => {
    await page.getByRole("button", { name: /Continue|Nearly there|See my estimate/ }).first().click();
    const err = page.locator(".wz-err");
    if (await err.count()) throw new Error(`wizard gate: ${await err.first().innerText()}`);
  };
  await next(); // → page 2, which for customers OPENS with the contact sub-step
  // C15: name, email and phone come at the START of the questions now — the
  // autosave needs somebody to save FOR. The block is absent for staff runs.
  const contact = page.locator(".wz-crow input");
  if (await contact.count()) {
    await contact.nth(0).fill("E2E Journey");
    await contact.nth(1).fill(opts.email ?? `e2e-journey-${Date.now()}@example.com`);
    await contact.nth(2).fill("0400 000 111");
    if (opts.settleAfterContactMs) await page.waitForTimeout(opts.settleAfterContactMs);
    await next(); // → surfaces
  }
  await next(); // → condition
  await next(); // → details
  if (opts.doorStyle) await page.getByRole("button", { name: opts.doorStyle, exact: true }).click();
  if (opts.windowStyle) await page.getByRole("button", { name: opts.windowStyle, exact: true }).click();
  if (opts.doorScope) await page.getByRole("button", { name: opts.doorScope, exact: true }).click();
  await answer(/built before 1970/, "No");
  await next(); // → paint
  await next(); // → email gate
  const email = page.locator("input[type=email]");
  // Prefilled from the contact step now; fill only a blank one (older paths).
  if (await email.count() && !(await email.inputValue())) {
    await email.fill(opts.email ?? `e2e-journey-${Date.now()}@example.com`);
  }
  await page.getByRole("button", { name: "See my estimate" }).click();

  // 28 Aug (Tom): no interstitial result screen — a revealed estimate lands
  // straight in the confirm-loop editor.
  await expect(page.locator(".sc-r").first()).toHaveText(MONEY_RANGE, { timeout: 90_000 });
}

/** Ensure the scope editor is open and hydrated (P1: pre-hydration clicks
 * are inert by design; the gate gives tests an honest go-signal). The
 * wizard lands here directly now — the link click remains only for callers
 * arriving from an older surface that still shows it. */
export async function openScopeEditor(page: Page) {
  const link = page.getByRole("link", { name: /Open the editor/i });
  if (await link.count()) await link.click();
  await expect(page.locator(".sc-r").first()).toHaveText(MONEY_RANGE, { timeout: 20_000 });
  await expect(page.locator("[data-ready='1']")).toBeAttached({ timeout: 20_000 });
}

/**
 * The C15 contact sub-step, for specs that drive the wizard with their own
 * inline steps rather than driveNoPlanWizard. Call it right after the first
 * Continue: fills the block when it is present, no-ops when it is not (staff
 * runs, older surfaces).
 */
export async function fillContactStep(page: Page, email?: string) {
  const contact = page.locator(".wz-crow input");
  if (!(await contact.count())) return;
  await contact.nth(0).fill("E2E Journey");
  await contact.nth(1).fill(email ?? `e2e-journey-${Date.now()}@example.com`);
  await contact.nth(2).fill("0400 000 111");
  await page.getByRole("button", { name: /Continue/ }).first().click();
}
