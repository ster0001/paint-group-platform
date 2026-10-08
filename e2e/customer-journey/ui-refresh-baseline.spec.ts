import { test, expect, type Browser, type Page } from "@playwright/test";
import { mkdirSync } from "node:fs";
import path from "node:path";
import { createClient } from "@supabase/supabase-js";
import { driveNoPlanWizard, fillQuickAddress, openQuickLook, openScopeEditor, passGateIfShown, quickNext, MONEY_RANGE } from "./drive";

/**
 * Wizard UI refresh, S0 — the "before" set.
 *
 * As an anonymous customer at 390px and 1440px, a full-page screenshot of every
 * row of the brief's §7.13 (journey screens) and §7.12 (supporting pieces), so
 * the S9 PR can pair each one with its "after". It asserts only that each
 * screen was reached; the pictures are the product.
 *
 * Re-run for the after set with `UI_REFRESH_SET=after`.
 *
 * Not `test-results/` (Tom, 9 Oct): Playwright empties
 * `test-results/` at the start of EVERY run, so the before set would be gone
 * long before S9 needed it. The shots go to `ui-refresh-shots/<set>/<width>/`
 * instead (gitignored), and the ledger records the difference.
 *
 * Rows with no customer path in the quick look are listed in the ledger, not
 * faked here: the guardrail outcome (HardStop — only the old pages ask the
 * asbestos / pre-1970 questions), the "From what you told us" tag, and the
 * trade lane (⚑ 20).
 */
const SET = process.env.UI_REFRESH_SET ?? "before";
const ROOT = path.join(process.cwd(), "ui-refresh-shots", SET);
const WIDTHS = [
  { w: 390, h: 844, label: "390" },
  { w: 1440, h: 900, label: "1440" },
] as const;

type Width = (typeof WIDTHS)[number];

async function shot(page: Page, width: Width, name: string) {
  const dir = path.join(ROOT, width.label);
  mkdirSync(dir, { recursive: true });
  // Let the step's entrance motion finish so the picture is the settled screen.
  await page.waitForTimeout(600);
  await page.screenshot({ path: path.join(dir, `${name}.png`), fullPage: true, animations: "disabled" });
}

async function newPage(browser: Browser, width: Width) {
  const ctx = await browser.newContext({ viewport: { width: width.w, height: width.h }, deviceScaleFactor: 1, isMobile: width.w < 900, hasTouch: width.w < 900 });
  return ctx.newPage();
}

const estimateId = (page: Page) => new URL(page.url()).searchParams.get("id");

async function toSegment(page: Page) {
  await openQuickLook(page);
  await fillQuickAddress(page);
  await quickNext(page);
  await expect(page.locator("[data-quick-step='place']")).toBeVisible({ timeout: 20_000 });
  await page.getByTestId("ql-kind-commercial").click();
  await quickNext(page);
  await expect(page.locator("[data-quick-step='segment']")).toBeVisible({ timeout: 20_000 });
}

const serviceUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const db = serviceUrl && serviceKey ? createClient(serviceUrl, serviceKey) : null;
const briefEmails: string[] = [];

