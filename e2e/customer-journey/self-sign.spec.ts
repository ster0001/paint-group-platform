import { test, expect, type Page } from "@playwright/test";
import { driveNoPlanWizard, openScopeEditor } from "./drive";
import { serviceClient } from "../fixtures/woLoop";

/**
 * C7 — self-sign, the hold, and the hand-off.
 *
 * Two stories, and they are the two halves of one decision:
 *
 *   1. a small interior, measured and fully confirmed, fixes its own price —
 *      ONE number, held, written down;
 *   2. a job the ladder will not let self-serve goes to a person, and the
 *      screens say whose desk it landed on.
 *
 * Both are driven as the anonymous customer and then read back as the
 * database, because the thing under test is whether the promise on the screen
 * and the row in the table are the same promise.
 *
 * ⚑ The third story has no screen: a STALE client asking to fix a price it is
 * no longer allowed to fix. It is exercised by posting the action for a job
 * the ladder refuses — the same request a page left open through an edit would
 * send — and the answer must be the kind one, not a 4xx.
 */

/** Walk the interior confirm loop, MEASURING each room rather than accepting
 *  the guess. Measured rooms are what lifts the estimate off the honesty cap
 *  (`accuracy.ts`: an assumed L or W caps a room's credit at 0.5), and without
 *  that no journey can reach the self-serve rung at all. */
async function measureAndConfirmEveryRoom(page: Page, metres: [number, number] = [3, 3]) {
  /**
   * THE CEILING HEIGHT FIRST — it is the single biggest thing standing between
   * a measured job and the Confirmed rung.
   *
   * `accuracy.ts` docks a room 0.15 while `H` is assumed, and that applies
   * even to a room the customer has measured and confirmed: 0.95 credit
   * becomes 0.80, which caps the estimate around 86% against a 90% bar. The
   * first version of this spec measured every room, confirmed every room, and
   * still landed on DETAILED — correctly. The ladder was not wrong; the job
   * genuinely had an assumption left in it.
   *
   * `confirm_height` is the one tap that clears it (route header: "height, not
   * plan-reading, is the walls error"), and it is the customer's own control,
   * so driving it here is the real journey rather than a shortcut.
   */
  const heightChip = page.getByRole("button", { name: /^2\.7 m$/ });
  if (await heightChip.count()) {
    await heightChip.first().click();
    await page.waitForTimeout(1200);
  }

  const cards = page.locator(".sc-rc[data-room]");
  const count = await cards.count();
  expect(count).toBeGreaterThan(0);
  for (let i = 0; i < count; i++) {
    const card = cards.nth(i);
    await card.scrollIntoViewIfNeeded();
    // "Adjust it" opens the two-box size row; entering real metres clears the
    // assumed-dimension penalty that "Looks right" leaves in place.
    await card.getByRole("button", { name: /Adjust it/ }).click();
    const row = card.locator(".sd-mrow");
    await row.locator("input").first().fill(String(metres[0]));
    await row.locator("input").nth(1).fill(String(metres[1]));
    await row.getByRole("button", { name: /Update size/ }).click();
    await page.waitForTimeout(600);
    /**
     * Every cupboard question answered "No" — and WAITED FOR. The "No" chip is
     * a server round trip (`act` → the rooms route → the loop re-renders with
     * `.ok`), not a local toggle. A fixed 300 ms between attempts was enough
     * on a quiet stack and not on a loaded one: the 12 Sep full-directory run
     * clicked No four times on the bathroom's vanity question, none had
     * answered before Confirm was tapped, the card shook on REQUIRED and the
     * test read as "the ladder is wrong". Wait for the answer to land.
     */
    const cups = card.locator(".il-cup");
    for (let c = 0, n = await cups.count(); c < n; c++) {
      const cup = cups.nth(c);
      if (/\bok\b/.test((await cup.getAttribute("class")) ?? "")) continue;
      await cup.getByRole("button", { name: "No", exact: true }).click();
      await expect(cup).toHaveClass(/\bok\b/, { timeout: 30_000 });
    }
    await card.locator(".il-confirm").click();
    await expect(card).toHaveClass(/done/, { timeout: 20_000 });
  }
  const dw = page.locator(".il-card", { hasText: /doors & windows/i });
  await dw.getByRole("button", { name: /That.s right/ }).click();
  await dw.getByRole("button", { name: /Confirm counts/ }).click();
  const sweep = page.locator('[data-card="sweep"]');
  await sweep.getByRole("button", { name: /No — that.s everything/ }).click();
  await sweep.getByRole("button", { name: /Confirm — nothing missing/ }).click();
}

