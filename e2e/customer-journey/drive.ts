import { expect, type Page } from "@playwright/test";

/** A money range like "$5,120 – $5,560". */
export const MONEY_RANGE = /\$[\d,]+\s*–\s*\$[\d,]+/;

export type DriveOptions = {
  /** Email for the "keep this estimate" door; defaults to a throwaway. */
  email?: string;
  /** Linger after the last screen so the 2.5s autosave debounce fires.
   *  Playwright outruns it — no human answers four screens in two seconds —
   *  so a spec asserting on the DRAFT must pace like a person. */
  settleAfterContactMs?: number;
  /** Quick-look answers to change from the defaults (3-bed single-storey
   *  house, whole interior, new colours, some wear, empty). */
  bedrooms?: 1 | 2 | 3 | 4 | 5;
  storeys?: "single" | "double";
  scope?: "whole" | "some_rooms" | "walls_ceilings" | "trims_doors";
  colour?: "same" | "new" | "bold";
  condition?: "good" | "wear" | "needs_work";
  occupied?: "yes" | "no";
  propertyKind?: "house" | "townhouse" | "unit_apartment" | "commercial";
  /** Stop on the reveal screen instead of walking through to the editor. */
  stopAtReveal?: boolean;
  /** Inside, outside, or both. Anything but "interior" leaves the quick look
   *  for the exterior question set — which sides, materials, condition. */
  jobType?: "interior" | "exterior" | "both";
  /** A suburb unique to this run — the handle an ANONYMOUS walk is known by
   *  now that no email is asked for before the price (⚑1). */
  suburb?: string;
};

/**
 * Drive the customer QUICK LOOK from /estimate to the guide range, and then
 * (unless `stopAtReveal`) through the "tighten it online" door into the scope
 * editor — the landing every journey spec asserts against.
 *
 * ⚑ REWRITTEN for estimator journey v2 phase 2. This used to walk five pages
 * — property, surfaces, condition, details, contact — because that is what
 * the wizard was. The quick look asks eight questions across four screens and
 * shows the price BEFORE the contact form (⚑1), so there is no contact step
 * to fill in on the way through any more.
 *
 * The old pages still exist and still serve staff, the describe route and the
 * upload route; they are simply no longer the customer's default way in.
 */