test.describe("ui refresh baseline screenshots", () => {
  test.afterAll(async () => {
    // The strata booking files an account + estimate by email; the global
    // teardown sweeps this run's anonymous users, this removes the brief's rows.
    if (!db) return;
    for (const email of briefEmails) {
      const { data: accts, error } = await db.from("accounts").select("id").eq("email", email);
      if (error) throw new Error(`baseline cleanup: ${error.message}`);
      const ids = (accts ?? []).map((a) => a.id as string);
      if (!ids.length) continue;
      const del = await db.from("estimates").delete().in("account_id", ids);
      if (del.error) throw new Error(`baseline cleanup: ${del.error.message}`);
    }
  });

  for (const width of WIDTHS) {
    test.describe(`${width.label}px`, () => {
      test("home inside: six steps, range, room by room, finalise, book, sent", async ({ browser }) => {
        test.setTimeout(420_000);
        const page = await newPage(browser, width);

        await openQuickLook(page);
        await shot(page, width, "01-start");
        await fillQuickAddress(page);
        await quickNext(page);
        await expect(page.locator("[data-quick-step='place']")).toBeVisible({ timeout: 20_000 });
        await shot(page, width, "02-place");
        await quickNext(page);
        await expect(page.locator("[data-quick-step='job']")).toBeVisible({ timeout: 20_000 });
        await shot(page, width, "03-job");
        await quickNext(page);
        await expect(page.locator("[data-quick-step='rooms']")).toBeVisible({ timeout: 30_000 });
        await shot(page, width, "04-rooms");
        await quickNext(page);
        await expect(page.locator("[data-quick-step='condition']")).toBeVisible({ timeout: 20_000 });
        await shot(page, width, "05-condition");
        await quickNext(page);

        const gate = page.locator("[data-quick-step='gate']");
        await expect(gate.or(page.getByTestId("reveal"))).toBeVisible({ timeout: 90_000 });
        if (await gate.count()) await shot(page, width, "06-gate");
        await passGateIfShown(page, { email: `ui.refresh.${Date.now()}@example.com` });
        await expect(page.getByTestId("reveal-range")).toHaveText(MONEY_RANGE, { timeout: 90_000 });
        await shot(page, width, "07-reveal");

        await page.getByTestId("door-tighten").click();
        await openScopeEditor(page);
        const id = estimateId(page);
        expect(id, "editor URL carries the estimate id").toBeTruthy();
        await shot(page, width, "08-editor");

        const firstRoom = page.locator(".sc-rc[data-room]").first();
        const areaId = await firstRoom.getAttribute("data-room");
        expect(areaId).toBeTruthy();
        const extrasYes = page.getByTestId(`room-extras-${areaId}-yes`);
        if (await extrasYes.count()) {
          await extrasYes.scrollIntoViewIfNeeded();
          await extrasYes.click();
          await shot(page, width, "09-room-extras");
        }
        await page.getByTestId(`spot-open-${areaId}`).scrollIntoViewIfNeeded();
        await page.getByTestId(`spot-open-${areaId}`).click();
        await expect(page.getByTestId("offer-damage")).toBeVisible({ timeout: 15_000 });
        await shot(page, width, "10-room-spots-offer");

        await page.getByTestId("assistant-widget-launch").click();
        await expect(page.getByTestId("assistant-widget-panel")).toBeVisible({ timeout: 15_000 });
        await shot(page, width, "11-assistant-widget");
        await page.reload();
        await openScopeEditor(page);

        await page.getByTestId("scope-finalise").click();
        await expect(page.getByTestId("finalise-prompt")).toBeVisible({ timeout: 15_000 });
        await shot(page, width, "12-finalise-prompt");
        await page.getByTestId("prompt-book").click();
        await expect(page.getByTestId("book-page")).toBeVisible({ timeout: 30_000 });
        await expect(page.getByTestId("reach-strip")).toBeVisible();
        await shot(page, width, "13-book-reach-strip");

        await page.goto(`/estimate/finish?id=${id}`);
        await expect(page.getByTestId("finish")).toBeVisible({ timeout: 30_000 });
        await shot(page, width, "14-finish");
        await page.getByTestId("finish-book_visit").click();
        await expect(page.getByTestId("contact-card")).toBeVisible({ timeout: 15_000 });
        await shot(page, width, "15-contact-card");

        await page.goto(`/estimate/finish?id=${id}`);
        await expect(page.getByTestId("finish")).toBeVisible({ timeout: 30_000 });
        await page.getByTestId("finish-send_for_confirmation").click();
        await page.waitForURL(/\/estimate\/sent/, { timeout: 30_000 });
        await expect(page.getByTestId("sent")).toBeVisible({ timeout: 30_000 });
        await shot(page, width, "16-sent");
        await page.context().close();
      });

      test("sheets on the steps: chat, talk it through, save and book", async ({ browser }) => {
        test.setTimeout(180_000);
        let page = await newPage(browser, width);
        await openQuickLook(page);
        await page.getByTestId("wz-chat-bubble").click();
        await expect(page.getByTestId("wz-describe")).toBeVisible({ timeout: 15_000 });
        await shot(page, width, "20-chat");
        await page.context().close();

        page = await newPage(browser, width);
        await openQuickLook(page);
        await fillQuickAddress(page);
        await quickNext(page);
        await expect(page.locator("[data-quick-step='place']")).toBeVisible({ timeout: 20_000 });
        await page.getByTestId("ql-book").click();
        await expect(page.getByTestId("talk-sheet")).toBeVisible({ timeout: 15_000 });
        await shot(page, width, "21-talk-sheet");
        await page.context().close();

        page = await newPage(browser, width);
        await openQuickLook(page);
        await fillQuickAddress(page);
        await quickNext(page);
        await expect(page.locator("[data-quick-step='place']")).toBeVisible({ timeout: 20_000 });
        await quickNext(page);
        await expect(page.locator("[data-quick-step='job']")).toBeVisible({ timeout: 20_000 });
        await page.getByTestId("save-and-book-pill").first().click();
        await expect(page.getByTestId("sab-email")).toBeVisible({ timeout: 15_000 });
        await shot(page, width, "22-save-and-book");
        await page.context().close();
      });

      test("floorplan upload on the place step", async ({ browser }) => {
        test.setTimeout(120_000);
        const page = await newPage(browser, width);
        await openQuickLook(page);
        await fillQuickAddress(page);
        await quickNext(page);
        await expect(page.locator("[data-quick-step='place']")).toBeVisible({ timeout: 20_000 });
        const [chooser] = await Promise.all([page.waitForEvent("filechooser"), page.getByTestId("ql-plan-upload").click()]);
        await chooser.setFiles("e2e/fixtures/not-a-plan-a.png");
        await expect(page.getByTestId("ql-plan-upload")).toContainText(/Floorplan uploaded/, { timeout: 60_000 });
        await shot(page, width, "23-floorplan-uploaded");
        await page.context().close();
      });

      test("home outside: outside, sides, range, side by side", async ({ browser }) => {
        test.setTimeout(300_000);
        const page = await newPage(browser, width);
        await openQuickLook(page);
        await fillQuickAddress(page);
        await page.getByTestId("ql-jobtype-exterior").click();
        await quickNext(page);
        await expect(page.locator("[data-quick-step='place']")).toBeVisible({ timeout: 20_000 });
        await shot(page, width, "30-ext-place");
        await quickNext(page);
        await expect(page.locator("[data-quick-step='outside']")).toBeVisible({ timeout: 20_000 });
        await page.getByTestId("ql-ext-el-body").click();
        await page.getByTestId("ql-ext-mat-weatherboards").click();
        await shot(page, width, "31-ext-outside");
        await quickNext(page);
        await expect(page.locator("[data-quick-step='sides']")).toBeVisible({ timeout: 20_000 });
        await shot(page, width, "32-ext-sides");
        await quickNext(page);
        await passGateIfShown(page, { email: `ui.refresh.ext.${Date.now()}@example.com` });
        await expect(page.getByTestId("reveal-range")).toHaveText(MONEY_RANGE, { timeout: 90_000 });
        await shot(page, width, "33-ext-reveal");
        await page.getByTestId("door-tighten").click();
        await expect(page.locator(".sd-card").first()).toBeVisible({ timeout: 60_000 });
        await expect(page.locator("[data-ready='1']")).toBeAttached({ timeout: 20_000 });
        await shot(page, width, "34-ext-sides-editor");
        await page.context().close();
      });

      test("home both: choice screen, range with parts, stacked editor", async ({ browser }) => {
        test.setTimeout(360_000);
        let page = await newPage(browser, width);
        await openQuickLook(page);
        await fillQuickAddress(page);
        await page.getByTestId("ql-jobtype-both").click();
        await quickNext(page);
        await expect(page.locator("[data-quick-step='both']")).toBeVisible({ timeout: 20_000 });
        await shot(page, width, "40-both-choice");
        await page.context().close();

        page = await newPage(browser, width);
        await driveNoPlanWizard(page, { jobType: "both", stopAtReveal: true });
        await shot(page, width, "41-both-reveal");
        await page.getByTestId("door-tighten").click();
        await expect(page.locator(".sc-rc[data-room]").first()).toBeVisible({ timeout: 60_000 });
        await expect(page.locator(".sd-card").first()).toBeVisible({ timeout: 60_000 });
        await shot(page, width, "42-both-stacked-editor");
        await page.context().close();
      });

      test("commercial ranged (office): space, areas, job, range, area by area", async ({ browser }) => {
        test.setTimeout(300_000);
        const page = await newPage(browser, width);
        await toSegment(page);
        await page.getByTestId("ql-segment-office").click();
        await shot(page, width, "50-com-segment");
        await quickNext(page);
        await expect(page.locator("[data-quick-step='com_areas']")).toBeVisible({ timeout: 20_000 });
        await shot(page, width, "51-com-areas");
        await quickNext(page);
        await expect(page.locator("[data-quick-step='com_job']")).toBeVisible({ timeout: 20_000 });
        await shot(page, width, "52-com-job");
        await quickNext(page);
        await passGateIfShown(page, { email: `ui.refresh.com.${Date.now()}@example.com` });
        await expect(page.getByTestId("reveal-range")).toHaveText(MONEY_RANGE, { timeout: 90_000 });
        await shot(page, width, "53-com-reveal");
        await page.getByTestId("door-tighten").click();
        await page.waitForURL(/\/estimate\/scope/, { timeout: 60_000 });
        await expect(page.getByTestId("estimator-strip")).toBeVisible({ timeout: 60_000 });
        await shot(page, width, "54-com-area-editor");
        await page.context().close();
      });

      test("commercial warehouse: building screen", async ({ browser }) => {
        test.setTimeout(180_000);
        const page = await newPage(browser, width);
        await toSegment(page);
        await page.getByTestId("ql-segment-warehouse").click();
        await quickNext(page);
        await expect(page.locator("[data-quick-step='com_warehouse']")).toBeVisible({ timeout: 20_000 });
        await shot(page, width, "55-com-warehouse");
        await quickNext(page);
        await expect(page.locator("[data-quick-step='com_job']")).toBeVisible({ timeout: 20_000 });
        await shot(page, width, "56-com-warehouse-job");
        await page.context().close();
      });

      test("commercial visit only (strata): questions, book, booked", async ({ browser }) => {
        test.setTimeout(300_000);
        const page = await newPage(browser, width);
        const email = `ui.refresh.brief.${width.label}.${Date.now()}@example.com`;
        briefEmails.push(email);
        await toSegment(page);
        await page.getByTestId("ql-segment-strata").click();
        await expect(page.getByTestId("segment-visit-note")).toBeVisible();
        await shot(page, width, "60-brief-segment-note");
        await quickNext(page);
        await expect(page.locator("[data-quick-step='com_brief']")).toBeVisible({ timeout: 20_000 });
        await page.getByTestId("brief-date-input").fill("2026-12-05");
        await shot(page, width, "61-brief-questions");
        await quickNext(page);
        await expect(page.locator("[data-quick-step='com_book']")).toBeVisible({ timeout: 20_000 });
        await shot(page, width, "62-brief-book");
        await page.getByTestId("book-email").fill(email);
        await page.getByTestId("book-name").fill("Baseline Tester");
        await page.getByTestId("book-phone").fill(`04${String(Date.now()).slice(-8)}`);
        await page.getByTestId("ql-next").click();
        await expect(page.getByTestId("brief-done")).toBeVisible({ timeout: 60_000 });
        await shot(page, width, "63-brief-booked");
        await page.context().close();
      });

      test("commercial hospital: areas then questions", async ({ browser }) => {
        test.setTimeout(180_000);
        const page = await newPage(browser, width);
        await toSegment(page);
        await page.getByTestId("ql-segment-health").click();
        await quickNext(page);
        await expect(page.locator("[data-quick-step='com_areas']")).toBeVisible({ timeout: 20_000 });
        await page.getByTestId("com-kind-hospital").click();
        await shot(page, width, "64-hospital-areas");
        await quickNext(page);
        await expect(page.locator("[data-quick-step='com_brief']")).toBeVisible({ timeout: 20_000 });
        await shot(page, width, "65-hospital-questions");
        await page.context().close();
      });

      test("site visit booking from the range", async ({ browser }) => {
        test.setTimeout(300_000);
        const page = await newPage(browser, width);
        await driveNoPlanWizard(page, { stopAtReveal: true, suburb: "Glen Waverley", postcode: "3150" });
        await page.getByTestId("door-book").click();
        await page.waitForURL(/\/estimate\/(visit|book)/, { timeout: 30_000 });
        await expect(page.getByTestId("visit-details").or(page.getByTestId("visit-calendar")).or(page.getByTestId("visit-request")).or(page.getByTestId("visit-out")).or(page.getByTestId("book-page"))).toBeVisible({ timeout: 30_000 });
        await shot(page, width, "70-visit");
        await page.context().close();
      });

      test("holding page (online estimates off)", async ({ browser }) => {
        test.skip(!db, "needs the test project's service key (see .env.test.local)");
        const read = await db!.from("settings").select("value").eq("key", "wizard_public").maybeSingle();
        if (read.error) throw new Error(`read wizard_public: ${read.error.message}`);
        const saved = read.data?.value ?? { enabled: true };
        try {
          const off = await db!.from("settings").upsert({ key: "wizard_public", value: { ...(saved as object), enabled: false } }, { onConflict: "key" });
          if (off.error) throw new Error(`switch wizard_public off: ${off.error.message}`);
          const page = await newPage(browser, width);
          await page.goto(`/estimate?address=${encodeURIComponent("9 Baseline Court, Malvern VIC 3144")}&mode=home&src=homepage_hero`);
          await expect(page.getByTestId("holding-page")).toBeVisible({ timeout: 30_000 });
          await shot(page, width, "80-holding");
          await page.context().close();
        } finally {
          const back = await db!.from("settings").upsert({ key: "wizard_public", value: saved }, { onConflict: "key" });
          if (back.error) throw new Error(`restore wizard_public: ${back.error.message}`);
        }
      });
    });
  }
});
