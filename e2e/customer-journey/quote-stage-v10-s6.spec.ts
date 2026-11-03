import { expect, type Page } from "@playwright/test";
import { randomBytes } from "node:crypto";
import { test } from "../helpers";
import { serviceClient } from "../fixtures/woLoop";
import { MONEY_RANGE, answerOutsideQuick, driveMobileQuickLook, driveNoPlanWizard, openQuickLook, fillQuickAddress } from "./drive";

/**
 * QUOTE STAGE v10 — session 6 (`docs/briefs/claude-code-brief-quote-stage-v10.md`
 * §2 desktop, §3 C and D): the outside path (three cards per painted side,
 * the side drawn by the walk-around's elevation), the doors-and-trims path
 * (one card per room with the counters), and the desktop format — drawing
 * left, the card centre, plan + price + collapsed quote right, the keyboard
 * flow (1–4 pick, Enter next, ← back).
 */
const FLAG_ON = process.env.NEXT_PUBLIC_QUOTE_STAGE_V10 !== "0";
const SHOTS = process.env.QUOTE_SHOTS_DIR ?? "";
const shot = async (page: Page, name: string) => { if (SHOTS) { await page.waitForTimeout(600); await page.screenshot({ path: `${SHOTS}/${name}.png`, animations: "disabled" }); } };
const db = serviceClient();
const cardId = (page: Page) => page.getByTestId("quote-stage").getAttribute("data-quote-card");
const passCard = async (page: Page) => {
  const id = (await cardId(page))!;
  if (id.startsWith("g:")) await page.locator(".wzq-card .wzm-opts .wzm-opt").first().click(); // a single choice advances itself
  else if (id.startsWith("measure:") || id.startsWith("side-size:")) await page.getByTestId("q-size-typical").click();
  else if (id.startsWith("robe:")) await page.getByTestId("q-robe-none").click();
  else await page.getByTestId("q-next").click();
  await expect.poll(() => cardId(page), { timeout: 30_000 }).not.toBe(id);
};
const passUntil = async (page: Page, stop: (id: string) => boolean) => {
  for (let i = 0; i < 60; i++) { const id = (await cardId(page))!; if (stop(id)) return; await passCard(page); }
  throw new Error("never reached the card");
};
const toGate = async (page: Page, run: string) => {
  // the phone's Each side step takes one "Looks right — next side" per painted side before the details screen
  const details = page.locator("[data-mobile-screen='details']");
  for (let i = 0; i < 5 && !(await details.isVisible()); i++) {
    const next = page.getByTestId("ql-next");
    if (await next.isVisible()) await next.click();
    await page.waitForTimeout(600);
  }
  await expect(details).toBeVisible({ timeout: 30_000 });
  await page.getByTestId("gate-name").fill("Quote Tester");
  await page.getByTestId("gate-mobile").fill(`04${String(Date.now()).slice(-8)}`);
  await page.getByTestId("gate-email").fill(`q10s6.${run}.${Date.now()}@example.com`);
  await expect(page.getByTestId("ql-next")).toBeEnabled({ timeout: 30_000 });
  await page.getByTestId("ql-next").click();
  const gate = page.getByTestId("wzm-gate");
  const bounced = page.locator(".wz-err");
  await expect(gate.or(bounced)).toBeVisible({ timeout: 90_000 });
  if (await bounced.count()) throw new Error(`submit failed: ${await bounced.first().innerText()}`);
  await expect(page.getByTestId("gate-bar-exact")).toHaveText("Get my detailed price");
  await page.getByTestId("gate-bar-exact").click();
  await expect(page).toHaveURL(/\/estimate\/quote\?id=/, { timeout: 30_000 });
  await expect(page.getByTestId("quote-stage")).toBeVisible({ timeout: 30_000 });
};
const cleanup = (suburb: string) => async () => {
  if (!db) return;
  const { data: rows } = await db.from("wizard_drafts").select("estimate_id").eq("suburb", suburb);
  await db.from("wizard_drafts").delete().eq("suburb", suburb);
  for (const r of rows ?? []) if (r.estimate_id) await db.from("estimates").delete().eq("id", r.estimate_id);
};

