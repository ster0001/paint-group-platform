import { expect, type Page } from "@playwright/test";
import { randomBytes } from "node:crypto";
import { test } from "../helpers";
import { serviceClient } from "../fixtures/woLoop";
import { fillQuickAddress, openQuickLook, passOtpIfShown } from "./drive";

/**
 * Desktop one-press (addendum to wizard mobile v5, Tom 5 Nov 2026; the
 * prototype `docs/mockups/wizard-desktop-onepress-prototype.html` wins where
 * the two disagree), as an ANONYMOUS customer on a laptop (1366 × 900), behind
 * `NEXT_PUBLIC_WIZARD_DESKTOP_ONEPRESS=1`.
 *
 *  1. The laptop keeps its two-column shell (header pills, Your range, the
 *     rail with the picture, Your job so far, the estimator) and renders the
 *     phone's twelve screens inside it, in the phone's order with the phone's
 *     words; a unit skips storeys; Outside skips job and rooms; a single
 *     choice advances itself; Continue only on surfaces, rooms and details
 *     ("Show my range"), then the texted code exactly as the phone has it.
 *  2. The step pills follow the question's step and tick when its last
 *     question is answered; the range screen lights "Guide range".
 *  3. Keys: 1–5 pick, Enter continues when it is enabled, ← goes back, the
 *     name is focused when the details open, nothing fires while typing in a
 *     field; key numbers on the cards; a grey key hint under them — a whole
 *     run from the address to the range without the mouse.
 *  4. The rail picture sweeps on every surface tick (the roller), changes
 *     with the property, the storeys, the colours and the condition, says
 *     "N surfaces ticked"; reduced motion snaps.
 *  5. Your job so far shows every answer so far; Change jumps to the question.
 *  6. The range reads "Want the detailed number?" / "Get my detailed price".
 *  7. The phone (390 × 780) is unchanged: its own header, no rail, no keys.
 */
const db = serviceClient();
type ScreenId = "what" | "property" | "beds" | "storeys" | "job" | "surfaces" | "rooms" | "colours" | "condition" | "living" | "details" | "code";
const HEADINGS: Record<ScreenId, string> = {
  what: "What are we painting?", property: "What kind of place is it?", beds: "How many bedrooms?", storeys: "One storey or two?",
  job: "What's the job?", surfaces: "What's being painted?", rooms: "We're painting these rooms", colours: "Colours?",
  condition: "How are the walls looking?", living: "Anyone living there while we paint?", details: "Where shall we send your range?", code: "Enter the code we texted",
};
const run = randomBytes(3).toString("hex");
const suburb = `E2E OnePress ${run}`;

const at = (page: Page, id: string) => expect(page.locator(`[data-testid='wzm'][data-mobile-screen='${id}']`)).toBeVisible({ timeout: 15_000 });
const heading = (page: Page) => page.getByTestId("wzm-h1");
const pill = (page: Page, step: string) => page.getByTestId("wz-rail").locator(`li[data-step='${step}']`);
const clipWidth = (page: Page, surf: string) =>
  page.locator(`[data-testid='pic-live'] [data-surf='${surf}'] rect.cprect`).evaluate((r) => Number(r.getAttribute("width")));

async function openLaptop(page: Page) {
  await openQuickLook(page);
  await expect(page.getByTestId("wzm")).toHaveAttribute("data-shell", "desktop");
  await at(page, "what");
  await fillQuickAddress(page, { suburb });
}