test("a small measured interior fixes its own price — one number, held", async ({ page }) => {
  test.setTimeout(420_000);
  const db = serviceClient();
  test.skip(!db, "needs SUPABASE_SERVICE_ROLE_KEY");

  // One bedroom, walls and ceilings only: small enough to sit under the
  // self-serve cap once it is measured. The cap is a Settings value, so this
  // is deliberately well under it rather than just beneath.
  await driveNoPlanWizard(page, { bedrooms: 1, scope: "walls_ceilings", condition: "good", occupied: "no" });
  await openScopeEditor(page);
  const estimateId = new URL(page.url()).searchParams.get("id")!;
  expect(estimateId).toBeTruthy();

  await measureAndConfirmEveryRoom(page);

  // The SERVER's verdict, read off the screen it drives: Confirmed is exactly
  // `canAccept && !walkthroughRequired` (ladder.ts), so this asserts the rung
  // rather than the copy.
  await expect(page.getByTestId("tier-chip")).toHaveText("CONFIRMED", { timeout: 60_000 });

  await page.getByTestId("scope-finalise").click();
  await page.waitForURL(/\/estimate\/finish/, { timeout: 60_000 });

  // The fix door appears ONLY because the server said so — the accept line.
  const fix = page.getByTestId("finish-fix_online");
  await expect(fix).toBeVisible({ timeout: 30_000 });
  await expect(fix).toContainText(/held for \d+ days/);
  await fix.click();

  // ONE number, and the date it is held to.
  const fixed = page.getByTestId("finish-fixed");
  await expect(fixed).toBeVisible({ timeout: 60_000 });
  await expect(fixed).toContainText(/Your price is fixed at \$[\d,]+ inc\. GST\./);
  await expect(fixed).toContainText(/until \d{1,2} \w+ \d{4}/);

  // The row says the same thing the screen said.
  await expect.poll(async () => {
    const r = await db!.from("confirmation_requests")
      .select("kind, status, fixed_price_cents").eq("estimate_id", estimateId);
    return (r.data ?? [])[0] ?? null;
  }, { timeout: 30_000 }).toMatchObject({ kind: "fix_online", status: "fixed" });

  const { data: row } = await db!.from("confirmation_requests")
    .select("fixed_price_cents, fixed_at").eq("estimate_id", estimateId).single();
  expect(row!.fixed_price_cents).toBeGreaterThan(0);
  expect(row!.fixed_at).toBeTruthy();

  // THE HOLD IS ON THE ESTIMATE, not only in the sentence. `valid_until` is
  // what the daily lapse sweep reads; a hold nothing enforces is not a hold.
  const { data: est } = await db!.from("estimates").select("valid_until").eq("id", estimateId).single();
  expect(est!.valid_until).toBeTruthy();
  expect(new Date(`${est!.valid_until}T00:00:00Z`).getTime()).toBeGreaterThan(Date.now());

  // The number the customer was shown IS the number recorded — no rounding
  // drifted between the screen and the row (⚑8).
  const shown = (await fixed.textContent())!.match(/\$([\d,]+)/)![1].replace(/,/g, "");
  expect(Math.round(row!.fixed_price_cents! / 100)).toBe(Number(shown));
});

