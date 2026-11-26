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
/** Laptop screens too long for one 768px screen (measured, not asserted) — see the fold test at the foot. */
const FOLD_LONG: string[] = [];
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
    // Tom, 26 Nov 2026: emptying the mobile or the email leaves the cursor where it is (it used to jump to the name)
    for (const id of ["gate-mobile", "gate-email"]) {
      await page.getByTestId(id).click();
      await page.keyboard.type("04");
      await page.waitForTimeout(250);
      await expect(page.getByTestId(id)).toBeFocused();
      await page.keyboard.press("Backspace");
      await page.keyboard.press("Backspace");
      await page.waitForTimeout(250);
      await expect(page.getByTestId(id)).toBeFocused();
    }
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
    // 18 Nov 2026: the quote stage is on, so the stage's words lead (the 5 Nov ruling: "your quote range", never "detailed price")
    await expect(page.locator(".wz-doors-head")).toHaveText("Want your quote range?");
    await expect(page.getByTestId("door-tighten")).toContainText("Get my quote range");
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
    // go-live S4 (M5): an outside job has no "What kind of place?" — Outside goes straight to the shape
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
    await expect(opts).toHaveCount(3); // Inside, Outside, Both
    await expect(opts.nth(0).locator(".wzm-key")).toHaveText("1");
    await expect(opts.nth(1).locator(".wzm-key")).toHaveText("2");
    await expect(opts.nth(2).locator(".wzm-key")).toHaveText("3");
    await expect(page.getByTestId("wzm-keys")).toContainText("choose");
    await expect(page.getByTestId("wzm-keys")).toContainText("back");
    // the address fields are fields: a digit typed there is typed, not a pick (Change opens them under the hero's chip)
    if (await page.getByTestId("wzm-addr-change").count()) await page.getByTestId("wzm-addr-change").click();
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
    // go-live S5 (M8): a colour change asks the bold question first — No is the first card
    await at(page, "bold");
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
    // Tom, 26 Nov 2026: the small print says the coats
    await expect(page.getByTestId("ql-colours-same")).toContainText("Typically 1 coat");
    await expect(page.getByTestId("ql-colours-new")).toContainText("(Typically 2 coats.) Also tick this if it's a colour match that hasn't been painted in a long time, or you think it needs 2 coats");
    // Change on the place: back to its first question, the answers still there
    await sofar.getByTestId("ql-sofar-change-place").click();
    await at(page, "property");
    await expect(page.getByTestId("ql-kind-townhouse")).toHaveAttribute("aria-pressed", "true");
    await page.getByTestId("ql-kind-townhouse").click();
    await at(page, "beds");
    await expect(page.getByTestId("ql-bedrooms-2")).toHaveAttribute("aria-pressed", "true");
  });

  test("6 · a reload says Welcome back ONCE (26 Nov 2026: the shell and the router each drew the banner)", async ({ page }) => {
    await openLaptop(page);
    await page.getByTestId("ql-jobtype-interior").click();
    await at(page, "property");
    await page.getByTestId("ql-kind-townhouse").click();
    await at(page, "beds");
    await page.reload();
    await expect(page.locator("[data-ready='1']")).toBeAttached({ timeout: 20_000 });
    await expect(page.getByTestId("wz-resume").first()).toContainText("Welcome back", { timeout: 20_000 });
    await expect(page.getByTestId("wz-resume")).toHaveCount(1);
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

/**
 * Tom, 26 Nov 2026: on a laptop the whole question sits above the fold where it can — the heading, every answer and
 * the Continue button, with no scrolling, on a 1366 × 768 screen (the common small laptop). Screens that cannot fit
 * without hurting the layout are named in LONG and only measured.
 */
const fold = (page: Page) => page.evaluate(() => {
  const root = document.querySelector("[data-testid='wzm']");
  if (!root) return { bottom: -1, view: window.innerHeight };
  const els = [...root.querySelectorAll(".wzm-screen .wzm-opt, .wzm-screen .wzm-chip, .wzm-screen input, .wzm-screen .wz-card, [data-testid='ql-next']")]
    .filter((el) => (el as HTMLElement).offsetParent !== null);
  const bottom = Math.max(0, ...els.map((el) => el.getBoundingClientRect().bottom + window.scrollY));
  return { bottom: Math.round(bottom), view: window.innerHeight };
});

test.describe("Desktop one-press — the question sits above the fold (26 Nov 2026)", () => {
  test.skip(!db, "needs SUPABASE_SERVICE_ROLE_KEY");
  test.use({ viewport: { width: 1366, height: 768 } });
  const LONG = new Set<string>(FOLD_LONG);

  test("8 · every answer and Continue are on screen without scrolling at 1366 × 768", async ({ page }) => {
    await openLaptop(page);
    const seen: Record<string, { bottom: number; view: number }> = {};
    const measure = async (id: string) => {
      await at(page, id);
      await page.waitForTimeout(450); // the screen's slide-in
      seen[id] = await fold(page);
    };
    await measure("what");
    await page.getByTestId("ql-jobtype-interior").click();
    await measure("property");
    await page.getByTestId("ql-kind-house").click();
    await measure("beds");
    await page.getByTestId("ql-bedrooms-4").click();
    await measure("storeys");
    await page.getByTestId("ql-storeys-double").click();
    await measure("job");
    await page.getByTestId("ql-scope-whole").click();
    await measure("surfaces");
    await page.getByTestId("ql-next").click();
    await measure("rooms");
    await page.getByTestId("ql-next").click();
    await measure("colours");
    await page.getByTestId("ql-colours-new").click();
    await measure("bold");
    await page.getByTestId("ql-bold-no").click();
    await measure("condition");
    await page.getByTestId("ql-condition-needs_work").click();
    await measure("living");
    await page.getByTestId("ql-occupied-no").click();
    await measure("details");
    console.log("FOLD " + JSON.stringify(seen));
    for (const [id, m] of Object.entries(seen)) {
      if (LONG.has(id)) continue;
      expect(m.bottom, `${id}: the last answer or Continue ends at ${m.bottom}px on a ${m.view}px screen`).toBeLessThanOrEqual(m.view);
    }
  });
  test("9 · outside: the nine shapes, each side, and the range card after the code all sit above the fold", async ({ page }) => {
    await openLaptop(page);
    await page.getByTestId("ql-jobtype-exterior").click();
    await at(page, "shape");
    await page.waitForTimeout(450);
    const shape = await fold(page);
    expect(shape.bottom, `shape ends at ${shape.bottom}px`).toBeLessThanOrEqual(shape.view);
    // no name is cut off by its neighbour: three across, the drawing over the name
    await expect(page.getByTestId("ql-ext-type").locator(".wzm-opt")).toHaveCount(9);
    const screenNow = () => page.getByTestId("wzm").getAttribute("data-mobile-screen");
    // walk on with whatever is pre-picked (or the first card), Continue where there is one
    for (let i = 0; i < 30; i++) {
      const id = await screenNow();
      if (id === "details") break;
      if (id?.startsWith("s-")) {
        await page.waitForTimeout(450);
        const side = await fold(page);
        expect(side.bottom, `${id} ends at ${side.bottom}px`).toBeLessThanOrEqual(side.view);
      }
      const next = page.getByTestId("ql-next");
      if (await next.isVisible().catch(() => false)) await next.click();
      else await page.locator(".wzm-screen .wzm-opt.on, .wzm-screen .wzm-opt").first().click();
      await expect.poll(screenNow, { timeout: 15_000 }).not.toBe(id);
    }
    await at(page, "details");
    await page.getByTestId("gate-name").fill("Fold Outside");
    await page.getByTestId("gate-mobile").fill(`04${String(Date.now()).slice(-8)}`);
    await page.getByTestId("gate-email").fill(`fold.${run}@example.com`);
    await page.getByTestId("ql-next").click();
    await passOtpIfShown(page);
    await expect(page.getByTestId("reveal")).toBeVisible({ timeout: 90_000 });
    await page.waitForTimeout(900); // the roller
    const card = await page.locator("[data-testid='reveal'] .wz-rv-card").evaluate((el) => Math.round(el.getBoundingClientRect().bottom + window.scrollY));
    expect(card, `the range card ends at ${card}px on a 768px screen`).toBeLessThanOrEqual(768);
    await expect(page.getByTestId("reveal-dock-tighten")).toBeInViewport();
    // the quote stage: the drawing sits on the RIGHT, over the sides list, and the question has the room it left
    await page.getByTestId("reveal-dock-tighten").click();
    await expect(page.getByTestId("quote-stage")).toBeVisible({ timeout: 60_000 });
    const box = async (sel: string) => (await page.locator(sel).first().boundingBox())!;
    const main = await box("[data-testid='quote-stage'] > .wzm-main");
    const pic = await box("[data-testid='q-rail-room']");
    const list = await box("[data-testid='q-rail-right']");
    expect(pic.x, "the drawing is right of the question").toBeGreaterThanOrEqual(main.x + main.width - 1);
    expect(pic.y + pic.height, "the drawing is above the sides list").toBeLessThanOrEqual(list.y + 20);
    expect(main.width, "the question column is wider than the old 640px").toBeGreaterThan(700);
    // Tom, 26 Nov 2026: no two boxes touch — on every card of the first side, each chip, counter and option keeps a gap
    const touching = () => page.evaluate(() => {
      const els = [...document.querySelectorAll(".wzm-screen .wzm-chip, .wzm-screen .wzm-step, .wzm-screen .wzm-opt, .wzm-screen .wzm-field")]
        .filter((el) => (el as HTMLElement).offsetParent !== null).map((el) => ({ n: el.getAttribute("data-testid") ?? el.className, r: el.getBoundingClientRect() }));
      const bad: string[] = [];
      for (let i = 0; i < els.length; i++) for (let j = i + 1; j < els.length; j++) {
        const a = els[i].r, b = els[j].r;
        const dx = Math.max(a.left, b.left) - Math.min(a.right, b.right), dy = Math.max(a.top, b.top) - Math.min(a.bottom, b.bottom);
        if (dx < 5 && dy < 5) bad.push(`${els[i].n} / ${els[j].n} (${Math.round(dx)}, ${Math.round(dy)})`);
      }
      return bad;
    });
    expect(await touching(), "the size card").toEqual([]);
    await page.getByTestId("wzm-foot").getByRole("button").first().click();
    await expect(page.getByTestId("q-side-parts")).toBeVisible({ timeout: 20_000 });
    expect(await touching(), "On this side").toEqual([]);
  });
});