test.describe("Desktop one-press — the laptop takes the phone's screens (addendum session 1)", () => {
  test.skip(!db, "needs SUPABASE_SERVICE_ROLE_KEY (the texted code is read back from messages)");
  test.use({ viewport: { width: 1366, height: 900 } });

  test.afterAll(async () => {
    if (!db) return;
    const { data: rows } = await db.from("wizard_drafts").select("estimate_id").eq("suburb", suburb);
    await db.from("wizard_drafts").delete().eq("suburb", suburb);
    for (const r of rows ?? []) if (r.estimate_id) await db.from("estimates").delete().eq("id", r.estimate_id);
    await db.from("estimates").delete().ilike("title", `%${suburb}%`);
  });

  test("1 · the twelve screens in order inside the two-column shell; auto-advance; Continue only on surfaces, rooms and details; the pills and the rail follow", async ({ page }) => {
    test.setTimeout(240_000);
    await openLaptop(page);
    // the shell: header pills, the rail with the picture, Your job so far and the estimator; no phone chrome
    await expect(page.getByTestId("wz-head")).toBeVisible();
    await expect(page.getByTestId("wz-rail-end")).toHaveText("Your range");
    await expect(page.getByTestId("ql-side")).toBeVisible();
    await expect(page.getByTestId("ql-picture")).toHaveAttribute("data-picture", "live");
    await expect(page.getByTestId("ql-sofar")).toBeVisible();
    await expect(page.getByTestId("ql-talk")).toBeVisible();
    await expect(page.getByTestId("wzm-head")).toHaveCount(0);
    await expect(page.getByTestId("wzm-strip")).toHaveCount(0);
    await expect(page.getByTestId("ql-picture-note")).toHaveText("Updates as you answer.");
    const pane = (await page.locator(".wz-pane").boundingBox())!;
    const side = (await page.getByTestId("ql-side").boundingBox())!;
    expect(side.x, "the rail sits to the right of the question").toBeGreaterThan(pane.x + pane.width);

    await expect(heading(page)).toHaveText(HEADINGS.what);
    await expect(page.getByTestId("ql-next")).toHaveCount(0);
    await expect(pill(page, "start")).toHaveAttribute("data-state", "cur");
    await page.getByTestId("ql-jobtype-interior").click();
    await at(page, "property");
    // the pill follows the question's step; the address pill is ticked once its last question is answered
    await expect(pill(page, "start")).toHaveAttribute("data-state", "done");
    await expect(pill(page, "place")).toHaveAttribute("data-state", "cur");
    await expect(heading(page)).toHaveText(HEADINGS.property);
    await expect(page.getByTestId("wzm-sub")).toHaveText("Near enough is fine.");
    // a single choice advances itself (~260ms) — no Continue on the way
    const t0 = Date.now();
    await page.getByTestId("ql-kind-house").click();
    await at(page, "beds");
    expect(Date.now() - t0, "the card advanced itself").toBeLessThan(3_000);
    await expect(page.getByTestId("ql-next")).toHaveCount(0);
    await expect(pill(page, "place")).toHaveAttribute("data-state", "cur");
    await page.getByTestId("ql-bedrooms-4").click();
    await at(page, "storeys");
    await page.getByTestId("ql-storeys-double").click();
    // the rail picture: two storeys drawn
    await expect(page.getByTestId("pic-live")).toHaveAttribute("data-two", "true");
    await at(page, "job");
    await expect(pill(page, "place")).toHaveAttribute("data-state", "done");
    await expect(pill(page, "job")).toHaveAttribute("data-state", "cur");
    await expect(page.getByTestId("ql-scope-walls_ceilings"), "the phone's three jobs").toHaveCount(0);
    await page.getByTestId("ql-scope-whole").click();
    await at(page, "surfaces");
    await expect(page.getByTestId("ql-next")).toHaveText("Continue");
    await expect(page.getByTestId("ql-picture-note")).toHaveText("5 surfaces ticked");
    await page.getByTestId("ql-next").click();
    await at(page, "rooms");
    await expect(pill(page, "rooms")).toHaveAttribute("data-state", "cur");
    await expect(page.getByTestId("ql-next")).toHaveText("Continue");
    await expect(page.getByTestId("ql-picture")).toHaveAttribute("data-picture", "plan");
    await page.getByTestId("ql-next").click();
    await at(page, "colours");
    await expect(pill(page, "condition")).toHaveAttribute("data-state", "cur");
    await expect(page.getByTestId("ql-next")).toHaveCount(0);
    await page.getByTestId("ql-colours-same").click();
    await expect(page.getByTestId("pic-live")).toHaveAttribute("data-colour", "same");
    await at(page, "condition");
    await page.getByTestId("ql-condition-needs_work").click();
    await expect(page.getByTestId("pic-live")).toHaveAttribute("data-condition", "needs_work");
    await at(page, "living");
    await page.getByTestId("ql-occupied-no").click();
    await at(page, "details");
    await expect(pill(page, "condition")).toHaveAttribute("data-state", "done");
    await expect(pill(page, "gate")).toHaveAttribute("data-state", "cur");
    await expect(heading(page)).toHaveText(HEADINGS.details);
    await expect(page.getByTestId("ql-next")).toHaveText("Show my range");
    await expect(page.getByTestId("ql-next")).toBeDisabled();
    await page.getByTestId("gate-name").fill("One Press");
    await page.getByTestId("gate-mobile").fill(`04${String(Date.now()).slice(-8).replace(/(\d{2})(\d{3})(\d{3})/, "$1 $2 $3")}`);
    await page.getByTestId("gate-email").fill(`onepress.${run}@example.com`);
    await expect(page.getByTestId("ql-next")).toBeEnabled();
    await page.getByTestId("ql-next").click();
    // the texted code, exactly as the phone has it
    await at(page, "code");
    await expect(heading(page)).toContainText("Enter the code we texted");
    await expect(page.getByTestId("gate-otp-input")).toBeVisible();
    await expect(page.getByTestId("ql-next")).toHaveText("Show my range");
    await passOtpIfShown(page);
    const reveal = page.getByTestId("reveal");
    await expect(reveal).toBeVisible({ timeout: 90_000 });
    // "Your range" lit: the range header's first step is the current one
    await expect(page.getByTestId("wz-rail").locator("li").first()).toHaveAttribute("data-state", "cur");
    // 6 · the gate copy on a laptop
    await expect(page.locator(".wz-doors-head")).toHaveText("Want the detailed number?");
    await expect(page.getByTestId("door-tighten")).toContainText("Get my detailed price");
  });

  test("1b · a unit skips storeys; Outside skips job and rooms and goes to the drawn house", async ({ page }) => {
    await openLaptop(page);
    await page.getByTestId("ql-jobtype-interior").click();
    await at(page, "property");
    await page.getByTestId("ql-kind-unit_apartment").click();
    await expect(page.getByTestId("pic-live")).toHaveAttribute("data-property", "unit_apartment");
    await at(page, "beds");
    await page.getByTestId("ql-bedrooms-2").click();
    await at(page, "job"); // no storeys for a unit
    // back to the first screen and out the other door
    await page.keyboard.press("ArrowLeft");
    await at(page, "beds");
    await page.keyboard.press("ArrowLeft");
    await at(page, "property");
    await page.keyboard.press("ArrowLeft");
    await at(page, "what");
    await page.getByTestId("ql-jobtype-exterior").click();
    await at(page, "property");
    await page.getByTestId("ql-kind-house").click();
    // an outside job: no bedrooms, no job, no rooms — the exterior brief's first screen, inside the same shell
    await at(page, "shape");
    await expect(pill(page, "home")).toHaveAttribute("data-state", "cur");
    await expect(pill(page, "job")).toHaveCount(0);
    await expect(page.getByTestId("ql-side")).toBeVisible();
  });

  test("3 · keys: 1–5 pick, Enter continues, ← goes back, the name is focused, nothing fires in a field; key numbers and the hint", async ({ page }) => {
    test.setTimeout(240_000);
    await openLaptop(page);
    // the key numbers sit on each card; the grey hint under them
    const opts = page.locator("[data-testid='wzm'] .wzm-screen .wzm-opt");
    await expect(opts).toHaveCount(2);
    await expect(opts.nth(0).locator(".wzm-key")).toHaveText("1");
    await expect(opts.nth(1).locator(".wzm-key")).toHaveText("2");
    await expect(page.getByTestId("wzm-keys")).toContainText("choose");
    await expect(page.getByTestId("wzm-keys")).toContainText("back");
    // the address fields are fields: a digit typed there is typed, not a pick
    await page.getByPlaceholder("Postcode").focus();
    await page.keyboard.press("1");
    await at(page, "what");
    await page.getByPlaceholder("Postcode").fill("3163");
    await page.keyboard.press("ArrowLeft");
    await at(page, "what");
    // blur the field (a click on the heading — plain text), then the keys
    await page.getByTestId("wzm-h1").click();
    await page.keyboard.press("1"); // Inside
    await at(page, "property");
    await expect(page.getByTestId("ql-jobtype-interior")).toHaveCount(0);
    await page.keyboard.press("2"); // Townhouse
    await at(page, "beds");
    await expect(page.getByTestId("pic-live")).toHaveAttribute("data-property", "townhouse");
    await page.keyboard.press("3");
    await at(page, "storeys");
    await page.keyboard.press("ArrowLeft"); // back a screen
    await at(page, "beds");
    await expect(page.getByTestId("ql-bedrooms-3")).toHaveAttribute("aria-pressed", "true");
    await page.keyboard.press("3");
    await at(page, "storeys");
    await page.keyboard.press("1");
    await at(page, "job");
    await expect(page.getByTestId("wzm-keys")).toContainText("3");
    await page.keyboard.press("1"); // the whole interior
    await at(page, "surfaces");
    await expect(page.getByTestId("wzm-keys")).toContainText("Enter");
    // a digit on a chips screen picks nothing
    await page.keyboard.press("1");
    await at(page, "surfaces");
    for (const k of ["walls", "ceilings", "skirting", "doors", "windows"]) await expect(page.getByTestId(`ql-surface-${k}`)).toHaveAttribute("aria-pressed", "true");
    await page.keyboard.press("Enter");
    await at(page, "rooms");
    await page.keyboard.press("Enter");
    await at(page, "colours");
    await page.keyboard.press("1");
    await at(page, "condition");
    await page.keyboard.press("2");
    await at(page, "living");
    await page.keyboard.press("1");
    await at(page, "details");
    // the name is focused; digits and ← in the field are typing, not picks or Back
    await expect(page.getByTestId("gate-name")).toBeFocused();
    await page.keyboard.type("One 1");
    await page.keyboard.press("ArrowLeft");
    await at(page, "details");
    await expect(page.getByTestId("gate-name")).toHaveValue("One 1");
    // Enter does nothing while Show my range is disabled
    await page.keyboard.press("Enter");
    await at(page, "details");
    await page.getByTestId("gate-name").fill("One Press");
    await page.getByTestId("gate-mobile").fill(`04${String(Date.now() + 7).slice(-8).replace(/(\d{2})(\d{3})(\d{3})/, "$1 $2 $3")}`);
    await page.getByTestId("gate-email").fill(`onepress.keys.${run}@example.com`);
    await expect(page.getByTestId("ql-next")).toBeEnabled();
    await page.keyboard.press("Enter"); // Show my range — from a field, as a form would
    await at(page, "code");
    await passOtpIfShown(page);
    await expect(page.getByTestId("reveal")).toBeVisible({ timeout: 90_000 });
  });

  test("4 · the rail picture: every surface tick sweeps the roller in or out, the caption counts, reduced motion snaps", async ({ page }) => {
    await openLaptop(page);
    await page.getByTestId("ql-jobtype-interior").click();
    await at(page, "property");
    await page.getByTestId("ql-kind-house").click();
    await at(page, "beds");
    await page.getByTestId("ql-bedrooms-3").click();
    await at(page, "storeys");
    await page.getByTestId("ql-storeys-single").click();
    await at(page, "job");
    // before the surfaces screen nothing is painted
    await expect(page.getByTestId("pic-live")).toHaveAttribute("data-painted", "false");
    await page.getByTestId("ql-scope-whole").click();
    await at(page, "surfaces");
    await expect(page.getByTestId("pic-live")).toHaveAttribute("data-painted", "true");
    for (const s of ["walls", "ceilings", "skirting", "doors", "windows"]) await expect.poll(() => clipWidth(page, s), { timeout: 3_000 }).toBe(200);
    await expect(page.getByTestId("ql-picture-note")).toHaveText("5 surfaces ticked");
    // untick the ceilings: the wipe is under way, the glyph rides it, then it is gone
    await page.getByTestId("ql-surface-ceilings").click();
    await page.waitForTimeout(150);
    const mid = await clipWidth(page, "ceilings");
    expect(mid, "a sweep, not a snap").toBeGreaterThan(0);
    expect(mid).toBeLessThan(200);
    await expect(page.locator("[data-testid='pic-live'] [data-surf='ceilings'] .roller")).toHaveClass(/on/);
    await expect.poll(() => clipWidth(page, "ceilings"), { timeout: 3_000 }).toBe(0);
    await expect(page.getByTestId("ql-picture-note")).toHaveText("4 surfaces ticked");
    expect(await clipWidth(page, "walls")).toBe(200);
    await page.getByTestId("ql-surface-ceilings").click();
    await expect.poll(() => clipWidth(page, "ceilings"), { timeout: 3_000 }).toBe(200);
    await expect(page.getByTestId("ql-picture-note")).toHaveText("5 surfaces ticked");
    // reduced motion: a snap
    await page.emulateMedia({ reducedMotion: "reduce" });
    await page.getByTestId("ql-surface-doors").click();
    await page.waitForTimeout(60);
    expect(await clipWidth(page, "doors")).toBe(0);
    await page.getByTestId("ql-surface-doors").click();
    await page.waitForTimeout(60);
    expect(await clipWidth(page, "doors")).toBe(200);
  });

  test("5 · Your job so far follows every answer; Change jumps to that question with the answers kept", async ({ page }) => {
    await openLaptop(page);
    await page.getByTestId("ql-jobtype-interior").click();
    await at(page, "property");
    const sofar = page.getByTestId("ql-sofar");
    await expect(sofar.locator("li[data-step]")).toHaveCount(1); // the address
    await page.getByTestId("ql-kind-townhouse").click();
    await at(page, "beds");
    // the place row is there as soon as its first question is answered
    await expect(sofar.locator("li[data-step='place']")).toContainText("Townhouse");
    await page.getByTestId("ql-bedrooms-2").click();
    await at(page, "storeys");
    await expect(sofar.locator("li[data-step='place']")).toContainText("2 bed");
    await page.getByTestId("ql-storeys-double").click();
    await at(page, "job");
    await expect(sofar.locator("li[data-step='place']")).toContainText("two storeys");
    await page.getByTestId("ql-scope-some_rooms").click();
    await at(page, "surfaces");
    await expect(sofar.locator("li[data-step='job']")).toContainText("Some rooms");
    await page.getByTestId("ql-next").click();
    await at(page, "rooms");
    await expect(heading(page)).toHaveText("Which rooms?");
    await page.getByTestId("ql-next").click();
    await at(page, "colours");
    await expect(sofar.locator("li[data-step]")).toHaveCount(4); // address, place, job, rooms
    // Change on the place: back to its first question, the answers still there
    await sofar.getByTestId("ql-sofar-change-place").click();
    await at(page, "property");
    await expect(page.getByTestId("ql-kind-townhouse")).toHaveAttribute("aria-pressed", "true");
    await page.getByTestId("ql-kind-townhouse").click();
    await at(page, "beds");
    await expect(page.getByTestId("ql-bedrooms-2")).toHaveAttribute("aria-pressed", "true");
  });

  test("7 · the phone (390 × 780) is unchanged: its own header and strip, no rail, no key numbers", async ({ browser }) => {
    const ctx = await browser.newContext({ viewport: { width: 390, height: 780 }, isMobile: true, hasTouch: true });
    const page = await ctx.newPage();
    try {
      await openQuickLook(page);
      await expect(page.getByTestId("wzm")).toHaveAttribute("data-shell", "phone");
      await expect(page.getByTestId("wzm-head")).toBeVisible();
      await expect(page.getByTestId("wzm-strip")).toBeVisible();
      await expect(page.getByTestId("wz-rail")).toHaveCount(0);
      await expect(page.getByTestId("ql-picture")).toHaveCount(0);
      await expect(page.getByTestId("ql-sofar")).toHaveCount(0);
      await expect(page.locator(".wzm-key")).toHaveCount(0);
      await expect(page.getByTestId("wzm-keys")).toHaveCount(0);
      await fillQuickAddress(page, { suburb });
      await page.getByTestId("ql-jobtype-interior").tap();
      await at(page, "property");
      await expect(page.getByTestId("wzm-bar")).toBeVisible();
    } finally {
      await ctx.close();
    }
  });
});

