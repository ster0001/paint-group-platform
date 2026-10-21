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
  /** With `suburb`: the postcode the fallback field gets (default 3163). */
  postcode?: string;
  /** S6: what the gate is filled with (details first). */
  contactName?: string;
  mobile?: string;
  /** S6: stop ON the gate screen (details first) so a spec can assert its wording and fill it itself. */
  stopAtGate?: boolean;
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
  await page.getByPlaceholder("Postcode").fill(opts.postcode ?? "3163");
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
  // 14 Sep: every tile starts ticked, so "same" = untick all three.
  if (opts.colour === "same") for (const k of ["walls", "ceilings", "trims", "windows"]) await page.getByTestId(`ql-changing-${k}`).click();
  if (opts.colour === "bold") {
    await page.getByTestId("ql-bold-yes").click();
    // Tom, 15 Sep: "Yes" then WHICH — the walls, as the old assumption had it.
    await page.getByTestId("ql-bold-which-walls").click();
  }
  await quickNext(page);

  // 14 Sep (evening): confirm the rooms — the starter list, accepted as it is.
  await expect(page.locator("[data-quick-step='rooms']")).toBeVisible({ timeout: 30_000 });
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
    // The plainest outside answers, on whichever screens the flag puts there
    // (S3); it lands on "Which sides?" — all four start ticked, so Continue
    // is the answer (Tom, 15 Sep, late).
    await answerOutsideQuick(page);
    await quickNext(page);
  }

  /**
   * The guide range. Pricing runs server-side, so this waits like a submit —
   * but it waits for EITHER outcome. A failed submit does not stay on the
   * quick look: `WizardApp.tsx` drops the customer onto the old page set with
   * the server's message in `.wz-err`, so a spec watching only `reveal` sat
   * 90 s on "How's it looking?" and reported a timeout. CI run #381 (12 Sep)
   * was exactly that — the real message was "Couldn't create the estimate:
   * TypeError: fetch failed" (an ECONNRESET between the runner and Supabase),
   * and it took a trace to find. Now it is the failure.
   */
  /**
   * S6 (R5): under "details first" the last question is the GATE — name, email,
   * mobile — and the range is not shown until it is answered. The helper fills
   * it with `opts.email` (or a throwaway) so every journey still reaches the
   * range; under "range first" the gate never appears and this is skipped.
   */
  const reveal = page.getByTestId("reveal");
  const bounced = page.locator(".wz-err");
  if (opts.stopAtGate) {
    await expect(page.locator("[data-quick-step='gate']").or(reveal).or(bounced)).toBeVisible({ timeout: 90_000 });
    return;
  }
  await passGateIfShown(page, { name: opts.contactName, email: opts.email, mobile: opts.mobile });
  await expect(reveal.or(bounced)).toBeVisible({ timeout: 90_000 });
  if (await bounced.count()) throw new Error(`quick look submit failed: ${await bounced.first().innerText()}`);
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
  if (opts.email && (await page.getByTestId("door-keep").count())) {
    await page.getByTestId("door-keep").click();
    await page.getByTestId("reveal-keep-email").fill(opts.email);
    await page.getByTestId("reveal-keep-send").click();
    await expect(page.getByTestId("reveal-kept")).toBeVisible({ timeout: 30_000 });
  }
  if (opts.stopAtReveal) return;

  await page.getByTestId("door-tighten").click();
  await passDetailsSheetIfShown(page, { name: opts.contactName, email: opts.email, mobile: opts.mobile });
  await expect(page.locator(".sc-r").first()).toHaveText(MONEY_RANGE, { timeout: 60_000 });
}

/**
 * S6 (R7): under "range first" the gate never ran, so the first door the
 * customer picks asks for the details — name, email, mobile — in the
 * TalkSheet ("A few details first") before going further. The keep door
 * files an EMAIL only, which is not "contact known" (that needs all three),
 * so Tighten my price still opens the sheet after a keep (15 Oct 2026: the
 * portal-shell spec sat 60 s on the Reveal page with the sheet open — C1's
 * booking rules had been left on range_first by an earlier gate run). Under
 * "details first" the gate already holds the three and the sheet never
 * appears. Waits for whichever comes — the sheet or the scope editor's range
 * — and fills the sheet when it is there.
 */