test.describe("quote stage v10 — session 6: outside and trims on a phone", () => {
  test.skip(!FLAG_ON, "quote stage v10 is switched off in this environment (NEXT_PUBLIC_QUOTE_STAGE_V10=0)");
  test.skip(!db, "needs SUPABASE_SERVICE_ROLE_KEY");
  test.use({ viewport: { width: 390, height: 780 }, isMobile: true, hasTouch: true });
  const run = randomBytes(3).toString("hex");
  const suburbOut = `E2E Q10O ${run}`, suburbTrims = `E2E Q10T ${run}`;
  test.afterAll(cleanup(suburbOut));
  test.afterAll(cleanup(suburbTrims));

  test("outside: the gate's door opens the side cards — size, on this side, attention — the side drawn, then the quote", async ({ page }) => {
    test.setTimeout(300_000);
    await openQuickLook(page);
    await fillQuickAddress(page, { suburb: suburbOut });
    await expect(page.getByTestId("wzm")).toBeVisible({ timeout: 20_000 });
    const inside = await driveMobileQuickLook(page, { suburb: suburbOut, jobType: "exterior" });
    expect(inside).toBe(false);
    await answerOutsideQuick(page);
    // Tom, 2 Nov: the windows and doors are counted BEFORE the gate, on each side's screen — the drawn house in the strip follows
    const sideWin = page.getByTestId("ext-side-win");
    if (await sideWin.count()) {
      const n0 = Number(await page.getByTestId("ext-side-win-n").innerText());
      const strip = page.getByTestId("wzm-thumb").locator("svg.wz-elev");
      await expect(strip).toHaveAttribute("data-windows", String(n0));
      await sideWin.getByRole("button", { name: /More/ }).click();
      await expect(page.getByTestId("ext-side-win-n")).toHaveText(String(n0 + 1));
      await expect(strip).toHaveAttribute("data-windows", String(n0 + 1));
    }
    await page.getByTestId("ql-next").click();
    await toGate(page, run);
    const stage = page.getByTestId("quote-stage");
    await expect(stage).toHaveAttribute("data-job-kind", "exterior");
    // C1 — how big is the front: across · high, the house drawn on the tile
    await expect(stage).toHaveAttribute("data-quote-card", /^side-size:/, { timeout: 15_000 });
    await expect(page.getByTestId("wzm-h1")).toHaveText(/^How big is the /);
    await expect(page.getByTestId("q-tile-room").locator("svg.wz-elev")).toHaveCount(1);
    await expect(page.getByTestId("q-tile-room").locator("svg.wz-elev")).toHaveAttribute("data-side", "front");
    await shot(page, "phone-outside-01-side-size");
    const firstKey = (await cardId(page))!.split(":")[1];
    await page.getByTestId("q-side-w").fill("12");
    await page.getByTestId("q-side-h").fill("3");
    await page.getByTestId("q-size-ok").click();
    await expect(stage).toHaveAttribute("data-quote-card", `side-on:${firstKey}`, { timeout: 30_000 });
    // the quote line is a side: across × high, measured
    await page.getByTestId("q-tile-quote").click();
    const measured = page.locator("[data-testid^='q-line-'][data-state='measured']").first();
    await expect(measured).toContainText("12 × 3 m");
    await expect(measured.locator(".amt")).toHaveText(MONEY_RANGE);
    await page.getByTestId("q-tile-quote").click();
    // C2 — on this side: windows and doors are the drawn house's counts — + on windows redraws the side with one more
    await expect(page.getByTestId("wzm-h1")).toHaveText("On this side");
    await shot(page, "phone-outside-02-on-this-side");
    const win0 = Number(await page.getByTestId("q-side-win-n").innerText());
    const elev = page.getByTestId("q-tile-room").locator("svg.wz-elev");
    await expect(elev).toHaveAttribute("data-windows", String(win0));
    await page.getByTestId("q-side-win").getByRole("button", { name: "More" }).click();
    await expect(page.getByTestId("q-side-win-n")).toHaveText(String(win0 + 1));
    await expect(elev).toHaveAttribute("data-windows", String(win0 + 1));
    await expect.poll(async () => page.getByTestId("quote-stage").getAttribute("data-busy"), { timeout: 30_000 }).not.toBe("1");
    // the condition chips sit low on the card: scroll them to the middle first, or the sticky bar sits over them
    await page.getByTestId("q-side-cond-weathered").evaluate((el) => el.scrollIntoView({ block: "center" }));
    await page.getByTestId("q-side-cond-weathered").click();
    await expect(page.getByTestId("q-side-cond-weathered")).toHaveAttribute("aria-pressed", "true");
    await page.getByTestId("q-next").click();
    await expect(stage).toHaveAttribute("data-quote-card", `side-attn:${firstKey}`, { timeout: 30_000 });
    // C3 — anything needing attention: flaking → the side's note
    await expect(page.getByTestId("q-next")).toHaveText("Nothing to fix — next side");
    await page.getByTestId("q-side-prep-flaking").click();
    await page.getByTestId("q-prep-add").click();
    await expect.poll(() => cardId(page), { timeout: 30_000 }).not.toBe(`side-attn:${firstKey}`);
    await page.getByTestId("wzm-back").click();
    await expect(stage).toHaveAttribute("data-quote-card", `side-attn:${firstKey}`);
    await expect(page.getByTestId("q-side-noted")).toContainText("Flaking");
    await page.getByTestId("q-next").click();
    await passUntil(page, (id) => id === "done");
    await expect(page.getByTestId("gate-label")).toHaveText("Quote Tester, your detailed price");
    await expect(page.getByTestId("gate-range")).toHaveText(MONEY_RANGE);
    await expect(page.getByTestId("q-done-doc").locator("[data-testid^='q-line-'][data-state='todo']")).toHaveCount(0);
    expect(await stage.innerText()).not.toMatch(/exact|±|within \d+%/i);
  });

  test("doors and trims: one card per room with the counters, no cornices or ceiling-height card, then the last checks", async ({ page }) => {
    test.setTimeout(300_000);
    await openQuickLook(page);
    await fillQuickAddress(page, { suburb: suburbTrims });
    await expect(page.getByTestId("wzm")).toBeVisible({ timeout: 20_000 });
    await driveMobileQuickLook(page, { suburb: suburbTrims, bedrooms: 2, scope: "trims_doors", colour: "same", condition: "good" });
    await toGate(page, run);
    const stage = page.getByTestId("quote-stage");
    await expect(stage).toHaveAttribute("data-job-kind", "trims");
    // D's own first card (S7): "Same white, or a new colour?" — then the doors
    await expect(stage).toHaveAttribute("data-quote-card", "g:trimColour", { timeout: 15_000 });
    await page.getByTestId("q-opt-trimColour-same").click();
    await expect(stage).toHaveAttribute("data-quote-card", "g:doors", { timeout: 15_000 });
    await page.getByTestId("q-opt-doors-panel").click();
    await passUntil(page, (id) => !id.startsWith("g:"));
    // D: straight to the room's lines with their counters — no size card
    await expect(stage).toHaveAttribute("data-quote-card", /^surfaces:/);
    await expect(page.getByTestId("q-count-doors")).toBeVisible();
    await shot(page, "phone-trims-01-room");
    await page.getByTestId("q-next").click();
    await expect(stage).toHaveAttribute("data-quote-card", /^surfaces:/, { timeout: 30_000 });
    await passUntil(page, (id) => id === "rooms");
    await passUntil(page, (id) => id === "done");
    await expect(page.getByTestId("gate-range")).toHaveText(MONEY_RANGE);
  });
});

