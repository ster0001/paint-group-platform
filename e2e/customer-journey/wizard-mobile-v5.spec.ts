import { expect, type Page } from "@playwright/test";
import { randomBytes } from "node:crypto";
import { mkdirSync } from "node:fs";
import { test } from "../helpers";
import { serviceClient } from "../fixtures/woLoop";
import { MONEY_RANGE } from "./drive";

/**
 * Wizard mobile v5 — session 2 (brief §2, acceptance §9 items 1–3), as an
 * ANONYMOUS customer on a phone (390 × 780, touch) on painthome.localhost
 * (Chromium resolves *.localhost). Modelled on e2e/marketing/painthome-wizard.spec.ts.
 *
 *  1. The screens, in the brief's order, with its headings and sub-lines;
 *     a unit skips storeys; Back retraces every screen; the answers are
 *     still there on the way back; Show my range needs the details and
 *     then shows a range (the submit works from the phone's screens).
 *  2. Single-choice taps advance themselves (~250ms); only surfaces, rooms
 *     and details carry a bottom bar; the bar clears the safe area.
 *  3. The heading is the first thing in view on every screen; no control
 *     overlaps an option; the floating talk pill and the sticky picture
 *     panel are gone on a phone.
 *  4. An outside job skips job and rooms and goes to the exterior brief's
 *     screens, rendered as they are with a Continue bar (§2.4).
 *  5. Answers persist across a reload ("Welcome back" restores the screen),
 *     and every screen writes `wizard_step_viewed {step, breakpoint: mobile}`.
 *
 * WIZARD_MOBILE_SHOTS=1 also saves a screenshot of steps 1–11 at 390px to
 * docs/wizard-mobile/ (the brief's acceptance artefact).
 */
const db = serviceClient();
const SHOTS = process.env.WIZARD_MOBILE_SHOTS ? "docs/wizard-mobile" : null;
if (SHOTS) mkdirSync(SHOTS, { recursive: true });

const ORDER = ["what", "property", "beds", "storeys", "job", "surfaces", "rooms", "colours", "condition", "living", "details"] as const;
const HEADINGS: Record<(typeof ORDER)[number], string> = {
  what: "What are we painting?", property: "What kind of place is it?", beds: "How many bedrooms?", storeys: "One storey or two?",
  job: "What's the job?", surfaces: "What's being painted?", rooms: "We're painting these rooms", colours: "Colours?",
  condition: "How are the walls looking?", living: "Anyone living there while we paint?", details: "Where shall we send your range?",
};