/**
 * Exterior wizard v2 (S2): with `exteriorV2` ON the outside path asks "What
 * kind of home is it?" before the outside questions. A spec about the OLD
 * outside screens answers it with the plainest house — a weatherboard home,
 * medium — and walks on; with the flag off the step is not there and this is
 * a no-op. The S2+ specs drive the home step themselves.
 */
export async function passHomeStepIfShown(page: Page): Promise<boolean> {
  const home = page.locator("[data-quick-step='home']");
  const outside = page.locator("[data-quick-step='outside']");
  await expect(home.or(outside)).toBeVisible({ timeout: 20_000 });
  if (!(await home.count())) return false;
  await page.getByTestId("ql-ext-type-wb").click();
  await page.getByTestId("ql-ext-size-md").click();
  await quickNext(page);
  return true;
}

/**
 * Exterior wizard v2 (S3): answer the outside quick look with the plainest
 * house and land on "Which sides?" — whichever screens the flag puts there.
 * With `exteriorV2` ON: home (weatherboard home, medium) → Painting (the walls
 * and the fascias) → About it (weatherboards). OFF: the one outside screen
 * (the body ticked, weatherboards). A spec about the outside answers drives
 * them itself; this is for specs that only need an outside job priced.
 */
export async function answerOutsideQuick(page: Page): Promise<"v2" | "v1"> {
  const home = page.locator("[data-quick-step='home']");
  const outside = page.locator("[data-quick-step='outside']");
  await expect(home.or(outside)).toBeVisible({ timeout: 20_000 });
  if (await home.count()) {
    await page.getByTestId("ql-ext-type-wb").click();
    await page.getByTestId("ql-ext-size-md").click();
    await quickNext(page);
    await expect(page.locator("[data-quick-step='paint']")).toBeVisible({ timeout: 20_000 });
    await page.getByTestId("ext-part-walls").click();
    await page.getByTestId("ext-part-fascias").click();
    await quickNext(page);
    await expect(page.locator("[data-quick-step='about']")).toBeVisible({ timeout: 20_000 });
    await page.getByTestId("ext-mat-weatherboards").click();
    await quickNext(page);
    await expect(page.locator("[data-quick-step='sides']")).toBeVisible({ timeout: 20_000 });
    // 21 Oct: no "Looks right" tap on Each side — but every ticked side must be looked at.
    await lookAtEverySide(page);
    return "v2";
  }
  // C8b: nothing is pre-ticked on the outside screen — a job has to name
  // something being painted before it can continue.
  await page.getByTestId("ql-ext-el-body").click();
  await page.getByTestId("ql-ext-mat-weatherboards").click();
  await quickNext(page);
  await expect(page.locator("[data-quick-step='sides']")).toBeVisible({ timeout: 20_000 });
  return "v1";
}

/** Exterior v2 (21 Oct): Each side needs every ticked side looked at before Continue — tap each tile in turn. */
export async function lookAtEverySide(page: Page): Promise<void> {
  for (const k of ["front", "right", "back", "left"]) {
    const tile = page.getByTestId(`ql-ext-side-${k}`);
    if (await tile.count()) await tile.click();
  }
}

/** Tom, 21 Oct: the talk-it-through box floats bottom-right; on a phone it is a pill that opens the card. */
export async function openTalk(page: Page): Promise<void> {
  const toggle = page.getByTestId("ql-talk-toggle");
  if (await toggle.isVisible() && (await toggle.getAttribute("aria-expanded")) !== "true") await toggle.click();
}

