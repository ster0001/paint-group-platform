import { expect, type Page } from "@playwright/test";
import { DESKTOP_ONE_PRESS, fillQuickAddress, gateDoor, lookAtEverySide, MONEY_RANGE, openQuickLook, passDetailsSheetIfShown, passGateIfShown, passOtpIfShown, quickNext, setParts, tightenToScope, uniquePhone } from "./drive";

/**
 * Exterior wizard v2 — the shared walk to the Each-side step for the S4/S5
 * specs (a spec must not import another spec: Playwright would register its
 * tests twice). Home → Painting → About it with the plainest answers for the
 * shape, landing on "Check each side of the house".
 */
const BUNGALOW_PARTS = ["walls", "gable", "fascias", "gutters", "eaves", "windows", "doors", "verandah", "posts"];

export async function toSides(page: Page, shape = "cal", parts = BUNGALOW_PARTS, rowPosition?: string) {
  await openQuickLook(page);
  await fillQuickAddress(page);
  await page.getByTestId("ql-jobtype-exterior").click();
  await quickNext(page);
  await expect(page.locator("[data-quick-step='place']")).toBeVisible({ timeout: 20_000 });
  await quickNext(page);
  await expect(page.locator("[data-quick-step='home']")).toBeVisible({ timeout: 20_000 });
  await page.getByTestId(`ql-ext-type-${shape}`).click();
  await page.getByTestId("ql-ext-size-md").click();
  if (rowPosition) await page.getByTestId(`ql-ext-row-${rowPosition}`).click();
  await quickNext(page);
  await expect(page.locator("[data-quick-step='paint']")).toBeVisible({ timeout: 20_000 });
  await setParts(page, parts);
  await quickNext(page);
  await expect(page.locator("[data-quick-step='about']")).toBeVisible({ timeout: 20_000 });
  if (parts.includes("walls")) await page.getByTestId("ext-mat-weatherboards").click();
  if (parts.includes("gable")) await page.getByTestId("ext-gable-stucco").click();
  await quickNext(page);
  await expect(page.locator("[data-quick-step='sides']")).toBeVisible({ timeout: 20_000 });
}


/**
 * Tom, 25 Oct 2026: the old upload route (listing, facade photos, five pages)
 * is staff-only now, so the specs that used it to reach the SIDES EDITOR take
 * the customer's real way: the drawn house, every side looked at, the gate,
 * the range, then Tighten my price (exterior-v2-tighten.spec.ts, item 8).
 */
/**
 * 24 Nov 2026: desktop one-press (`NEXT_PUBLIC_WIZARD_DESKTOP_ONEPRESS=1`, on in CI) gives the laptop the phone's one
 * question a screen, so the grouped laptop screens `toSides` drives are not drawn there. This is the same outside
 * walk on those screens — shape, size, the Painting screens with the parts set, About it with the plainest answers,
 * every side looked at — then the details, the texted code and the gate, the one-question shell's own door to tighten.
 */
async function phoneOutsideToGate(page: Page, parts: readonly string[], who: { name?: string; email?: string; mobile?: string }) {
  await openQuickLook(page);
  await fillQuickAddress(page);
  const shell = page.getByTestId("wzm");
  await expect(shell).toBeVisible({ timeout: 20_000 });
  await page.getByTestId("ql-jobtype-exterior").click();
  const screenNow = async () => ((await shell.count()) ? shell.getAttribute("data-mobile-screen") : null);
  const PICK: Record<string, string> = { shape: "ql-ext-type-cal", size: "ql-ext-size-md", "a-walls": "ext-mat-weatherboards", "a-gable": "ext-gable-stucco", "a-colours": "ql-ext-colour-new" };
  for (let i = 0; i < 40; i++) {
    await expect.poll(screenNow, { timeout: 20_000 }).not.toBe("what");
    const s = await screenNow();
    if (s === "details") break;
    if (!s) throw new Error("phoneOutsideToGate: the one-question shell went before the details screen");
    const screen = page.locator(`[data-mobile-screen='${s}']`);
    if (s.startsWith("p-")) await setParts(page, parts);
    if (PICK[s]) await page.getByTestId(PICK[s]).click();
    else if (!s.startsWith("p-")) {
      // a single choice with nothing chosen takes its first option; a chosen one advances on a tap (the ~250 ms auto-advance)
      const bar = page.getByTestId("ql-next");
      if (!(await bar.count())) {
        const pressed = screen.locator(".wzm-screen [aria-pressed='true']");
        await ((await pressed.count()) ? pressed.first() : screen.locator(".wzm-screen .wzm-opt").first()).click();
      }
    }
    await page.waitForTimeout(400);
    if ((await screenNow()) === s && (await page.getByTestId("ql-next").count())) {
      await expect(page.getByTestId("ql-next")).toBeEnabled({ timeout: 30_000 });
      await page.getByTestId("ql-next").click();
    }
    await expect.poll(screenNow, { timeout: 15_000 }).not.toBe(s);
  }
  await expect(page.locator("[data-mobile-screen='details']")).toBeVisible({ timeout: 20_000 });
  await page.getByTestId("gate-name").fill(who.name ?? "Drive Tester");
  await page.getByTestId("gate-email").fill(who.email ?? `drive.${Date.now()}@example.com`);
  await page.getByTestId("gate-mobile").fill(who.mobile ?? uniquePhone());
  await expect(page.getByTestId("ql-next")).toBeEnabled({ timeout: 30_000 });
  await page.getByTestId("ql-next").click();
  await passOtpIfShown(page);
  // the phone's gate on a phone; on a laptop the one-question walk ends on the laptop's own range page
  const gate = page.getByTestId("wzm-gate");
  const reveal = page.getByTestId("reveal");
  const bounced = page.locator(".wz-err");
  await expect(gate.or(reveal).or(bounced).first()).toBeVisible({ timeout: 90_000 });
  if (await bounced.count()) throw new Error(`submit failed: ${await bounced.first().innerText()}`);
  await expect(page.getByTestId("gate-range").or(page.getByTestId("reveal-range")).first()).toContainText(MONEY_RANGE);
}

export async function toSidesEditor(page: Page, who: { name?: string; email?: string; mobile?: string } = {}) {
  const parts = ["walls", "gable", "fascias", "gutters", "eaves", "windows", "doors"];
  if (DESKTOP_ONE_PRESS) {
    await phoneOutsideToGate(page, parts, who);
    if (await page.getByTestId("wzm-gate").count()) {
      await gateDoor(page).click();
      await passDetailsSheetIfShown(page, who);
    } else await tightenToScope(page, who);
    await expect(page.locator(".sd-card").first()).toBeVisible({ timeout: 90_000 });
    await expect(page.locator("[data-ready='1']")).toBeAttached({ timeout: 30_000 });
    return;
  }
  await toSides(page, "cal", parts);
  await lookAtEverySide(page);
  await quickNext(page);
  await passGateIfShown(page, who);
  await expect(page.getByTestId("reveal-range")).toContainText(MONEY_RANGE, { timeout: 90_000 });
  await tightenToScope(page, who);
  await expect(page.locator(".sd-card").first()).toBeVisible({ timeout: 90_000 });
  await expect(page.locator("[data-ready='1']")).toBeAttached({ timeout: 30_000 });
}