test.describe("Wizard mobile v5 — the phone's screens (session 2)", () => {
  test.skip(!db, "needs SUPABASE_SERVICE_ROLE_KEY");
  test.use({ viewport: { width: 390, height: 780 }, isMobile: true, hasTouch: true });

  const run = randomBytes(3).toString("hex");
  const suburb = `E2E PHMobile ${run}`;
  let phRoot = "";

  test.beforeAll(async ({ baseURL }) => {
    const u = new URL(baseURL!);
    phRoot = `${u.protocol}//painthome.localhost${u.port ? `:${u.port}` : ""}`;
  });
  test.afterAll(async () => {
    if (!db) return;
    const { data: rows } = await db.from("wizard_drafts").select("estimate_id").eq("suburb", suburb);
    await db.from("wizard_drafts").delete().eq("suburb", suburb);
    for (const r of rows ?? []) if (r.estimate_id) await db.from("estimates").delete().eq("id", r.estimate_id);
    await db.from("estimates").delete().ilike("title", `%${suburb}%`);
  });

  /** The Paint Home hero's hand-off: a resolved pick on the URL, the suburb unique to this run (the handle the clean-up uses). */
  const open = async (page: Page, scope: "interior" | "exterior" = "interior") => {
    const parts = new URLSearchParams({ street: "14 Acacia Street", suburb, state: "VIC", postcode: "3070", address: `14 Acacia Street, ${suburb} VIC 3070`, mode: "home", src: "homepage_hero", scope });
    await page.goto(`${phRoot}/estimate?${parts.toString()}`);
    await page.getByTestId("consent-decline").click({ timeout: 3_000 }).catch(() => {});
    await expect(page.locator("[data-ready='1']")).toBeAttached({ timeout: 20_000 });
    await expect(page.getByTestId("wzm")).toBeVisible({ timeout: 20_000 });
  };
  const at = (page: Page, id: string) => expect(page.locator(`[data-mobile-screen='${id}']`)).toBeVisible({ timeout: 10_000 });
  const heading = (page: Page) => page.getByTestId("wzm-h1");
  const shot = async (page: Page, n: number, id: string) => {
    if (!SHOTS) return;
    await page.waitForTimeout(450); // the screen's entrance (.28s) settles first
    await page.screenshot({ path: `${SHOTS}/${String(n).padStart(2, "0")}-${id}.png`, animations: "disabled" });
  };

  test("1 · the eleven question screens in order, Back retraces them with the answers kept, and the details show a range", async ({ page }) => {
    test.setTimeout(240_000);
    await open(page);
    // §2 screen 1: the address chip with Change, Inside / Outside, no Continue, no rail, no pill, no picture panel
    await at(page, "what");
    await expect(heading(page)).toHaveText(HEADINGS.what);
    await expect(page.getByTestId("wzm-sub")).toHaveText("Your range in under a minute.");
    await expect(page.getByTestId("wzm-addr")).toContainText(suburb);
    await expect(page.getByTestId("wzm-addr-change")).toBeVisible();
    await expect(page.getByTestId("ql-jobtype-both")).toHaveCount(0);
    await expect(page.getByTestId("ql-next")).toHaveCount(0);
    await expect(page.getByTestId("wz-rail")).toHaveCount(0);
    await expect(page.getByTestId("ql-talk")).toHaveCount(0);
    await expect(page.locator(".wz-pic")).toHaveCount(0);
    await expect(page.getByTestId("wzm-contact")).toHaveText("Contact");
    await expect(page.getByTestId("wzm-bar")).toHaveAttribute("style", /width:\s*0%/);
    await expect(page.locator("body")).not.toContainText("Paint Group");
    await shot(page, 1, "what");

    await page.getByTestId("ql-jobtype-interior").tap();
    await at(page, "property");
    await expect(heading(page)).toHaveText(HEADINGS.property);
    await expect(page.getByTestId("wzm-sub")).toHaveText("Near enough is fine.");
    await expect(page.getByTestId("ql-kind-commercial")).toHaveCount(0);
    await shot(page, 2, "property");
    await page.getByTestId("ql-kind-house").tap();
    await at(page, "beds");
    await expect(heading(page)).toHaveText(HEADINGS.beds);
    await shot(page, 3, "beds");
    await page.getByTestId("ql-bedrooms-4").tap();
    await at(page, "storeys");
    await expect(heading(page)).toHaveText(HEADINGS.storeys);
    await expect(page.getByTestId("wzm-sub")).toHaveText("Two adds the stairwell and upper hall.");
    await shot(page, 4, "storeys");
    await page.getByTestId("ql-storeys-single").tap();
    await at(page, "job");
    await expect(heading(page)).toHaveText(HEADINGS.job);
    await expect(page.getByTestId("ql-scope-walls_ceilings")).toHaveCount(0);
    await shot(page, 5, "job");
    await page.getByTestId("ql-scope-whole").tap();
    // surfaces: the bar appears, every surface pre-ticked
    await at(page, "surfaces");
    await expect(heading(page)).toHaveText(HEADINGS.surfaces);
    await expect(page.getByTestId("ql-next")).toHaveText("Continue");
    for (const k of ["walls", "ceilings", "skirting", "doors", "windows"]) await expect(page.getByTestId(`ql-surface-${k}`)).toHaveAttribute("aria-pressed", "true");
    await shot(page, 6, "surfaces");
    await page.getByTestId("ql-surface-ceilings").tap();
    await expect(page.getByTestId("ql-surface-ceilings")).toHaveAttribute("aria-pressed", "false");
    await page.getByTestId("ql-next").tap();
    // rooms: generated from four bedrooms, the extras unticked, + Another room
    await at(page, "rooms");
    await expect(heading(page)).toHaveText(HEADINGS.rooms);
    await expect(page.getByTestId("wzm-sub")).toHaveText("We've guessed from the bedrooms. Untick any, add any.");
    for (const name of ["Bed 1", "Bed 2", "Bed 3", "Bed 4", "Living room", "Kitchen / Meals", "Bathroom", "Laundry", "Hall & Entry"]) {
      await expect(page.getByRole("button", { name, exact: true })).toHaveAttribute("aria-pressed", "true");
    }
    await expect(page.getByTestId("ql-room-extra-study")).toHaveAttribute("aria-pressed", "false");
    await expect(page.getByTestId("ql-room-extra-garage")).toHaveAttribute("aria-pressed", "false");
    await expect(page.getByTestId("ql-add-room-open")).toContainText("Another room");
    await shot(page, 7, "rooms");
    await page.getByTestId("ql-room-extra-study").tap();
    await expect(page.getByTestId("ql-room-extra-study")).toHaveAttribute("aria-pressed", "true");
    await page.getByTestId("ql-next").tap();
    await at(page, "colours");
    await expect(heading(page)).toHaveText(HEADINGS.colours);
    await expect(page.getByTestId("ql-next")).toHaveCount(0);
    await shot(page, 8, "colours");
    await page.getByTestId("ql-colours-same").tap();
    await at(page, "condition");
    await expect(heading(page)).toHaveText(HEADINGS.condition);
    await expect(page.getByTestId("wzm-sub")).toHaveText("Honest is best — it sets the prep.");
    await shot(page, 9, "condition");
    await page.getByTestId("ql-condition-wear").tap();
    await at(page, "living");
    await expect(heading(page)).toHaveText(HEADINGS.living);
    await shot(page, 10, "living");
    await page.getByTestId("ql-occupied-no").tap();
    await at(page, "details");
    await expect(heading(page)).toHaveText(HEADINGS.details);
    await expect(page.getByTestId("ql-next")).toHaveText("Show my range");
    await expect(page.getByTestId("ql-next")).toBeDisabled();
    await expect(page.getByTestId("wzm-hint")).toHaveText("Appears instantly");
    // §2.1: index 10 of 11 question screens → 50%; the gate is at 55
    await expect(page.getByTestId("wzm-bar")).toHaveAttribute("style", /width:\s*50%/);
    await shot(page, 11, "details");

    // Back retraces every screen, and the answers are still there
    const back = [...ORDER].reverse().slice(1);
    for (const id of back) {
      await page.getByTestId("wzm-back").tap();
      await at(page, id);
      await expect(heading(page)).toHaveText(HEADINGS[id]);
    }
    await expect(page.getByTestId("wzm-back")).toBeDisabled();
    await page.getByTestId("ql-jobtype-interior").tap();
    await at(page, "property");
    await expect(page.getByTestId("ql-kind-house")).toHaveAttribute("aria-pressed", "true");
    await page.getByTestId("ql-kind-house").tap();
    await at(page, "beds");
    await expect(page.getByTestId("ql-bedrooms-4")).toHaveAttribute("aria-pressed", "true");
    await page.getByTestId("ql-bedrooms-4").tap();
    await at(page, "storeys");
    await page.getByTestId("ql-storeys-single").tap();
    await at(page, "job");
    await page.getByTestId("ql-scope-whole").tap();
    await at(page, "surfaces");
    await expect(page.getByTestId("ql-surface-ceilings")).toHaveAttribute("aria-pressed", "false");
    await page.getByTestId("ql-next").tap();
    await at(page, "rooms");
    await expect(page.getByTestId("ql-room-extra-study")).toHaveAttribute("aria-pressed", "true");
    await page.getByTestId("ql-next").tap();
    await at(page, "colours");
    await expect(page.getByTestId("ql-colours-same")).toHaveAttribute("aria-pressed", "true");
    await page.getByTestId("ql-colours-same").tap();
    await at(page, "condition");
    await page.getByTestId("ql-condition-wear").tap();
    await at(page, "living");
    await page.getByTestId("ql-occupied-no").tap();
    await at(page, "details");

    // the details (D17, 28 Oct): a FULL name, a 10-digit mobile and an email enable Show my range — a first name alone does not
    await page.getByTestId("gate-name").fill("Mobile");
    await page.getByTestId("gate-mobile").fill("0412 345 678");
    await page.getByTestId("gate-email").fill(`ph.mobile.${run}@example.com`);
    await expect(page.getByTestId("ql-next")).toBeDisabled();
    await page.getByTestId("gate-name").fill("Mobile Tester");
    await page.getByTestId("gate-mobile").fill("0412 345 67");
    await expect(page.getByTestId("ql-next")).toBeDisabled();
    await page.getByTestId("gate-mobile").fill(`04${String(Date.now()).slice(-8)}`);
    await expect(page.getByTestId("ql-next")).toBeEnabled({ timeout: 30_000 });
    await page.getByTestId("ql-next").tap();
    // S4: on a phone the range is the mobile gate
    const gate = page.getByTestId("wzm-gate");
    const bounced = page.locator(".wz-err");
    await expect(gate.or(bounced)).toBeVisible({ timeout: 90_000 });
    if (await bounced.count()) throw new Error(`quick look submit failed: ${await bounced.first().innerText()}`);
    await expect(page.getByTestId("gate-range")).toHaveText(MONEY_RANGE);
    // the answers reached the price: four bedrooms, the same colours, some wear
    await expect(page.getByTestId("gate-basis")).toContainText(/4-bedroom/);
    await expect(page.getByTestId("gate-basis")).toContainText(/same colours/);
    await expect(page.locator("body")).not.toContainText("Paint Group");
  });

  test("2 · a unit skips storeys; an outside job skips job and rooms and takes the exterior brief's screens with a Continue bar", async ({ page }) => {
    test.setTimeout(120_000);
    await open(page);
    await at(page, "what");
    await page.getByTestId("ql-jobtype-interior").tap();
    await at(page, "property");
    await page.getByTestId("ql-kind-unit_apartment").tap();
    await at(page, "beds");
    await page.getByTestId("ql-bedrooms-2").tap();
    await at(page, "job");
    await page.getByTestId("wzm-back").tap();
    await at(page, "beds");
    await page.getByTestId("wzm-back").tap();
    await at(page, "property");
    await page.getByTestId("wzm-back").tap();
    await at(page, "what");
    // outside: the place, then the exterior v2 steps as they are
    await page.getByTestId("ql-jobtype-exterior").tap();
    await at(page, "property");
    await page.getByTestId("ql-kind-house").tap();
    // Exterior on mobile v5 (S1): the home step is three screens of its own — the shape first, no Continue bar
    await at(page, "shape");
    await expect(page.locator("[data-quick-step='home']")).toBeVisible();
    await expect(page.getByRole("heading", { name: "What kind of home is it?" })).toBeVisible();
    await expect(page.getByTestId("ql-next")).toHaveCount(0);
    await expect(page.locator("[data-mobile-screen='job']")).toHaveCount(0);
    await expect(page.locator("[data-mobile-screen='rooms']")).toHaveCount(0);
    await expect(page.getByTestId("ql-talk")).toHaveCount(0);
    // a shape advances itself to the size; back returns to the shape
    await page.getByTestId("ql-ext-type-cal").tap();
    await at(page, "size");
    await page.getByTestId("wzm-back").tap();
    await at(page, "shape");
  });

  test("3 · the heading is first in view, nothing overlaps an option, the bar clears the safe area, and the pill and picture panel are gone", async ({ page }) => {
    test.setTimeout(120_000);
    await open(page);
    const measure = () => page.evaluate(() => {
      const r = (el: Element | null) => el?.getBoundingClientRect() ?? null;
      const head = r(document.querySelector("[data-testid='wzm-head']"))!;
      const h1 = r(document.querySelector("[data-testid='wzm-h1']"))!;
      const foot = r(document.querySelector("[data-testid='wzm-foot']"));
      // the options as they sit when scrolled to the bottom: a long list may run under the bar until then, never after
      if (foot) window.scrollTo({ top: document.documentElement.scrollHeight, behavior: "instant" as ScrollBehavior });
      const opts = [...document.querySelectorAll(".wzm-screen [data-testid^='ql-']")].map((e) => e.getBoundingClientRect()).filter((b) => b.width > 0);
      const overlapsFoot = foot ? opts.some((o) => o.bottom > foot.top + 24 && o.top < foot.bottom && o.right > foot.left && o.left < foot.right) : false;
      window.scrollTo({ top: 0, behavior: "instant" as ScrollBehavior });
      let safeArea = false;
      for (const sheet of [...document.styleSheets]) {
        let rules: CSSRuleList | null = null;
        try { rules = sheet.cssRules; } catch { rules = null; }
        for (const rule of rules ? [...rules] : []) if (rule.cssText.includes(".wzm-foot") && rule.cssText.includes("safe-area-inset-bottom")) safeArea = true;
      }
      return { headBottom: head.bottom, h1Top: h1.top, h1Bottom: h1.bottom, vh: window.innerHeight, docW: document.documentElement.scrollWidth, overlapsFoot, foot: Boolean(foot), safeArea, scrollY: window.scrollY };
    });
    const check = async (id: string, bar: boolean) => {
      await at(page, id);
      const m = await measure();
      expect(m.scrollY, `${id}: the screen starts at the top`).toBe(0);
      expect(m.h1Top, `${id}: the heading is below the header`).toBeGreaterThanOrEqual(m.headBottom);
      expect(m.h1Bottom, `${id}: the heading is in view`).toBeLessThan(m.vh * 0.5);
      expect(m.docW, `${id}: nothing wider than the phone`).toBeLessThanOrEqual(390);
      expect(m.foot, `${id}: the bottom bar is ${bar ? "there" : "absent"}`).toBe(bar);
      expect(m.overlapsFoot, `${id}: no option under the bar`).toBe(false);
      if (bar) expect(m.safeArea, `${id}: the bar pads the safe area`).toBe(true);
      await expect(page.getByTestId("ql-talk")).toHaveCount(0);
      await expect(page.locator(".wz-pic")).toHaveCount(0);
      await expect(page.getByTestId("ql-side")).toHaveCount(0);
    };
    await check("what", false);
    await page.getByTestId("ql-jobtype-interior").tap();
    await check("property", false);
    await page.getByTestId("ql-kind-townhouse").tap();
    await check("beds", false);
    await page.getByTestId("ql-bedrooms-5").tap();
    await check("storeys", false);
    await page.getByTestId("ql-storeys-double").tap();
    await check("job", false);
    await page.getByTestId("ql-scope-some_rooms").tap();
    await check("surfaces", true);
    await page.getByTestId("ql-next").tap();
    await check("rooms", true);
    // Some rooms: the heading changes and only the first two rooms are ticked (§2.3); two storeys adds the landing
    await expect(heading(page)).toHaveText("Which rooms?");
    await expect(page.getByRole("button", { name: "Bed 1", exact: true })).toHaveAttribute("aria-pressed", "true");
    await expect(page.getByRole("button", { name: "Bed 2", exact: true })).toHaveAttribute("aria-pressed", "true");
    await expect(page.getByRole("button", { name: "Bed 3", exact: true })).toHaveAttribute("aria-pressed", "false");
    await expect(page.getByRole("button", { name: "Landing & stairs", exact: true })).toBeVisible();
    // every listed room off and nothing added → Continue waits
    for (const name of ["Bed 1", "Bed 2"]) await page.getByRole("button", { name, exact: true }).tap();
    await expect(page.getByTestId("ql-next")).toBeDisabled();
    await page.getByRole("button", { name: "Bed 1", exact: true }).tap();
    await expect(page.getByTestId("ql-next")).toBeEnabled();
    await page.getByTestId("ql-next").tap();
    await check("colours", false);
    await page.getByTestId("ql-colours-deciding").tap();
    await check("condition", false);
    await page.getByTestId("ql-condition-needs_work").tap();
    await check("living", false);
    await page.getByTestId("ql-occupied-yes").tap();
    await check("details", true);
  });

  test("4 · the answers survive a reload (Welcome back lands on the same screen), and every screen writes its mobile step-viewed event", async ({ page }) => {
    test.setTimeout(120_000);
    const events: Array<{ type: string; payload: Record<string, unknown> }> = [];
    page.on("request", (req) => {
      if (req.method() === "POST" && req.url().includes("/api/wizard/event")) {
        try { events.push(JSON.parse(req.postData() ?? "{}") as { type: string; payload: Record<string, unknown> }); } catch { /* not json */ }
      }
    });
    await open(page);
    await at(page, "what");
    await page.getByTestId("ql-jobtype-interior").tap();
    await at(page, "property");
    await page.getByTestId("ql-kind-house").tap();
    await at(page, "beds");
    await page.getByTestId("ql-bedrooms-5").tap();
    await at(page, "storeys");
    await page.getByTestId("ql-storeys-double").tap();
    await at(page, "job");
    await page.getByTestId("ql-scope-whole").tap();
    await at(page, "surfaces");
    await page.getByTestId("ql-next").tap();
    await at(page, "rooms");
    await page.getByTestId("ql-next").tap();
    await at(page, "colours");
    // the Contact pill opens the talk sheet (the Contact sheet itself is session 5) and writes contact_opened
    await page.getByTestId("wzm-contact").tap();
    await expect(page.getByTestId("talk-sheet")).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(page.getByTestId("talk-sheet")).toHaveCount(0);
    // let the autosave (2.5s debounce) write the draft, then come back
    await page.waitForTimeout(3_500);
    await page.reload();
    await expect(page.locator("[data-ready='1']")).toBeAttached({ timeout: 20_000 });
    await expect(page.getByTestId("wz-resume")).toContainText("Welcome back", { timeout: 20_000 });
    await at(page, "colours");
    await page.getByTestId("wzm-back").tap();
    await at(page, "rooms");
    await expect(page.getByRole("button", { name: "Bed 5", exact: true })).toHaveAttribute("aria-pressed", "true");
    await expect(page.getByRole("button", { name: "Landing & stairs", exact: true })).toHaveAttribute("aria-pressed", "true");
    await page.getByTestId("wzm-back").tap();
    await at(page, "surfaces");
    await page.getByTestId("wzm-back").tap();
    await at(page, "job");
    await page.getByTestId("wzm-back").tap();
    await at(page, "storeys");
    await expect(page.getByTestId("ql-storeys-double")).toHaveAttribute("aria-pressed", "true");

    const viewed = events.filter((e) => e.type === "wizard_step_viewed").map((e) => `${e.payload.step}:${e.payload.breakpoint}`);
    for (const id of ["what", "property", "beds", "storeys", "job", "surfaces", "rooms", "colours"]) expect(viewed, `step viewed: ${id}`).toContain(`${id}:mobile`);
    expect(viewed.filter((v) => v.endsWith(":desktop")), "nothing is counted as a desktop view on a phone").toEqual([]);
    expect(events.some((e) => e.type === "contact_opened" && e.payload.step === "colours"), "contact_opened from the pill").toBe(true);
  });
});
