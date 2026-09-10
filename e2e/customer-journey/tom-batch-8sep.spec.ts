import { test, expect, type Page } from "@playwright/test";
import { fillContactStep, uniquePhone, openExteriorPages } from "./drive";

/**
 * Tom's 8 September 2026 (evening) batch, driven on the real screen.
 *
 *  1  gutters and fascias can go on a side twice
 *  2  a side takes the customer's own name ("Courtyard")
 *  4  handrails, with the metres stated
 *  5  the reach strip reads "Book in your estimator", with icons
 *  6  the call-back form arrives with their own number in it
 *  7  the phone hours sit with the Call us button
 *  8  the finalise button is live before every card is confirmed
 *  9  nothing on the page is wider than the screen, at any width
 * 11  the optional comments box at the bottom of each side
 *
 * (3/12 — the sides the customer never asked for — is a unit test on the
 * build itself, `lib/wizard/exteriorTargets.test.ts`, because it happens
 * before a screen exists. 13 is the staff builder's panel.)
 */

const PHONE = uniquePhone();

async function driveExteriorWizard(page: Page) {
  await openExteriorPages(page, { via: "upload" });
  await page.getByPlaceholder(/listing URL/).fill("https://www.realestate.com.au/property-house-vic-murrumbeena-1400002");
  await page.getByPlaceholder("Suburb").fill("Murrumbeena");
  await page.getByPlaceholder("Postcode").fill("3163");
  const answer = async (heading: string | RegExp, label: string) => {
    const row = page.locator(".wz-qhead", { hasText: heading })
      .locator("xpath=following-sibling::div[1]")
      .getByRole("button", { name: label, exact: true });
    if (await row.count()) await row.first().click();
  };
  await answer("What kind of property", "House");
  const next = async () => {
    await page.getByRole("button", { name: /Continue|Nearly there|See my estimate/ }).first().click();
    const err = page.locator(".wz-err");
    if (await err.count()) throw new Error(`wizard gate: ${await err.first().innerText()}`);
  };
  await next();
  await next();
  await page.getByRole("button", { name: /Good overall/i }).click();
  await answer(/built before 1970/, "No");
  await next();
  await next();
  await fillContactStep(page, `e2e-8sep-${Date.now()}@example.com`);
  // The contact page's own phone field is what the call-back form copies —
  // fill it with a known one so the prefill can be asserted exactly.
  await page.locator(".wz-crow input").nth(2).fill(PHONE);
  await page.getByRole("button", { name: "See my estimate" }).click();
  await expect(page.locator(".sd-card").first()).toBeVisible({ timeout: 90_000 });
  await expect(page.locator("[data-ready='1']")).toBeAttached({ timeout: 20_000 });
}