export async function driveNoPlanWizard(page: Page, opts: DriveOptions = {}) {
  await openQuickLook(page);

  // Screen 1 — the address. Places is not available in the test stack, so the
  // lookup degrades to a plain input and the suburb/postcode fallback appears.
  // That fallback is the thing under test as much as anything: without a
  // postcode the service-area check hands the job off.
  await page.getByPlaceholder(/Your address/).fill("14 Acacia Street, Northcote");
  await page.getByPlaceholder("Suburb").fill(opts.suburb ?? "Murrumbeena");
  await page.getByPlaceholder("Postcode").fill("3163");
  if (opts.jobType && opts.jobType !== "interior") {
    await page.getByTestId(`ql-jobtype-${opts.jobType}`).click();
  }
  await quickNext(page);
  // C8: a "both" job meets the choice screen (prototype `s-both`) — the drive
  // prices them itself, one after the other.
  if (opts.jobType === "both") {
    await page.getByTestId("ql-both-self").click();
  }

  // Screen 2 — the place.
  if (opts.propertyKind) await page.getByTestId(`ql-kind-${opts.propertyKind}`).click();
  if (opts.bedrooms) await page.getByTestId(`ql-bedrooms-${opts.bedrooms}`).click();
  if (opts.storeys) await page.getByTestId(`ql-storeys-${opts.storeys}`).click();
  await quickNext(page);

  /**
   * A COMMERCIAL property and an OUTSIDE-ONLY job both leave the quick look
   * here, by design — commercial for the segment question and its seven
   * routing gates, exterior for the elevation questions. Neither can be
   * answered by the interior screens, and skipping them is the safety check
   * missing rather than a shortcut. The caller drives what follows.
   */
  if (opts.propertyKind === "commercial" || opts.jobType === "exterior") return;

  // Screen 3 — the job.
  if (opts.scope) await page.getByTestId(`ql-scope-${opts.scope}`).click();
  // C9: the single colour picker is gone. "same" = untick the walls (the
  // default tick); "new" = the default; "bold" = walls ticked + "Yes" to bold.
  if (opts.colour === "same") await page.getByTestId("ql-changing-walls").click();
  if (opts.colour === "bold") await page.getByTestId("ql-bold-yes").click();
  await quickNext(page);

  // Screen 4 — condition.
  if (opts.condition) await page.getByTestId(`ql-condition-${opts.condition}`).click();
  if (opts.occupied) await page.getByTestId(`ql-occupied-${opts.occupied}`).click();
  if (opts.settleAfterContactMs) await page.waitForTimeout(opts.settleAfterContactMs);
  await quickNext(page);

  /**
   * Screen 5 — the OUTSIDE screen, which a BOTH job also walks: `stepsFor`
   * returns all five for "both", because a mixed job has an outside to size as
   * well as rooms and the exterior quick look (prototype `s-ext-job`) is where
   * that is asked. This helper used to stop after the condition screen and wait
   * for a reveal that was one screen away, so every both-job spec sat on the
   * outside screen until it timed out — which read as "a both job can't get a
   * price" and was really "nobody answered screen 5".
   *
   * The prototype's defaults ARE an answer — weatherboards, the house, sound
   * condition — so this accepts them, exactly as a customer who changes nothing
   * would. A spec that cares about the exterior answers drives them itself.
   */
  if (opts.jobType === "both") {
    await expect(page.locator("[data-quick-step='outside']")).toBeVisible({ timeout: 20_000 });
    // C8b: nothing is pre-ticked on the outside screen — a job has to name
    // something being painted before it can continue. The body is the
    // typical answer, and it keeps the walls the sides editor expects.
    await page.getByTestId("ql-ext-el-body").click();
    await quickNext(page);
  }

  // The guide range. Pricing runs server-side, so this waits like a submit.
  await expect(page.getByTestId("reveal")).toBeVisible({ timeout: 90_000 });
  await expect(page.getByTestId("reveal-range")).toHaveText(MONEY_RANGE);

  /**
   * "Keep this estimate" — the door that files an ACCOUNT.
   *
   * ⚑ `opts.email` was accepted and then ignored for the whole of phase 2: the
   * five-page wizard used to end on a contact form, the quick look shows the
   * price first (⚑1), and when the helper was rewritten the email stopped going
   * anywhere. Six specs kept passing one and kept believing an account existed,
   * so their later lookups failed on a null row and read as missing CRM events
   * and missing visits. This is the keep door, walked — which is how a customer
   * who wants to be reachable becomes reachable now.
   */
  if (opts.email) {
    await page.getByTestId("door-keep").click();
    await page.getByTestId("reveal-keep-email").fill(opts.email);
    await page.getByTestId("reveal-keep-send").click();
    await expect(page.getByTestId("reveal-kept")).toBeVisible({ timeout: 30_000 });
  }
  if (opts.stopAtReveal) return;

  await page.getByTestId("door-tighten").click();
  await expect(page.locator(".sc-r").first()).toHaveText(MONEY_RANGE, { timeout: 60_000 });
}

/** Open /estimate and wait for the quick look's first screen. */
export async function openQuickLook(page: Page) {
  await page.goto("/estimate");
  await expect(page.locator("[data-ready='1']")).toBeAttached({ timeout: 20_000 });
  await expect(page.locator("[data-quick-step='start']")).toBeVisible({ timeout: 20_000 });
}

/** The address screen, filled. Places is unavailable in the test stack, so the
 *  lookup degrades to a plain input and the suburb/postcode fallback appears —
 *  without a postcode the service-area check hands the job off. */
export async function fillQuickAddress(page: Page, opts: { suburb?: string; postcode?: string } = {}) {
  await page.getByPlaceholder(/Your address/).fill("14 Acacia Street, Northcote");
  await page.getByPlaceholder("Suburb").fill(opts.suburb ?? "Murrumbeena");
  await page.getByPlaceholder("Postcode").fill(opts.postcode ?? "3163");
}

/** Advance one quick-look screen, failing loudly on a gate rather than
 *  silently sitting on the same screen until a later assertion times out. */
export async function quickNext(page: Page) {
  // Wait for it to be ENABLED, not merely present. Continue is disabled while
  // the anonymous session connects, and a spec that clicks in that window sits
  // on the same screen until a later assertion times out — which reads as a
  // broken flow and is a race.
  const next = page.getByTestId("ql-next");
  await expect(next).toBeEnabled({ timeout: 30_000 });
  await next.click();
  const err = page.getByTestId("ql-error");
  if (await err.count()) throw new Error(`quick look gate: ${await err.first().innerText()}`);
}

/** Ensure the scope editor is open and hydrated (P1: pre-hydration clicks
 * are inert by design; the gate gives tests an honest go-signal). The
 * wizard lands here directly now — the link click remains only for callers
 * arriving from an older surface that still shows it. */