test("a job the ladder won't self-serve goes to a person, and the screens say whose", async ({ page }) => {
  test.setTimeout(300_000);
  const db = serviceClient();
  test.skip(!db, "needs SUPABASE_SERVICE_ROLE_KEY");

  // The ordinary walk: a whole house, unmeasured. It cannot self-serve.
  await driveNoPlanWizard(page);
  await openScopeEditor(page);
  const estimateId = new URL(page.url()).searchParams.get("id")!;

  /**
   * v2.4 — the CTA names the person it is going to. It must NEVER be a name
   * typed into a component: either it is "Send to <someone>" resolved from
   * `profiles` / Settings, or it keeps the old wording because we have nobody
   * to name. Both are correct; an invented name is not.
   */
  const cta = page.getByTestId("scope-finalise");
  await expect(cta).toHaveText(/^(Send to .+|Finalise my price|Accept estimate)$/);

  await cta.click();
  await page.waitForURL(/\/estimate\/finish/, { timeout: 60_000 });

  // Fix-online appears only when the server ladder says so — and here it does not.
  await expect(page.getByTestId("finish-fix_online")).toHaveCount(0);
  const send = page.getByTestId("finish-send_for_confirmation");
  await expect(send).toBeVisible({ timeout: 30_000 });
  await send.click();
  await page.waitForURL(/\/estimate\/sent/, { timeout: 60_000 });

  // The hand-off: who has it, what happens next, and the estimate is saved.
  await expect(page.getByTestId("sent")).toBeVisible();
  await expect(page.getByTestId("sent-steps").locator("li")).toHaveCount(3);
  await expect(page.getByTestId("sent-saved")).toBeVisible();
  const who = page.getByTestId("sent-who");
  if (await who.count()) {
    await expect(who).toContainText(/will be the one confirming your price\./);
  }

  // Nothing was fixed: a request, not a price.
  const { data: row } = await db!.from("confirmation_requests")
    .select("kind, status, fixed_price_cents").eq("estimate_id", estimateId).single();
  expect(row!.status).toBe("requested");
  expect(row!.kind).not.toBe("fix_online");
  expect(row!.fixed_price_cents).toBeNull();
});

test("THE STALE CLIENT: asking to fix a price the ladder now refuses is answered kindly", async ({ page }) => {
  test.setTimeout(300_000);
  const db = serviceClient();
  test.skip(!db, "needs SUPABASE_SERVICE_ROLE_KEY");

  await driveNoPlanWizard(page);
  await openScopeEditor(page);
  const estimateId = new URL(page.url()).searchParams.get("id")!;

  /**
   * The request a stale screen sends: the door said "fix my price online"
   * when the page rendered, and by the tap the job no longer qualifies. Sent
   * from the customer's OWN session, so it is the real request and not a
   * forged one — the point is not authorisation, it is that a page can be out
   * of date through no fault of anybody's.
   */
  const res = await page.evaluate(async (id) => {
    const r = await fetch(`/api/estimates/${id}/wizard-edit`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "fix_online", view: "customer" }),
    });
    return { status: r.status, body: await r.json() };
  }, estimateId);

  // Not an error. The customer did nothing wrong and gets what they'd have
  // got if they had tapped the other door a second earlier.
  expect(res.status).toBe(200);
  expect(res.body.fixDeclined).toBe(true);
  expect(res.body.fixedOnline).toBeUndefined();

  // And the promise was still made — the whole point of declining kindly.
  const { data: row } = await db!.from("confirmation_requests")
    .select("kind, status, fixed_price_cents").eq("estimate_id", estimateId).single();
  expect(row!.status).toBe("requested");
  expect(row!.kind).not.toBe("fix_online");
  expect(row!.fixed_price_cents).toBeNull();

  // No price was fixed and nothing was held.
  const { data: est } = await db!.from("estimates").select("valid_until").eq("id", estimateId).single();
  expect(est!.valid_until).toBeNull();
});
