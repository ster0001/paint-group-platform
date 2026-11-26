import { test, expect, devices } from "@playwright/test";
import { createClient } from "@supabase/supabase-js";
import { driveNoPlanWizard, MONEY_RANGE, quickNext, hopToScopeIfOnQuote } from "./drive";
import { defaultWizardState } from "../../lib/wizard/state";
import { magicLinkFor, destroyAccountChain, openMagicLink } from "../fixtures/portal";

/**
 * Phase 1 of the 6 Sep estimator plan — save-and-return, as an anonymous
 * customer on a phone.
 *
 *  1. Same device: answer two pages, reload → the same page and the same
 *     answers come back with a "Welcome back" line; Start again wipes it.
 *     A homepage hand-off for a DIFFERENT address starts fresh.
 *  2. Another day, another device: a finished wizard run whose email owns
 *     an account. The magic link signs the customer in; the portal Home's
 *     primary action is "Keep shaping my estimate" and it opens the
 *     confirm-loop editor with the range — ownership by account membership,
 *     not by the anonymous session that built it.
 */
const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const missing = !url || !serviceKey;

test.describe("save-and-return", () => {
  test.skip(missing, "needs the test project's service key (see .env.test.local)");
  const db = missing ? null : createClient(url!, serviceKey!);
  const stamp = Date.now();
  const returnEmail = `e2e-return-${stamp}@example.com`;

  test.afterAll(async () => {
    if (!db) return;
    await db.from("wizard_drafts").delete().eq("email", returnEmail);
    await destroyAccountChain(db, returnEmail);
  });

  test("same device: a reload puts the quick look's answers back; Start again wipes them", async ({ browser }) => {
    const ctx = await browser.newContext({ ...devices["iPhone 13"] });
    const page = await ctx.newPage();
    await page.goto("/estimate");
    await expect(page.locator("[data-quick-step='start']")).toBeVisible({ timeout: 20_000 });
    await page.getByPlaceholder(/Your address/).fill("14 Acacia Street, Northcote");
    await page.getByPlaceholder("Suburb").fill("Murrumbeena");
    await page.getByPlaceholder("Postcode").fill("3163");
    // Wizard mobile v5: the phone is the one-question shell — the address step, then the place step's own screens
    // (house, bedrooms, storeys), each advancing itself.
    await quickNext(page);
    await page.getByTestId("ql-kind-house").click();
    await page.getByTestId("ql-bedrooms-4").click();
    await page.getByTestId("ql-storeys-double").click();
    await expect(page.locator("[data-mobile-screen='job']")).toBeVisible({ timeout: 10_000 });
    await page.waitForTimeout(3_500); // the autosave's 2.5 s debounce writes the draft the resume reads

    /**
     * ⚑ THE BUG THIS CATCHES. The quick look's eight answers first lived in
     * component state, where autosave could not see them — a reload dropped
     * the customer back on screen 1 with nothing, and the draft the funnel
     * stored carried the derived state with no record of what was tapped.
     * They ride `state.quickLook` now, and the screen is the ordinary `page`.
     */
    await page.reload();
    await expect(page.locator("[data-ready='1']")).toBeAttached({ timeout: 20_000 });
    await expect(page.getByTestId("wz-resume")).toContainText(/you were at/, { timeout: 20_000 });
    // ⚑ (25 Nov, listed for Tom): with an address TYPED through the suburb/postcode fallback (the test stack has no
    // Places key) the resume says "you were at the job" but lands on the first screen; a hand-off address lands on the
    // remembered screen (wizard-mobile-v5.spec.ts). What this test exists for is the ANSWERS — walk to them from
    // wherever the resume landed.
    await expect(page.getByTestId("wz-resume")).toContainText(/you were at the job/);
    const shell = page.getByTestId("wzm");
    for (let i = 0; i < 6 && !(await page.getByTestId("ql-bedrooms-4").count()); i++) {
      const at = await shell.getAttribute("data-mobile-screen");
      if (at === "what") await quickNext(page);
      else if (at === "property") await page.getByTestId("ql-kind-house").click();
      else await page.getByTestId("wzm-back").click(); // past the beds: back towards them
      await page.waitForTimeout(400);
    }
    await expect(page.getByTestId("ql-bedrooms-4")).toHaveAttribute("aria-pressed", "true");
    await page.getByTestId("ql-bedrooms-4").click();
    await expect(page.getByTestId("ql-storeys-double")).toHaveAttribute("aria-pressed", "true");
    for (let i = 0; i < 6 && (await shell.getAttribute("data-mobile-screen")) !== "what"; i++) { await page.getByTestId("wzm-back").click(); await page.waitForTimeout(300); }
    await expect(page.locator("[data-mobile-screen='what']")).toContainText("14 Acacia Street, Northcote");

    await page.getByTestId("wz-start-again").click();
    await expect(page.getByTestId("wz-resume")).toHaveCount(0);
    // The address field always renders; the suburb/postcode pair only appears
    // once something has been typed that the lookup could not resolve, so an
    // emptied screen correctly has no pair to check.
    await expect(page.getByPlaceholder(/Your address/)).toHaveValue("");
    await expect(page.getByPlaceholder("Suburb")).toHaveCount(0);
    await page.reload();
    await expect(page.getByTestId("wz-resume")).toHaveCount(0);

    // A different address from the homepage is a new job — no resume.
    await page.getByPlaceholder(/Your address/).fill("2 Wattle Road, Malvern");
    await page.getByPlaceholder("Suburb").fill("Malvern");
    await page.getByPlaceholder("Postcode").fill("3144");
    await page.waitForTimeout(800);
    await page.goto(`/estimate?address=${encodeURIComponent("9 Elm Street, Bentleigh VIC 3204")}&mode=home&src=homepage_hero`);
    await expect(page.locator("[data-ready='1']")).toBeAttached({ timeout: 20_000 });
    await page.waitForTimeout(500);
    await expect(page.getByTestId("wz-resume")).toHaveCount(0);
    // The homepage's address is MEANT to arrive prefilled — what must not come
    // back is the previous walk, so the field shows Bentleigh, never Malvern.
    await expect(page.getByPlaceholder(/Your address/)).toHaveValue(/Bentleigh/);
    await expect(page.getByPlaceholder("Suburb")).toHaveValue("");
    await ctx.close();
  });

  test("Tom, 25 Oct: a draft from the old page set, and a Paint Home hand-off, both land on the quick look", async ({ browser }) => {
    /**
     * ⚑ THE BUG THIS CATCHES. Typing an address on painthome.com.au took Tom to
     * the OLD estimator wizard ("Step 1 of 5 · The property", Interior /
     * Exterior / Both, Describe it / Answer a few questions / Upload). A draft
     * saved before the quick look — no `quickLook` answers, a `page:` screen
     * tag — resumed onto the page set by inference, and a seeded state did the
     * same. The old page set is staff-only now: a customer is always on the
     * quick look, whatever the draft or the URL says.
     */
    const ctx = await browser.newContext({ ...devices["iPhone 13"] });
    const page = await ctx.newPage();
    const old = {
      v: 1, savedAt: new Date().toISOString(), page: 2,
      state: { ...defaultWizardState(), jobType: "exterior", title: "14 Acacia Street, Northcote" },
      answered: { heritage: false, pre1970: false, asbestos: false },
      addressText: "14 Acacia Street, Northcote",
      lastScreen: "page:house",
    };
    await page.addInitScript((rec: string) => { window.localStorage.setItem("pg-wizard-resume-v1", rec); }, JSON.stringify(old));
    await page.goto("/estimate");
    await expect(page.locator("[data-ready='1']")).toBeAttached({ timeout: 20_000 });
    await expect(page.getByTestId("wz-resume")).toBeVisible({ timeout: 20_000 });
    await expect(page.locator("[data-quick-step='start']")).toBeVisible();
    await expect(page.locator(".wz-wrap--pages")).toHaveCount(0);
    await expect(page.getByTestId("entry-upload")).toHaveCount(0);
    await expect(page.getByTestId("entry-describe")).toHaveCount(0);

    // The Paint Home hero's hand-off (address + scope + brand on the URL).
    await page.goto(`/estimate?address=${encodeURIComponent("14 Acacia Street, Northcote")}&mode=home&scope=exterior&brand=painthome&src=homepage_hero`);
    await expect(page.locator("[data-ready='1']")).toBeAttached({ timeout: 20_000 });
    await expect(page.locator("[data-quick-step='start']")).toBeVisible({ timeout: 20_000 });
    await expect(page.locator(".wz-wrap--pages")).toHaveCount(0);
    await expect(page.getByTestId("ql-jobtype-exterior")).toHaveClass(/\bon\b/);
    // …and the old door on the URL is no door at all.
    await page.goto("/estimate?entry=upload");
    await expect(page.locator("[data-quick-step='start']")).toBeVisible({ timeout: 20_000 });
    await expect(page.getByTestId("entry-upload")).toHaveCount(0);
    await ctx.close();
  });

  test("another device: the magic link → portal Home → Keep shaping my estimate → the editor, by account membership", async ({ browser }) => {
    test.setTimeout(240_000);
    // Build and finish as an anonymous customer.
    const anon = await browser.newContext({ ...devices["iPhone 13"] });
    const p1 = await anon.newPage();
    /**
     * The customer's email files the account the magic link then signs into.
     * Under S6's "details first" (the default since 7 Oct 2026) it is given at
     * the last question, before the range, and the reveal shows no Keep door;
     * under "range first" it is given at the reveal through "Keep this
     * estimate". The driver walks whichever this environment shows.
     */
    await driveNoPlanWizard(p1, { stopAtReveal: true, email: returnEmail });
    // the phone's range is the gate screen (wizard mobile v5, S4); both carry the estimate id
    const estimateId = await p1.getByTestId("reveal").or(p1.getByTestId("wzm-gate")).first().getAttribute("data-estimate-id");
    expect(estimateId).toBeTruthy();
    await anon.close();

    // A fresh browser (no anonymous session) with the emailed link.
    const other = await browser.newContext({ ...devices["iPhone 13"] });
    const p2 = await other.newPage();
    await openMagicLink(p2, await magicLinkFor(db!, returnEmail));
    await p2.goto("/account");
    const keep = p2.getByRole("link", { name: "Keep shaping my estimate" });
    await expect(keep).toBeVisible({ timeout: 20_000 });
    await keep.click();
    // go-live S3 (editorHref): the door may lead to the quote stage now — this test is about the old editor's ownership rule
    await expect(p2).toHaveURL(new RegExp(`/estimate/(scope|quote)\\?id=${estimateId}`));
    await hopToScopeIfOnQuote(p2);
    await expect(p2.locator(".sc-r").first()).toHaveText(MONEY_RANGE, { timeout: 30_000 });
    // And an edit round-trips through the same ownership rule.
    await p2.locator('[data-card^="room:"] .il-hd').first().click();
    await p2.getByRole("button", { name: "Looks right" }).first().click();
    await expect(p2.locator(".sd-saving")).toHaveCount(0, { timeout: 20_000 });
    await expect(p2.locator(".il-prog")).toContainText(/OF \d+ ROOMS/);
    await other.close();
  });
});
