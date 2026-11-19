import { expect, type Locator, type Page } from "@playwright/test";
import { randomBytes } from "node:crypto";
import { test } from "../helpers";
import { serviceClient } from "../fixtures/woLoop";
import { MONEY_RANGE, driveMobileQuickLook, driveNoPlanWizard, fillQuickAddress, gateDoor, openQuickLook, passOtpIfShown, quickNext } from "./drive";

/**
 * Go-live brief Session 6 (C4) — the public path, end to end, as an ANONYMOUS customer:
 *   · inside on a phone: the texted code, the range shows, the quote stage NARROWS as a room is measured, the finished
 *     quote adds up (lines → Subtotal → GST → total, to the dollar);
 *   · outside on a phone: the same loop over the drawn house and its sides;
 *   · a small job on a phone: one room of doors and trims — the minimum-call-out screen carries the mobile and says
 *     nothing about "exact" (skipped with the price when the test stack prices it over the floor);
 *   · inside on a laptop (1470 px): the range, the door to the stage, a measured room, the finished quote, the rail.
 * Tom's own signed-out walk on new.paintgroup.com.au and the ten-job calibration are the human half of C4
 * (`docs/briefs/wizard-public-switch-checklist.md` §6); the switch is flipped only after.
 */
const FLAG_ON = process.env.NEXT_PUBLIC_QUOTE_STAGE_V10 !== "0";
const db = serviceClient();
const money = (s: string): [number, number] => { const m = s.replace(/[^\d–]/g, "").split("–").map(Number); return [m[0], m[1] ?? m[0]]; };

const cardId = (page: Page) => page.getByTestId("quote-stage").getAttribute("data-quote-card");
const settle = (page: Page) => expect(page.getByTestId("quote-stage")).toHaveAttribute("data-busy", "0", { timeout: 60_000 });
const press = async (l: Locator, touch: boolean) => { if (touch) await l.tap(); else await l.click(); };
const band = async (page: Page): Promise<[number, number]> => {
  const b = page.getByTestId("q-band").or(page.getByTestId("q-rail-band")).first();
  return [Number(await b.getAttribute("data-lo")), Number(await b.getAttribute("data-hi"))];
};
/** One card, the quick way: the typical size, no robe, the first whole-house answer, else Continue. */
async function passCard(page: Page, touch: boolean) {
  await settle(page);
  const id = (await cardId(page))!;
  if (id.startsWith("measure:") || id.startsWith("side-size:")) await press(page.getByTestId("q-size-typical"), touch);
  else if (id.startsWith("robe:")) await press(page.getByTestId("q-robe-none"), touch);
  else if (id.startsWith("g:")) await press(page.locator('[data-testid^="q-opt-"]').first(), touch);
  else await press(page.getByTestId("q-next"), touch);
  await expect.poll(() => cardId(page), { timeout: 30_000 }).not.toBe(id);
}
/** Measure the first size card with real numbers and prove the range closed in on it. */
async function measureOneAndNarrow(page: Page, touch: boolean) {
  for (let i = 0; i < 40 && !/^(measure|side-size):/.test((await cardId(page))!); i++) await passCard(page, touch);
  await settle(page);
  const id = (await cardId(page))!;
  const before = await band(page);
  const settledBefore = Number(await page.getByTestId("q-band").or(page.getByTestId("q-rail-band")).first().getAttribute("data-settled"));
  if (id.startsWith("side-size:")) { await page.getByTestId("q-side-w").fill("9.5"); await page.getByTestId("q-side-h").fill("2.7"); } // a side: across × high
  else { await page.getByTestId("q-measure-w").fill("3.6"); await page.getByTestId("q-measure-l").fill("4.2"); }
  await press(page.getByTestId("q-size-ok"), touch);
  await expect.poll(() => cardId(page), { timeout: 30_000 }).not.toBe(id);
  await settle(page);
  await page.waitForTimeout(1_600); // the band tweens ~1.4 s after an answer
  const after = await band(page);
  const settledAfter = Number(await page.getByTestId("q-band").or(page.getByTestId("q-rail-band")).first().getAttribute("data-settled"));
  expect(after[1] - after[0], `the range narrows after a measured room (${before.join("–")} → ${after.join("–")})`).toBeLessThanOrEqual(before[1] - before[0]);
  expect(settledAfter, "the settled share rises").toBeGreaterThan(settledBefore);
}
/** The finished quote adds up: lines → Subtotal, Subtotal + GST → total, low and high, to the dollar; validity from Settings. */
async function proveQuoteAddsUp(doc: Locator) {
  await expect(doc).toContainText(/Valid \d+ days · Includes GST/);
  const amounts = await doc.locator("[data-testid^='q-line-'][data-testid$='-amount'], [data-testid^='q-xline-'][data-testid$='-amount']").allInnerTexts();
  expect(amounts.length).toBeGreaterThanOrEqual(2);
  for (const a of amounts) expect(a).not.toBe("—");
  const [subLo, subHi] = money(await doc.getByTestId("q-doc-subtotal").locator(".amt").innerText());
  const [gstLo, gstHi] = money(await doc.getByTestId("q-doc-gst").locator(".amt").innerText());
  const [totLo, totHi] = money(await doc.getByTestId("q-doc-total").locator(".amt").innerText());
  const sum = amounts.map(money);
  expect(sum.reduce((n, [lo]) => n + lo, 0)).toBe(subLo);
  expect(sum.reduce((n, [, hi]) => n + hi, 0)).toBe(subHi);
  expect(subLo + gstLo).toBe(totLo);
  expect(subHi + gstHi).toBe(totHi);
  await expect(doc.getByTestId("q-doc-total")).toContainText("Your price");
}
async function toDone(page: Page, touch: boolean) {
  for (let i = 0; i < 60 && (await cardId(page)) !== "done"; i++) await passCard(page, touch);
  await settle(page);
  expect(await cardId(page)).toBe("done");
  await expect(page.getByTestId("gate-range")).toContainText(MONEY_RANGE);
  return page.getByTestId("q-done-doc");
}
const cleanup = (suburb: string) => async () => {
  if (!db) return;
  const { data: rows } = await db.from("wizard_drafts").select("estimate_id").eq("suburb", suburb);
  await db.from("wizard_drafts").delete().eq("suburb", suburb);
  for (const r of rows ?? []) if (r.estimate_id) await db.from("estimates").delete().eq("id", r.estimate_id);
};

