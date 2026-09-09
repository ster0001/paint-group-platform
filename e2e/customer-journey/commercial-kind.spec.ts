import { test, expect, type Page } from "@playwright/test";
import { createClient } from "@supabase/supabase-js";
import { fillContactStep, MONEY_RANGE , openQuickLook, fillQuickAddress, quickNext } from "./drive";
import { deleteUserByEmail, destroyAccountChain } from "../fixtures/portal";

/**
 * Commercial routing.
 *
 * Tom's 8 Sep rulings still hold — no asbestos question, no "will anyone be
 * living there", and a job we can't price says so up front and ends on the
 * person screen with the reason. What changed on 9 Sep (phase 7, commercial
 * pricing strategy) is HOW that is decided: a SEGMENT question, then seven
 * routing gates, any one of which sends the job to an appointment.
 */
const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const missing = !url || !serviceKey;
const stamp = Date.now();
const smallEmail = `e2e-commercial-small-${stamp}@example.com`;
const largeEmail = `e2e-commercial-large-${stamp}@example.com`;

const answer = (page: Page) => async (heading: string | RegExp, label: string) => {
  const row = page.locator(".wz-qhead", { hasText: heading })
    .locator("xpath=following-sibling::div[1]")
    .getByRole("button", { name: label, exact: true });
  if (await row.count()) await row.first().click();
};
const nextOf = (page: Page) => async () => {
  await page.getByRole("button", { name: /Continue|Nearly there|See my estimate/ }).first().click();
  const err = page.locator(".wz-err");
  if (await err.count()) throw new Error(`wizard gate: ${await err.first().innerText()}`);
};

/**
 * v2 phase 2: a COMMERCIAL property leaves the quick look at the place screen
 * and takes the segment question and the seven routing gates. That is the
 * point — phase 7a's rule is that any tripped gate sends the job to an
 * appointment, so a commercial job that walked the quick look to a price would
 * have skipped every one of them. Not a shortcut; the safety check missing.
 */
async function startCommercial(page: Page) {
  await openQuickLook(page);
  await fillQuickAddress(page);
  await quickNext(page);
  await page.getByTestId("ql-kind-commercial").click();
  await quickNext(page);
  await expect(page.locator(".wz-qhead", { hasText: "What sort of place is it" })).toBeVisible();
}

/** Answer every routing gate "no" — the only way a commercial job prices online. */
const clearGates = async (page: Page) => {
  const gates = page.locator("[data-testid^='gate-'][data-testid$='-no']");
  const n = await gates.count();
  for (let i = 0; i < n; i++) await gates.nth(i).click();
};

test.describe("commercial routing (Tom, 8 Sep; gates 9 Sep)", () => {
  test.skip(missing, "needs the test project's service key (see .env.test.local)");
  const db = missing ? null : createClient(url!, serviceKey!, { auth: { persistSession: false } });

  test.afterAll(async () => {
    if (!db) return;
    for (const e of [smallEmail, largeEmail]) { await destroyAccountChain(db, e); await deleteUserByEmail(db, e); }
  });

  test("a few rooms or offices: no asbestos or living-there question, and a price shows", async ({ page }) => {
    test.setTimeout(240_000);
    await startCommercial(page);
    const ans = answer(page), next = nextOf(page);
    // Continue is refused until the sort of job is picked.
    await page.getByRole("button", { name: /Continue/ }).first().click();
    await expect(page.locator(".wz-err")).toContainText(/What sort of place is it/);
    await ans("What sort of place is it", "Office");
    // Nothing about the site stops us, so a figure is still on the table.
    await clearGates(page);
    await expect(page.getByTestId("commercial-gate-ok")).toBeVisible();
    await next(); // surfaces
    await next(); // condition
    await next(); // details
    await expect(page.locator(".wz-qhead", { hasText: /asbestos/ })).toHaveCount(0);
    await expect(page.locator(".wz-qhead", { hasText: /living there/ })).toHaveCount(0);
    await next(); // contact — nothing on the details page blocks a commercial job
    await fillContactStep(page, smallEmail);
    await page.getByRole("button", { name: "See my estimate" }).click();
    await expect(page.locator(".sc-r").first()).toHaveText(MONEY_RANGE, { timeout: 90_000 });
  });

  test("a tripped gate says 'we'll need to see it' up front and ends with a person", async ({ page }) => {
    test.setTimeout(240_000);
    await startCommercial(page);
    const ans = answer(page), next = nextOf(page);

    // Strata never sees the gates at all — asking an owner to self-declare
    // their own owners corporation is asking them to talk us out of visiting.
    await ans("What sort of place is it", "Strata or common property");
    await expect(page.getByTestId("commercial-segment-stop")).toContainText(/owners corporation/i);
    await expect(page.getByTestId("commercial-gates")).toHaveCount(0);

    // An office is priceable — until one gate trips it.
    await ans("What sort of place is it", "Office");
    await clearGates(page);
    await expect(page.getByTestId("commercial-gate-ok")).toBeVisible();
    await page.getByTestId("gate-equipment-yes").click();
    await expect(page.getByTestId("commercial-gate-message")).toContainText(/need to see this one/i);
    await next(); await next(); await next(); // surfaces, condition, details
    await expect(page.locator(".wz-qhead", { hasText: /asbestos/ })).toHaveCount(0);
    await next(); // contact
    await fillContactStep(page, largeEmail);
    await page.getByRole("button", { name: "See my estimate" }).click();
    await expect(page.getByRole("heading", { name: "This one deserves a person" })).toBeVisible({ timeout: 90_000 });
    // The gate says WHY, in the customer's terms — not the generic handoff line.
    await expect(page.getByTestId("outcome-why")).toContainText(/lift, scaffold or boom/i);
  });
});