export async function openScopeEditor(page: Page) {
  const link = page.getByRole("link", { name: /Open the editor/i });
  if (await link.count()) await link.click();
  await expect(page.locator(".sc-r").first()).toHaveText(MONEY_RANGE, { timeout: 20_000 });
  await expect(page.locator("[data-ready='1']")).toBeAttached({ timeout: 20_000 });
}

/**
 * The contact page — since 31 Aug the LAST page before the build (Tom's
 * ruling), not a sub-step at the start. Fills name/email/phone when the block
 * is present and no-ops when it is not (staff runs, signed-in members whose
 * account already carries all three). Never advances — the caller owns the
 * "See my estimate" click.
 */
export async function fillContactStep(page: Page, email?: string) {
  const contact = page.locator(".wz-crow input");
  if (!(await contact.count())) return;
  await contact.nth(0).fill("E2E Journey");
  await contact.nth(1).fill(email ?? `e2e-journey-${Date.now()}@example.com`);
  await contact.nth(2).fill(uniquePhone());
}

/**
 * CRM v2 P1 (7 Sep): accounts are found by email OR phone (crm_find_account),
 * so every run that typed "0400 000 111" was filed onto the FIRST account
 * that ever used it — the "another device" portal spec then signed into an
 * account with no estimates. One phone per run keeps the runs apart.
 */
export function uniquePhone(): string {
  const d = String(Date.now()).slice(-8);
  return `04${d.slice(0, 2)} ${d.slice(2, 5)} ${d.slice(5, 8)}`;
}

/**
 * Door and window style, set in the SCOPE EDITOR — which is where the product
 * now asks them (the "a few details to settle" card).
 *
 * ⚑ The quick look deliberately does not ask: §2's whole complaint is that a
 * customer cannot reliably tell a panel door from a flat one before they have
 * been shown their own room list, and asking anyway buys a tap and a wrong
 * number. Both questions moved to the editor, beside the rooms they price.
 */
export async function setStylesInEditor(page: Page, opts: {
  doorStyle?: "Panel" | "Flat";
  windowStyle?: "Casement" | "Sash" | "Colonial" | "Winder";
}) {
  const card = page.getByTestId("details-card");
  await expect(card).toBeVisible({ timeout: 30_000 });
  for (const label of [opts.doorStyle, opts.windowStyle]) {
    if (!label) continue;
    const chip = card.getByRole("button", { name: label, exact: true });
    /**
     * A style question only renders when that surface is IN SCOPE
     * (`styleOpen.doors` / `styleOpen.windows`, ScopeEditor ~696-714).
     *
     * Windows are not in `DEFAULT_SURFACES` (state.ts:22 — walls, ceilings,
     * cornices, doors, architraves, skirting), so "the whole inside" has never
     * included window frames and the window-style question does not exist on
     * the default walk. This used to wait 30 s for a Sash chip that cannot
     * appear, and the failure read as "styles are broken" rather than "windows
     * are not in this job". Skipping is the honest answer: there is no style to
     * answer for a surface nobody is painting.
     *
     * To test window styles, tick windows first — that is a different journey
     * (the add panel), not this one.
     */
    if (await chip.count() === 0) continue;
    await chip.click();
    // Optimistic chips light before the save lands — wait it out or the next
    // click races the write (the site-access trap, 9 Sep).
    await expect(page.locator(".sd-saving")).toHaveCount(0, { timeout: 30_000 });
  }
}

/**
 * Open the EXTERIOR question set from the quick look (v2 phase 2).
 *
 * Every exterior spec used to start the same way: click "Exterior" on page 1,
 * pick a way in, then type a suburb. The quick look changed all three — the
 * chip reads "Outside", the ways in are offers rather than a gate, and the
 * suburb/postcode pair only appears once an address has been typed that the
 * lookup could not resolve. This is that entry, once, so the specs describe
 * what they are testing rather than how to get there.
 *
 * `via: "answers"` walks the quick look's two screens and lands on the
 * EXTERIOR QUICK LOOK (prototype `s-ext-job`), which is what "no photos to
 * hand — we'll size it from your answers" now means. `via: "upload"` hands
 * straight to the upload route and its old pages, for a listing or facade
 * photos.
 */
export async function openExteriorPages(page: Page, opts: { via?: "answers" | "upload" } = {}) {
  await openQuickLook(page);
  await fillQuickAddress(page);
  await page.getByTestId("ql-jobtype-exterior").click();
  if (opts.via === "upload") {
    await page.getByTestId("entry-upload").click();
    return;
  }
  await quickNext(page);                 // → the place
  await expect(page.locator("[data-quick-step='place']")).toBeVisible();
  await quickNext(page);                 // → the exterior quick look (s-ext-job)
  await expect(page.locator("[data-quick-step='outside']")).toBeVisible({ timeout: 20_000 });
}