test.describe("Go-live S6 — the public path end to end, on a phone", () => {
  test.skip(!db, "needs SUPABASE_SERVICE_ROLE_KEY");
  test.skip(!FLAG_ON, "quote stage v10 is switched off in this environment");
  test.use({ viewport: { width: 390, height: 780 }, isMobile: true, hasTouch: true });
  const run = randomBytes(3).toString("hex");
  const suburb = `E2E S6 ${run}`;
  test.afterAll(cleanup(suburb));
  const at = (page: Page, id: string) => expect(page.locator(`[data-mobile-screen='${id}']`)).toBeVisible({ timeout: 20_000 });
  const details = async (page: Page, who: string) => {
    await at(page, "details");
    await page.getByTestId("gate-name").fill(`${who} Tester`);
    const mobile = `04${String(Date.now()).slice(-8)}`;
    await page.getByTestId("gate-mobile").fill(mobile);
    await page.getByTestId("gate-email").fill(`s6.${who.toLowerCase()}.${run}@example.com`);
    await expect(page.getByTestId("ql-next")).toBeEnabled({ timeout: 30_000 });
    await page.getByTestId("ql-next").tap();
    await passOtpIfShown(page);
    return mobile;
  };
  const gateShows = async (page: Page) => {
    const gate = page.getByTestId("wzm-gate");
    const bounced = page.locator(".wz-err");
    await expect(gate.or(bounced)).toBeVisible({ timeout: 90_000 });
    if (await bounced.count()) throw new Error(`submit failed: ${await bounced.first().innerText()}`);
    await expect(page.getByTestId("gate-range")).toContainText(MONEY_RANGE);
    await gateDoor(page).tap();
    await expect(page).toHaveURL(/\/estimate\/quote\?id=/, { timeout: 60_000 });
    await expect(page.getByTestId("quote-stage")).toBeVisible({ timeout: 30_000 });
  };

  test("inside: code → range → the stage narrows on a measured room → the finished quote adds up", async ({ page }) => {
    test.setTimeout(420_000);
    await openQuickLook(page);
    await fillQuickAddress(page, { suburb });
    await driveMobileQuickLook(page, { suburb, bedrooms: 2, colour: "new", condition: "wear" });
    await details(page, "Inside");
    await gateShows(page);
    await measureOneAndNarrow(page, true);
    const doc = await toDone(page, true);
    await proveQuoteAddsUp(doc);
  });

  test("outside: the drawn house → range → the sides on the stage → the finished quote adds up", async ({ page }) => {
    test.setTimeout(420_000);
    await openQuickLook(page);
    await fillQuickAddress(page, { suburb });
    const inside = await driveMobileQuickLook(page, { suburb, jobType: "exterior" });
    expect(inside).toBe(false);
    await at(page, "shape");
    await page.getByTestId("ql-ext-type-wb").tap();
    await at(page, "size");
    await page.getByTestId("ql-ext-size-md").tap();
    for (const s of ["p-house", "p-win", "p-ver", "p-around"]) { await at(page, s); await page.getByTestId("ql-next").tap(); }
    await at(page, "a-walls");
    await page.getByTestId("ext-mat-weatherboards").tap();
    await at(page, "a-win");
    await page.getByTestId("ql-ext-win-casement").tap();
    await at(page, "a-colours");
    await page.getByTestId("ql-ext-colour-new").tap();
    await at(page, "a-access");
    await page.getByTestId("ql-next").tap();
    for (const side of ["s-front", "s-right", "s-back", "s-left"]) { await at(page, side); await page.getByTestId("ql-next").tap(); }
    await details(page, "Outside");
    await gateShows(page);
    await measureOneAndNarrow(page, true);
    const doc = await toDone(page, true);
    await proveQuoteAddsUp(doc);
  });

  test("a small job: one room of doors and trims meets the minimum-call-out screen, which carries the mobile and never says exact", async ({ page }) => {
    test.setTimeout(300_000);
    await openQuickLook(page);
    await fillQuickAddress(page, { suburb });
    await at(page, "what");
    await page.getByTestId("ql-jobtype-interior").tap();
    await at(page, "property");
    await page.getByTestId("ql-kind-unit_apartment").tap();
    await at(page, "beds");
    await page.getByTestId("ql-bedrooms-1").tap();
    await at(page, "job");
    await page.getByTestId("ql-scope-trims_doors").tap();
    await at(page, "surfaces");
    await quickNext(page);
    await at(page, "rooms");
    // keep one room only: untick every listed room but the first
    const on = page.locator("[data-testid^='ql-room-'][aria-pressed='true']");
    const n = await on.count();
    for (let i = n - 1; i >= 1; i--) await on.nth(i).tap();
    await expect(page.locator("[data-testid^='ql-room-'][aria-pressed='true']")).toHaveCount(1);
    await quickNext(page);
    await at(page, "colours");
    await page.getByTestId("ql-colours-same").tap();
    await at(page, "condition");
    await page.getByTestId("ql-condition-good").tap();
    await at(page, "living");
    await page.getByTestId("ql-occupied-no").tap();
    const mobile = await details(page, "Small");
    const stop = page.getByTestId("hard-stop");
    const gate = page.getByTestId("wzm-gate");
    await expect(stop.or(gate)).toBeVisible({ timeout: 90_000 });
    if (!(await stop.count())) {
      const range = await page.getByTestId("gate-range").innerText();
      test.skip(true, `one room of doors and trims prices at ${range} on this stack — not under the minimum, so the small-job screen is not reachable here`);
    }
    // H6: the mobile is carried, one sentence, no "exact"
    await expect(page.getByTestId("hard-stop-phone-known")).toContainText(mobile.slice(-4));
    const words = await stop.innerText();
    expect(words).not.toMatch(/\bexact\b/i);
    expect(words).toContain("Smaller jobs are priced from our minimum call-out");
    await expect(page.getByTestId("hard-stop-what")).toHaveCount(0);
  });
});

