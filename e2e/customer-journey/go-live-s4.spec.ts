import { expect, type Page } from "@playwright/test";
import { randomBytes } from "node:crypto";
import { test } from "../helpers";
import { serviceClient } from "../fixtures/woLoop";
import { driveMobileQuickLook, fillQuickAddress, gateDoor, openQuickLook, passOtpIfShown } from "./drive";

/**
 * Go-live brief Session 4 — inputs and dead ends (C3, H2, H6, H7, M1–M7, M13, M14), as an anonymous customer on a
 * PHONE (390 × 780):
 *   · C3  — a typed size is checked: letters are refused with a message; 35 m or 0.5 m asks "is it right?" before it
 *           can change anything; nothing is clamped;
 *   · M1  — typing the address never moves the job cards; M13 — every option group is named by its question;
 *   · M2  — the details screen says what is wrong (a landline is named); M3 — the consent line sits above the button;
 *   · H7  — "Room by room, about 10 minutes. A tape helps, pacing it out is fine."; M4 — one door visible at a time;
 *   · H2 / M5 / M6 / M7 — outside: no "What kind of place?", the usual parts pre-ticked, the wall material pre-selected,
 *           "about two minutes", and a basis line of the ticked parts only; a commercial building leaves from the shape screen.
 * H6 (the small-job screen carries the mobile) and M14 (service area before small job) are unit-tested — a sub-$2,000
 * job is not reachable through the phone's screens on the test stack.
 */
const FLAG_ON = process.env.NEXT_PUBLIC_QUOTE_STAGE_V10 !== "0";
const SHOTS = process.env.GO_LIVE_SHOTS_DIR ?? "";
const shot = async (page: Page, name: string) => { if (SHOTS) { await page.waitForTimeout(600); await page.screenshot({ path: `${SHOTS}/${name}.png`, animations: "disabled" }); } };
const db = serviceClient();
const doors = (page: Page) => page.locator('[data-testid="gate-exact"]:visible, [data-testid="gate-bar-exact"]:visible');