test.describe("Desktop one-press — Paint Home", () => {
  test.use({ viewport: { width: 1366, height: 900 } });
  test("the same shell and screens on painthome.localhost from the hero's hand-off", async ({ page, baseURL }) => {
    const u = new URL(baseURL!);
    const phRoot = `${u.protocol}//painthome.localhost${u.port ? `:${u.port}` : ""}`;
    const parts = new URLSearchParams({ street: "14 Acacia Street", suburb, state: "VIC", postcode: "3070", address: `14 Acacia Street, ${suburb} VIC 3070`, mode: "home", src: "homepage_hero", scope: "interior" });
    await page.goto(`${phRoot}/estimate?${parts.toString()}`);
    await page.getByTestId("consent-decline").click({ timeout: 3_000 }).catch(() => {});
    await expect(page.locator("[data-ready='1']")).toBeAttached({ timeout: 20_000 });
    await expect(page.getByTestId("wzm")).toHaveAttribute("data-shell", "desktop", { timeout: 20_000 });
    await expect(page.getByTestId("ql-kind-commercial")).toHaveCount(0);
    await expect(page.locator("body")).not.toContainText("Paint Group");
    await expect(page.getByTestId("wzm-addr")).toContainText(suburb);
    await expect(page.getByTestId("ql-side")).toBeVisible();
    await page.keyboard.press("1");
    await at(page, "property");
    await expect(page.locator("[data-testid='wzm'] .wzm-screen .wzm-opt")).toHaveCount(3);
  });
});
