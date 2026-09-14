/**
 * Tom, 14 Sep (tighten batch, Part B): the shell.
 *  - the bottom strip is two buttons — Finalise my price · Book a time;
 *  - the estimator (and the Call button) live in the frozen header;
 *  - Finalise before everything is answered prompts them to finish, or to book;
 *  - Book a time is its own page with the slot picker and the call-back form;
 *  - when everything is answered the estimate sends itself and the page says so.
 */
import { test, expect } from "@playwright/test";
import { MONEY_RANGE, driveNoPlanWizard, openScopeEditor } from "./drive";

test("two buttons, the estimator up top, and the finalise prompt when questions are left", async ({ page }) => {
  test.setTimeout(240_000);
  await driveNoPlanWizard(page);
  await openScopeEditor(page);
  // The strip: exactly two buttons, no tier sentence, no human line, no reach strip.
  const strip = page.locator(".sc-stick");
  await expect(strip.locator("button")).toHaveCount(2);
  await expect(page.getByTestId("scope-finalise")).toHaveText("Finalise my price");
  await expect(page.getByTestId("scope-book")).toHaveText("Book a time");
  await expect(page.locator(".sc-tier")).toHaveCount(0);
  await expect(page.getByTestId("human-line")).toHaveCount(0);
  await expect(page.getByTestId("reach-strip")).toHaveCount(0);
  // The estimator — with the Call button — in the frozen header, and nowhere in the body.
  const header = page.locator(".sc-freeze");
  await expect(header.getByTestId("estimator-strip")).toBeVisible();
  await expect(page.locator("main").getByTestId("estimator-strip")).toHaveCount(0);
  // Finalise with rooms unconfirmed → the prompt, with the exact words.
  await page.getByTestId("scope-finalise").click();
  const prompt = page.getByTestId("finalise-prompt");
  await expect(prompt).toBeVisible();
  await expect(prompt).toContainText("Please answer the remaining questions to finalise your price, or book in a time.");
  await expect(page).toHaveURL(/\/estimate\/scope/);
  // "Answer the questions" closes it and lands on the first open question.
  await page.getByTestId("prompt-answer").click();
  await expect(prompt).toHaveCount(0);
  await expect(page.locator(".sc-rc.amber, .sc-details").first()).toBeInViewport();
  // "Book a time" from the prompt → the booking page.
  await page.getByTestId("scope-finalise").click();
  await page.getByTestId("prompt-book").click();
  await expect(page).toHaveURL(/\/estimate\/book\?id=/, { timeout: 60_000 });
  await expect(page.getByTestId("book-page")).toBeVisible();
  await expect(page.getByTestId("reach-strip")).toBeVisible();
  await expect(page.getByTestId("reach-visit")).toBeVisible();
  await expect(page.getByTestId("reach-callback")).toBeVisible();
  await page.getByTestId("book-back").click();
  await expect(page).toHaveURL(/\/estimate\/scope\?id=/, { timeout: 60_000 });
});

test("everything answered: the estimate sends itself and the page lights up", async ({ page }) => {
  test.setTimeout(300_000);
  await driveNoPlanWizard(page, { bedrooms: 1 });
  await openScopeEditor(page);
  const estimateId = new URL(page.url()).searchParams.get("id")!;
  const range = page.locator(".sc-r").first();
  await expect(range).toContainText(MONEY_RANGE, { timeout: 30_000 });
  const settled = () => expect(page.locator(".sd-saving")).toHaveCount(0, { timeout: 30_000 });

  // The details card: every open question, one tap each.
  const details = page.getByTestId("details-card");
  await expect(details).toBeVisible();
  // One question at a time (item 5): doors, window frames, the paint, the height.
  for (const name of ["No", "Panel", "Casement", "Oil based", "2.7 m"]) {
    const b = details.getByRole("button", { name, exact: true });
    await expect(b.first()).toBeVisible({ timeout: 30_000 });
    await b.first().click();
    await settled();
  }
  await expect(details.getByTestId("details-card-settled")).toBeVisible({ timeout: 30_000 });

  // Every room: size ok, cupboard no, confirm.
  const cards = page.locator(".sc-rc[data-room]");
  const n = await cards.count();
  for (let i = 0; i < n; i++) {
    const card = cards.nth(i);
    await card.locator(".il-hd").click().catch(() => undefined);
    const looks = card.getByRole("button", { name: /Looks right/ });
    if (await looks.count()) await looks.first().click();
    // Each "No" is a server round trip: the question can turn `.ok` between the
    // count and the click, so a click that finds nothing is not a failure.
    for (let c = 0; c < 4 && (await card.locator(".il-cup:not(.ok)").count()); c++) {
      await card.locator(".il-cup:not(.ok)").first().getByRole("button", { name: "No", exact: true }).click({ timeout: 10_000 }).catch(() => undefined);
      await expect(page.locator(".sd-saving")).toHaveCount(0, { timeout: 30_000 });
    }
    await card.locator(".il-confirm").click();
    await expect(card).toHaveClass(/done/, { timeout: 20_000 });
  }
  // The two checks.
  const missed = page.getByTestId("missed-card");
  await missed.getByTestId("check-dw-ok").click();
  await expect(missed).toHaveAttribute("data-dw-done", "1", { timeout: 20_000 });
  await missed.getByTestId("check-rooms-ok").click();
  await expect(missed).toHaveAttribute("data-sweep-done", "1", { timeout: 20_000 });
  // Site and access (item 24) — one at a time, and part of "everything answered".
  await page.getByTestId("access-cleared-yes").click();
  await expect(page.getByTestId("access-stairwell")).toBeVisible({ timeout: 30_000 });
  await page.getByTestId("access-stairwell-no").click();
  await expect(page.getByTestId("access-parking")).toBeVisible({ timeout: 30_000 });
  await page.getByTestId("access-parking-drive").click();
  await expect(missed).toHaveClass(/done/, { timeout: 30_000 });

  // Everything answered: it sends itself, says so, and lights up.
  const banner = page.getByTestId("all-done-banner");
  await expect(banner).toHaveAttribute("data-state", "sent", { timeout: 60_000 });
  await expect(banner).toContainText(/finalise your booking/i);
  await expect(page.locator("[data-sent='1']")).toBeAttached();
  await expect(page.getByTestId("scope-finalise")).toHaveText("See what happens next");
  // The send is real: the sent page knows about it.
  await page.getByTestId("scope-finalise").click();
  await expect(page).toHaveURL(new RegExp(`/estimate/sent\\?id=${estimateId}`), { timeout: 60_000 });
});