test("Tom, 8 Sep evening: rename a side, gutters twice, handrails by the metre, the notes box", async ({ page }) => {
  test.setTimeout(240_000);
  await driveExteriorWizard(page);

  const front = page.locator('.sd-card[data-side="front"]');
  await front.locator(".sd-hd").click();
  await front.getByRole("button", { name: "Yes", exact: true }).click();
  await front.getByRole("button", { name: /Looks right/ }).click();

  // --- 2 · the customer's own name for a side --------------------------------
  // Address the card by its side, not by its text: the moment the rename form
  // opens the header IS an input, so a hasText filter stops matching it.
  const left = page.locator('.sd-card[data-side="left"]');
  await expect(left.locator(".sd-hd")).toContainText("Left side");
  await left.getByTestId("side-rename-open-left").click();
  await left.getByTestId("side-rename-left").locator("input").fill("Courtyard");
  await left.getByTestId("side-rename-left").getByRole("button", { name: "Save" }).click();
  await expect(left.locator(".sd-hd")).toContainText("Courtyard", { timeout: 30_000 });
  await expect(left.locator(".sd-hd")).not.toContainText("Left side");

  // --- 1 · gutters and fascias twice -----------------------------------------
  // The wizard's own ticks already put Gutters and Fascias on every side, so
  // the panel offers the SECOND run straight away. (The panel stays open
  // after a chip is tapped — clicking "Add a surface" again would close it.)
  await front.getByRole("button", { name: /Add a surface/ }).click();
  const panel = front.locator(".sd-addpanel");
  await expect(panel).toBeVisible();
  for (const code of ["Gutters", "Fascias"]) {
    const second = panel.getByRole("button", { name: new RegExp(`${code} \\(second run, upper\\)`) });
    await expect(second, `${code} may go on twice`).toBeVisible({ timeout: 30_000 });
    await second.click();
    await expect(front.locator(".sd-tl", { hasText: `${code} (lower)` })).toHaveCount(1, { timeout: 30_000 });
    await expect(front.locator(".sd-tl", { hasText: `${code} (upper)` })).toHaveCount(1);
    // Never a third.
    await expect(panel.getByRole("button", { name: new RegExp(`^\\+ ${code}`) })).toHaveCount(0);
  }

  // --- 4 · handrails, by the metre -------------------------------------------
  const rails = panel.getByRole("button", { name: /hand ?rails/i });
  await expect(rails.first(), "handrails are offered on a side").toBeVisible({ timeout: 30_000 });
  await rails.first().click();
  const tile = front.locator(".sd-tl", { hasText: /hand ?rails/i }).first();
  await expect(tile).toBeVisible({ timeout: 30_000 });
  const metres = tile.locator(".sd-mseg input");
  await expect(metres).toBeVisible();
  await expect(tile.locator(".sd-mseg em")).toHaveText(/follows this side/i);
  await metres.fill("6");
  await metres.blur();
  await expect(tile.locator(".sd-mseg em")).toHaveText(/you told us/i, { timeout: 30_000 });
  await expect(metres).toHaveValue("6");

  // --- 11 · the optional comments box ----------------------------------------
  const note = front.getByTestId("side-note-front");
  await expect(note).toBeVisible();
  await expect(note).toContainText(/anything worth mentioning/i);
  await expect(note).toContainText(/OPTIONAL/);
  await front.getByTestId("side-note-text-front").fill("Boards under the window are flaking and there's rot by the downpipe.");
  await front.getByTestId("side-note-save-front").click();
  await expect(page.locator(".sd-toast")).toContainText(/your estimator/i, { timeout: 30_000 });
  // It survives a reload — it lives on the block, not in the browser.
  await page.reload();
  await expect(page.locator(".sd-card").first()).toBeVisible({ timeout: 60_000 });
  const frontAgain = page.locator('.sd-card[data-side="front"]');
  await frontAgain.locator(".sd-hd").click();
  await expect(frontAgain.getByTestId("side-note-text-front")).toHaveValue(/flaking/, { timeout: 30_000 });
});

test("Tom, 8 Sep evening: book in your estimator — the lead, the hours, the number already there", async ({ page }) => {
  test.setTimeout(240_000);
  await driveExteriorWizard(page);

  // --- 8 · live from the start, and it says so -------------------------------
  await expect(page.locator(".sd-cta")).toBeEnabled();
  await expect(page.getByTestId("cta-hint")).toContainText(/don.t have to finish first/i);

  // --- 5 · the reframed strip ------------------------------------------------
  const strip = page.getByTestId("reach-strip");
  await expect(strip).toContainText("Book in your estimator");
  await expect(strip).not.toContainText(/Rather talk to a person/i);
  await expect(strip.getByTestId("reach-visit").locator(".reach-ic")).toBeVisible();
  await expect(strip.getByTestId("reach-callback").locator(".reach-ic")).toBeVisible();

  // --- 7 · the hours, with the Call us button --------------------------------
  if (await strip.getByTestId("reach-call").count()) {
    await expect(strip.getByTestId("reach-hours")).toContainText(/lines are open/i);
  }

  // --- 6 · the number they already gave us -----------------------------------
  // Tom, 9 Sep: it is STATED, not offered as a box to fill in — a pre-filled
  // input still reads as a form. The box only appears if they ask to change it.
  await strip.getByTestId("reach-callback").click();
  await expect(page.getByTestId("reach-phone-known")).toContainText(PHONE, { timeout: 20_000 });
  await expect(page.getByTestId("reach-phone")).toHaveCount(0);
  await page.getByTestId("reach-phone-change").click();
  await expect(page.getByTestId("reach-phone")).toHaveValue(PHONE);
});