export async function passDetailsSheetIfShown(page: Page, who: { name?: string; email?: string; mobile?: string } = {}): Promise<boolean> {
  const sheet = page.getByTestId("talk-sheet");
  // Where the door lands when there is no sheet: the sides editor, or — on the
  // drawn house (exterior v2) — the walk-around. Without `ext-walk` here every
  // v2 tighten spec timed out under details-first (the 15 reds of 20 Oct).
  const editor = page.locator(".sc-r").first().or(page.getByTestId("ext-walk"));
  await expect(sheet.or(editor)).toBeVisible({ timeout: 60_000 });
  if (!(await sheet.count())) return false;
  await page.getByTestId("talk-name").fill(who.name ?? "Drive Tester");
  await page.getByTestId("talk-email").fill(who.email ?? `drive.${Date.now()}@example.com`);
  await page.getByTestId("talk-mobile").fill(who.mobile ?? uniquePhone());
  await page.getByTestId("talk-go").click();
  return true;
}

/** Open /estimate and wait for the quick look's first screen. */
/**
 * S6 (R5): after the last question, the GATE appears under "details first" —
 * name, email, mobile — and the range follows; under "range first" it does
 * not. Waits for whichever comes, fills the gate when it is there.
 */
export async function passGateIfShown(page: Page, who: { name?: string; email?: string; mobile?: string } = {}): Promise<boolean> {
  const gate = page.locator("[data-quick-step='gate']");
  const reveal = page.getByTestId("reveal");
  const bounced = page.locator(".wz-err");
  await expect(gate.or(reveal).or(bounced)).toBeVisible({ timeout: 90_000 });
  if (!(await gate.count())) return false;
  await page.getByTestId("gate-name").fill(who.name ?? "Drive Tester");
  await page.getByTestId("gate-email").fill(who.email ?? `drive.${Date.now()}@example.com`);
  // A UNIQUE mobile by default (9 Oct 2026). The submit route files the
  // estimate under an account found by email OR phone, so one shared default
  // number ("0400 111 222") put every walk's estimate on the same old account —
  // the magic link for THIS walk's email then found nothing to keep shaping,
  // and a call back landed on someone else's record.
  await page.getByTestId("gate-mobile").fill(who.mobile ?? uniquePhone());
  await quickNext(page);
  return true;
}

export async function openQuickLook(page: Page, opts: { entry?: "upload" } = {}) {
  // Tom, 15 Sep (late, item 1): the "Upload photos or a listing" door left the
  // outside tab; the old page set behind it answers to `?entry=upload`.
  await page.goto(opts.entry ? `/estimate?entry=${opts.entry}` : "/estimate");
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
  // Tom, 14 Sep (evening): one question at a time — cornices first ("No" here:
  // the specs that drive styles are not about cornices), then the door tile,
  // then the window type tiles (window frames are in the whole interior now).
  if (await card.getByTestId("details-cornices").count()) {
    await card.getByTestId("details-cornices").getByRole("button", { name: "No", exact: true }).click();
    await expect(page.locator(".sd-saving")).toHaveCount(0, { timeout: 30_000 });
  }
  if (opts.doorStyle && await card.getByTestId(`door-tile-${opts.doorStyle.toLowerCase()}`).count()) {
    await card.getByTestId(`door-tile-${opts.doorStyle.toLowerCase()}`).click();
    await expect(page.locator(".sd-saving")).toHaveCount(0, { timeout: 30_000 });
  }
  for (const label of [opts.windowStyle]) {
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
  await openQuickLook(page, opts.via === "upload" ? { entry: "upload" } : {});
  await fillQuickAddress(page);
  await page.getByTestId("ql-jobtype-exterior").click();
  if (opts.via === "upload") {
    await page.getByTestId("entry-upload").click();
    return;
  }
  await quickNext(page);                 // → the place
  await expect(page.locator("[data-quick-step='place']")).toBeVisible();
  await quickNext(page);                 // → the first outside screen: the v2 home step when the flag is on, else s-ext-job
  await expect(page.locator("[data-quick-step='home'], [data-quick-step='outside']").first()).toBeVisible({ timeout: 20_000 });
}