test.describe("quote stage v10 — session 6: the desktop format and the keyboard", () => {
  test.skip(!FLAG_ON, "quote stage v10 is switched off in this environment (NEXT_PUBLIC_QUOTE_STAGE_V10=0)");
  test.skip(!db, "needs SUPABASE_SERVICE_ROLE_KEY");
  test.use({ viewport: { width: 1280, height: 900 } });
  const run = randomBytes(3).toString("hex");
  const suburb = `E2E Q10D ${run}`;
  test.afterAll(cleanup(suburb));

  test("three columns at 1280: drawing left, the card centre, price + collapsed quote right; 1–4, Enter and ← drive it", async ({ page }) => {
    test.setTimeout(300_000);
    // the desktop quick look to its range (the shared drive fills the gate's details on the way), then the desktop door (still the old editor this release)
    await driveNoPlanWizard(page, { suburb, stopAtReveal: true, contactName: "Desk Tester", email: `q10d.${run}@example.com` });
    await page.getByTestId("door-tighten").click();
    await expect(page).toHaveURL(/\/estimate\/scope\?id=/, { timeout: 60_000 });
    const id = new URL(page.url()).searchParams.get("id")!;
    await page.goto(`/estimate/quote?id=${id}`);
    const stage = page.getByTestId("quote-stage");
    await expect(stage).toBeVisible({ timeout: 30_000 });
    // R8: the rails show, the phone's tiles row and band do not; the quote starts collapsed (D-Q6)
    await expect(page.getByTestId("q-rail-right")).toBeVisible();
    await expect(page.getByTestId("q-tiles")).toBeHidden();
    await expect(page.getByTestId("q-band")).toBeHidden();
    await expect(page.getByTestId("q-rail-band-range")).toHaveText(MONEY_RANGE);
    await expect(page.getByTestId("q-rail-quote")).toHaveAttribute("data-open", "0");
    await page.getByTestId("q-rail-quote-toggle").click();
    await expect(page.getByTestId("q-rail-quote")).toHaveAttribute("data-open", "1");
    await expect(page.getByTestId("q-rail-quote").getByTestId("q-doc")).toBeVisible();
    await shot(page, "desktop-01-three-columns");
    const columns = await stage.evaluate((el) => getComputedStyle(el).gridTemplateColumns);
    expect(columns.split(" ").length, `three columns: ${columns}`).toBe(3);
    const left = (await page.getByTestId("q-rail-left").boundingBox())!, main = (await stage.locator("main").boundingBox())!, right = (await page.getByTestId("q-rail-right").boundingBox())!;
    expect(left.x).toBeLessThan(main.x);
    expect(main.x + main.width).toBeLessThanOrEqual(right.x + 1);
    // the keyboard: 2 picks the second option; ← goes back with it kept; Enter on the size card is "That's the size"
    await expect(stage).toHaveAttribute("data-quote-card", "g:cornices");
    await page.keyboard.press("2");
    await expect(stage).toHaveAttribute("data-quote-card", "g:height", { timeout: 15_000 });
    await page.keyboard.press("ArrowLeft");
    await expect(stage).toHaveAttribute("data-quote-card", "g:cornices");
    await expect(page.getByTestId("q-opt-cornices-standard")).toHaveAttribute("aria-pressed", "true");
    await page.keyboard.press("2");
    await expect(stage).toHaveAttribute("data-quote-card", "g:height", { timeout: 15_000 });
    for (let i = 0; i < 12; i++) {
      const cur = (await cardId(page))!;
      if (!cur.startsWith("g:")) break;
      await page.keyboard.press("1");
      await expect.poll(() => cardId(page), { timeout: 15_000 }).not.toBe(cur);
    }
    await expect(stage).toHaveAttribute("data-quote-card", /^measure:/);
    // the first measurement field is focused; the left rail draws this room
    await expect(page.getByTestId("q-measure-w")).toBeFocused();
    await expect(page.getByTestId("q-rail-room").locator("svg")).toHaveCount(1);
    await shot(page, "desktop-02-measure");
    const stageRoom = (await page.getByTestId("q-stage").innerText()).split(" · ")[0]; // the stage line is upper-cased by CSS
    expect((await page.getByTestId("q-rail-room-name").innerText()).toLowerCase()).toBe(stageRoom.toLowerCase());
    await page.keyboard.type("4");
    await page.keyboard.press("Enter");
    await expect(stage).toHaveAttribute("data-quote-card", /^surfaces:/, { timeout: 30_000 });
    await page.keyboard.press("Enter");
    await expect(stage).toHaveAttribute("data-quote-card", /^(robe|attention):/, { timeout: 30_000 });
  });
});