test.describe("Go-live S6 — the public path end to end, on a laptop", () => {
  test.skip(!db, "needs SUPABASE_SERVICE_ROLE_KEY");
  test.skip(!FLAG_ON, "quote stage v10 is switched off in this environment");
  test.use({ viewport: { width: 1470, height: 900 } });
  const run = randomBytes(3).toString("hex");
  const suburb = `E2E S6L ${run}`;
  test.afterAll(cleanup(suburb));

  test("inside: the range, the door to the stage, a measured room narrows it, the finished quote adds up, the rail reads All settled", async ({ page }) => {
    test.setTimeout(420_000);
    await driveNoPlanWizard(page, { stopAtReveal: true, suburb, bedrooms: 2, contactName: "Laptop Tester", email: `s6.laptop.${run}@example.com` });
    const reveal = page.getByTestId("reveal");
    await expect(reveal).toBeVisible();
    await expect(reveal).toContainText(MONEY_RANGE);
    await page.getByTestId("door-tighten").click();
    const sheet = page.getByTestId("talk-sheet");
    const stage = page.getByTestId("quote-stage");
    await expect(sheet.or(stage)).toBeVisible({ timeout: 60_000 });
    if (await sheet.count()) {
      await page.getByTestId("talk-name").fill("Laptop Tester");
      await page.getByTestId("talk-email").fill(`s6.laptop.${run}@example.com`);
      await page.getByTestId("talk-mobile").fill(`04${String(Date.now()).slice(-8)}`);
      await page.getByTestId("talk-go").click();
    }
    // the details were given at the gate on the way to the range, so the door asks for no code here
    await expect(page).toHaveURL(/\/estimate\/quote\?id=/, { timeout: 60_000 });
    await expect(stage).toBeVisible({ timeout: 30_000 });
    await measureOneAndNarrow(page, false);
    const doc = await toDone(page, false);
    await proveQuoteAddsUp(doc);
    await expect(page.getByTestId("q-rail-rooms")).toBeVisible();
    await expect(page.getByTestId("q-rail-quote-toggle")).toContainText("All settled");
  });
});