test.describe("Go-live S4 — inputs and dead ends, on a phone", () => {
  test.skip(!db, "needs SUPABASE_SERVICE_ROLE_KEY");
  test.use({ viewport: { width: 390, height: 780 }, isMobile: true, hasTouch: true });
  const run = randomBytes(3).toString("hex");
  const suburb = `E2E S4 ${run}`;
  test.afterAll(async () => {
    if (!db) return;
    const { data: rows } = await db.from("wizard_drafts").select("estimate_id").eq("suburb", suburb);
    await db.from("wizard_drafts").delete().eq("suburb", suburb);
    for (const r of rows ?? []) if (r.estimate_id) await db.from("estimates").delete().eq("id", r.estimate_id);
  });
  const at = (page: Page, id: string) => expect(page.locator(`[data-mobile-screen='${id}']`)).toBeVisible({ timeout: 20_000 });
  const cardId = (page: Page) => page.getByTestId("quote-stage").getAttribute("data-quote-card");
  const settle = (page: Page) => expect(page.getByTestId("quote-stage")).toHaveAttribute("data-busy", "0", { timeout: 60_000 });
  const passCard = async (page: Page) => {
    await settle(page);
    const id = (await cardId(page))!;
    if (id.startsWith("measure:")) await page.getByTestId("q-size-typical").tap();
    else if (id.startsWith("robe:")) await page.getByTestId("q-robe-none").tap();
    else await page.getByTestId("q-next").tap();
    await expect.poll(() => cardId(page), { timeout: 30_000 }).not.toBe(id);
  };
  const toGate = async (page: Page) => {
    await passOtpIfShown(page);
    const gate = page.getByTestId("wzm-gate");
    const bounced = page.locator(".wz-err");
    await expect(gate.or(bounced)).toBeVisible({ timeout: 90_000 });
    if (await bounced.count()) throw new Error(`submit failed: ${await bounced.first().innerText()}`);
    return gate;
  };

  test("inside: the address never moves the cards (M1), the details say what is wrong (M2, M3), the gate's one door (H7, M4), and a typed size is checked (C3)", async ({ page }) => {
    test.skip(!FLAG_ON, "quote stage v10 is switched off in this environment");
    test.setTimeout(300_000);
    await openQuickLook(page);
    await expect(page.getByTestId("wzm")).toBeVisible({ timeout: 20_000 });
    // M1 — the job cards stay put while the address (and the suburb / postcode boxes under it) is typed
    const cards = page.getByTestId("ql-jobtype");
    const before = (await cards.boundingBox())!;
    await fillQuickAddress(page, { suburb });
    const after = (await cards.boundingBox())!;
    expect(Math.abs(after.y - before.y), "the suburb / postcode boxes must not push the cards").toBeLessThanOrEqual(1);
    // M13 — the option group is named by its question
    await expect(cards).toHaveAttribute("role", "group");
    await expect(cards).toHaveAttribute("aria-labelledby", "wzm-h1");
    await expect(page.locator("#wzm-h1")).toHaveText("What are we painting?");
    await shot(page, "01-what");
    await driveMobileQuickLook(page, { suburb, bedrooms: 2, colour: "same", condition: "good" });
    await at(page, "details");
    // M2 — the reason, in words, as each field is started
    await page.getByTestId("gate-name").fill("Sam");
    await expect(page.getByTestId("ql-why")).toContainText("first and last name");
    await page.getByTestId("gate-name").fill("Sam Lee");
    await page.getByTestId("gate-mobile").fill("03 9123 4567");
    await expect(page.getByTestId("ql-why")).toContainText("That looks like a landline — we need a mobile to text your code.");
    await expect(page.getByTestId("ql-next")).toBeDisabled();
    await shot(page, "02-details-landline");
    await page.getByTestId("gate-mobile").fill(`04${String(Date.now()).slice(-8)}`);
    await page.getByTestId("gate-email").fill("sam@");
    await expect(page.getByTestId("ql-why")).toContainText(/email/);
    await page.getByTestId("gate-email").fill(`s4.${run}@example.com`);
    await expect(page.getByTestId("ql-why")).toHaveCount(0);
    // M3 — the consent line is in the bar, above the button
    const consent = page.getByTestId("wzm-foot").getByTestId("gate-consent");
    await expect(consent).toBeVisible();
    const cb = (await consent.boundingBox())!;
    const bb = (await page.getByTestId("ql-next").boundingBox())!;
    expect(cb.y + cb.height, "the consent sits above the button").toBeLessThanOrEqual(bb.y + 1);
    await shot(page, "03-details");
    await expect(page.getByTestId("ql-next")).toBeEnabled({ timeout: 30_000 });
    await page.getByTestId("ql-next").tap();
    const gate = await toGate(page);
    // H7 — the promise, M4 — one door visible at a time, at the top and once the inline button is on the screen
    await expect(page.getByTestId("gate-block-ask")).toContainText("Room by room, about 10 minutes. A tape helps, pacing it out is fine.");
    expect(await gate.innerText()).not.toMatch(/nothing to measure/i);
    await expect(doors(page)).toHaveCount(1);
    await shot(page, "04-gate-top");
    await page.getByTestId("gate-exact").scrollIntoViewIfNeeded();
    await page.waitForTimeout(500);
    await expect(doors(page)).toHaveCount(1);
    await shot(page, "05-gate-door");
    // C3 — into the stage, to the first measure card
    await gateDoor(page).tap();
    await expect(page).toHaveURL(/\/estimate\/quote\?id=/, { timeout: 60_000 });
    await expect(page.getByTestId("quote-stage")).toBeVisible({ timeout: 30_000 });
    for (let i = 0; i < 40 && !(await cardId(page))!.startsWith("measure:"); i++) await passCard(page);
    await settle(page);
    const measure = (await cardId(page))!;
    expect(measure).toMatch(/^measure:/);
    // letters: a message, no advance
    await page.getByTestId("q-measure-w").fill("abc");
    await page.getByTestId("q-size-ok").tap();
    await expect(page.getByTestId("q-size-error")).toHaveText("Numbers only, in metres — like 3.5.");
    expect(await cardId(page)).toBe(measure);
    await shot(page, "06-size-letters");
    // 35 m: asks first — the card does not advance, so the range cannot change without the tap
    await page.getByTestId("q-measure-w").fill("35");
    await page.getByTestId("q-size-ok").tap();
    await expect(page.getByTestId("q-size-confirm")).toContainText("That's larger than most rooms — is it right?");
    await expect(page.getByTestId("q-size-ok")).toHaveCount(0);
    expect(await cardId(page)).toBe(measure);
    await shot(page, "07-size-confirm");
    await page.getByTestId("q-size-fix").tap();
    await expect(page.getByTestId("q-size-confirm")).toHaveCount(0);
    await expect(page.getByTestId("q-measure-w")).toHaveValue("35");
    // under a metre asks too
    await page.getByTestId("q-measure-w").fill("0.5");
    await page.getByTestId("q-size-ok").tap();
    await expect(page.getByTestId("q-size-confirm")).toContainText("That's smaller than most rooms — is it right?");
    await page.getByTestId("q-size-fix").tap();
    // a plain size saves and moves on
    await page.getByTestId("q-measure-w").fill("3.5");
    await page.getByTestId("q-measure-l").fill("4");
    await page.getByTestId("q-size-ok").tap();
    await expect.poll(() => cardId(page), { timeout: 30_000 }).not.toBe(measure);
  });

  test("outside: no kind-of-place screen, the usual parts pre-ticked, the wall material pre-selected, about two minutes, a basis line of the ticked parts (H2, M5, M6, M7)", async ({ page }) => {
    test.setTimeout(300_000);
    await openQuickLook(page);
    await fillQuickAddress(page, { suburb });
    await at(page, "what");
    await page.getByTestId("ql-jobtype-exterior").tap();
    // M5 — straight to the shape; the commercial door is a line under the shapes
    await at(page, "shape");
    await expect(page.locator("[data-mobile-screen='property']")).toHaveCount(0);
    await expect(page.getByTestId("ql-ext-commercial")).toBeVisible();
    await shot(page, "10-shape");
    await page.getByTestId("ql-ext-type-wb").tap();
    await at(page, "size");
    await page.getByTestId("ql-ext-size-md").tap();
    // H2 — the usual parts come ticked; Continue is live on the first screen, no reason needed
    await at(page, "p-house");
    for (const p of ["walls", "fascias", "gutters", "eaves"]) await expect(page.getByTestId(`ext-part-${p}`)).toHaveAttribute("aria-pressed", "true");
    for (const p of ["gable", "downpipes"]) await expect(page.getByTestId(`ext-part-${p}`)).toHaveAttribute("aria-pressed", "false");
    await expect(page.getByTestId("ql-next")).toBeEnabled();
    await expect(page.getByTestId("ql-why")).toHaveCount(0);
    await shot(page, "11-p-house");
    await page.getByTestId("ql-next").tap();
    await at(page, "p-win");
    for (const p of ["windows", "doors"]) await expect(page.getByTestId(`ext-part-${p}`)).toHaveAttribute("aria-pressed", "true");
    await page.getByTestId("ql-next").tap();
    await at(page, "p-ver");
    await page.getByTestId("ql-next").tap();
    await at(page, "p-around");
    await page.getByTestId("ql-next").tap();
    // M5 — the wall material is already the weatherboard home's
    await at(page, "a-walls");
    await expect(page.getByTestId("ext-mat-weatherboards")).toHaveAttribute("aria-pressed", "true");
    await shot(page, "12-a-walls");
    await page.getByTestId("ext-mat-weatherboards").tap();
    await at(page, "a-win");
    await page.getByTestId("ql-ext-win-casement").tap();
    await at(page, "a-colours");
    await page.getByTestId("ql-ext-colour-new").tap();
    await at(page, "a-access");
    await page.getByTestId("ql-next").tap();
    for (const side of ["s-front", "s-right", "s-back", "s-left"]) { await at(page, side); await page.getByTestId("ql-next").tap(); }
    await at(page, "details");
    await page.getByTestId("gate-name").fill("Outside Tester");
    await page.getByTestId("gate-mobile").fill(`04${String(Date.now()).slice(-8)}`);
    await page.getByTestId("gate-email").fill(`s4.out.${run}@example.com`);
    await expect(page.getByTestId("ql-next")).toBeEnabled({ timeout: 30_000 });
    await page.getByTestId("ql-next").tap();
    const gate = await toGate(page);
    // M7 — the basis lists the ticked parts, nothing else; M6 / H7 — about two minutes; M4 — one door
    const basis = await page.getByTestId("gate-basis").innerText();
    expect(basis).toMatch(/the walls, fascias, gutters, eaves, windows and doors/);
    expect(basis).not.toMatch(/gable|verandah|shutters/);
    await expect(page.getByTestId("gate-block-ask")).toContainText("Side by side, about two minutes. A tape helps, pacing it out is fine.");
    await expect(page.getByTestId("gate-exact")).toContainText("Side by side · about 2 min");
    expect(await gate.innerText()).not.toMatch(/nothing to measure/i);
    await expect(doors(page)).toHaveCount(1);
    await shot(page, "13-outside-gate");
  });

  test("outside: a commercial building leaves from the shape screen (M5)", async ({ page }) => {
    test.setTimeout(120_000);
    await openQuickLook(page);
    await fillQuickAddress(page, { suburb });
    await at(page, "what");
    await page.getByTestId("ql-jobtype-exterior").tap();
    await at(page, "shape");
    await page.getByTestId("ql-ext-commercial").tap();
    await expect(page.locator("[data-mobile-screen='segment']")).toBeVisible({ timeout: 20_000 });
  });
});