test("Tom, 8 Sep evening: the estimate page fits the screen at every width", async ({ page }) => {
  test.setTimeout(240_000);
  await driveExteriorWizard(page);
  // An open card is the widest the page ever gets — tiles, steppers, the
  // add panel and the notes box all render at once.
  const front = page.locator('.sd-card[data-side="front"]');
  await front.locator(".sd-hd").click();
  await front.getByRole("button", { name: "Yes", exact: true }).click();

  for (const [w, h] of [[320, 720], [375, 812], [768, 1024], [1440, 900]] as const) {
    await page.setViewportSize({ width: w, height: h });
    const overflow = await page.evaluate(() => {
      const doc = document.documentElement;
      const wide: string[] = [];
      for (const el of Array.from(document.querySelectorAll<HTMLElement>(".wz *"))) {
        const r = el.getBoundingClientRect();
        if (r.width === 0) continue;
        if (r.right > doc.clientWidth + 1 || r.left < -1) {
          wide.push(`${el.tagName.toLowerCase()}.${el.className}`.slice(0, 90));
        }
      }
      return { scrollW: doc.scrollWidth, clientW: doc.clientWidth, wide: wide.slice(0, 6) };
    });
    expect(overflow.scrollW, `${w}px: page scrolls sideways — ${overflow.wide.join(" | ")}`)
      .toBeLessThanOrEqual(overflow.clientW + 1);

    // …and the bottom of the page is reachable. The sticky footer is fixed,
    // so it takes no space in the flow: without a reservation the last card
    // sits under it for ever, at every scroll position. That is what "covers
    // more than the full screen" meant (Tom, 8 Sep).
    await page.mouse.wheel(0, 40_000);
    await page.waitForTimeout(300);
    const buried = await page.evaluate(() => {
      const cards = Array.from(document.querySelectorAll<HTMLElement>(".sd-card, .sc-rc"));
      const last = cards[cards.length - 1];
      const stick = document.querySelector<HTMLElement>(".sd-stick, .sc-stick");
      if (!last || !stick) return null;
      return { cardBottom: last.getBoundingClientRect().bottom, stickTop: stick.getBoundingClientRect().top };
    });
    expect(buried, `${w}px: no cards or no sticky footer to measure`).not.toBeNull();
    expect(buried!.cardBottom, `${w}px: the last card is buried under the sticky footer`)
      .toBeLessThanOrEqual(buried!.stickTop + 1);

    await page.screenshot({ path: `test-results/8sep-estimate-${w}.png`, fullPage: false });
  }
});

test("Tom, 8 Sep evening: the estimate's chat bubble is on the website too", async ({ page }) => {
  test.setTimeout(180_000);
  await page.goto("/");
  const bubble = page.getByTestId("wz-chat-bubble");
  await expect(bubble, "the bubble renders before any session exists").toBeVisible({ timeout: 30_000 });

  // Nobody is signed in yet — a marketing visitor who never opens the chat
  // must not become an anonymous user, so the session is made on the tap.
  const before = await page.evaluate(() => Object.keys(window.localStorage).filter((k) => k.startsWith("sb-")).length);
  expect(before, "no auth session before the bubble is tapped").toBe(0);

  await bubble.click();
  await expect(page.getByTestId("wz-chat-panel")).toBeVisible({ timeout: 30_000 });
  // The greeting arrives from /api/agent/website, the same route the estimate uses.
  await expect(page.getByTestId("wz-chat-log")).toContainText(/talking to Paint Group/i, { timeout: 60_000 });
  // Same localStorage key as the estimate: one conversation follows the person.
  const convId = await page.evaluate(() => window.localStorage.getItem("pg-wizard-chat"));
  expect(convId, "the thread id is kept under the shared key").toBeTruthy();
});
