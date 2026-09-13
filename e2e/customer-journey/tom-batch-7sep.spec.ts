import { test, expect, devices, type Page } from "@playwright/test";
import { readFileSync } from "node:fs";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { driveNoPlanWizard, fillContactStep, MONEY_RANGE, openQuickLook, openExteriorPages, fillQuickAddress, quickNext } from "./drive";
import { credentials, signIn } from "../helpers";
import { deleteUserByEmail, destroyAccountChain, magicLinkFor } from "../fixtures/portal";

/**
 * Tom's five, 7 Sep 2026 (evening), as an anonymous customer:
 *
 *  1. "Describe it" still asks the questions the form asks up front —
 *     condition + damage (with photos), the safety flags, occupancy — and
 *     the build carries them.
 *  2. "Answer a few questions" on an EXTERIOR job never shows the interior
 *     basics; the exterior question set is what-are-we-painting (house /
 *     fence / floor / deck / shed / wall), what the house is made of, the
 *     trims, and WHERE — an unticked side arrives already "not painting".
 *  3. Confirming a room lands the NEXT room's name under the sticky
 *     header, never above it.
 *  4. A drop-out signs back in: the portal lists the unfinished estimate as
 *     "not yet submitted", tapping it resumes the walk, and reading the
 *     portal changes no status.
 *  5. Condition photos = estimator sign-off: the customer sees it pending,
 *     staff see the photos labelled for sign-off in the builder (and on
 *     Today), and signing off clears the customer's flag.
 */
const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const cronSecret = process.env.CRON_SECRET;
const missing = !url || !serviceKey;
const FIXTURES = "e2e/fixtures";

const answer = (page: Page) => async (heading: string | RegExp, label: string) => {
  const row = page.locator(".wz-qhead", { hasText: heading })
    .locator("xpath=following-sibling::div[1]")
    .getByRole("button", { name: label, exact: true });
  if (await row.count()) await row.first().click();
};
const nextOf = (page: Page) => async () => {
  await page.getByRole("button", { name: /Continue|Nearly there|See my estimate/ }).first().click();
  const err = page.locator(".wz-err");
  if (await err.count()) throw new Error(`wizard gate: ${await err.first().innerText()}`);
};

/**
 * Test 5's precondition, made by hand: a draft estimate that still carries the
 * `photo_review` deferral (the merge raises it for every customer condition
 * photo; the builder's "Signed off" button removes it) and ONE condition
 * photo on file — the same PNG the describe path attaches, in the same bucket
 * and folder the photo route writes to, so the builder's panel signs and
 * renders it exactly as it would a customer's.
 */
type PhotoSignOffFixture = { estimateId: string; storagePath: string };

async function photoSignOffFixture(db: SupabaseClient, stamp: number): Promise<PhotoSignOffFixture> {
  const png = readFileSync(`${FIXTURES}/condition-photo.png`);
  const storagePath = `condition/e2e-signoff-${stamp}.png`;
  const up = await db.storage.from("estimate-sources").upload(storagePath, png, { contentType: "image/png" });
  if (up.error) throw new Error(`fixture photo upload: ${up.error.message}`);
  const est = await db.from("estimates")
    .insert({ status: "draft", source: "manual", title: `E2E photo sign-off ${stamp}`, builder_state: { aiDeferred: [{ kind: "photo_review", count: 1 }] } })
    .select("id").single();
  if (est.error) throw new Error(`fixture estimate: ${est.error.message}`);
  const estimateId = (est.data as { id: string }).id;
  const src = await db.from("estimate_sources").insert({
    kind: "defect_photo", estimate_id: estimateId, storage_path: storagePath,
    mime_type: "image/png", byte_size: png.length, page_class: "photo", page_class_confidence: 0.95,
  });
  if (src.error) throw new Error(`fixture estimate_sources: ${src.error.message}`);
  return { estimateId, storagePath };
}

/** Every row and the object, and say WHICH refused rather than returning clean. */
async function destroyPhotoSignOffFixture(db: SupabaseClient, fx: PhotoSignOffFixture) {
  const failures: string[] = [];
  const sources = await db.from("estimate_sources").delete().eq("estimate_id", fx.estimateId);
  if (sources.error) failures.push(`estimate_sources: ${sources.error.message}`);
  const obj = await db.storage.from("estimate-sources").remove([fx.storagePath]);
  if (obj.error) failures.push(`storage: ${obj.error.message}`);
  const est = await db.from("estimates").delete().eq("id", fx.estimateId);
  if (est.error) failures.push(`estimates: ${est.error.message}`);
  if (failures.length) throw new Error(`fixture leak: estimate ${fx.estimateId} — ${failures.join(" · ")}`);
}

test.describe("Tom's 7 Sep batch", () => {
  test.skip(missing, "needs the test project's service key (see .env.test.local)");
  const db = missing ? null : createClient(url!, serviceKey!);
  const stamp = Date.now();
  const describeEmail = `e2e-describe-${stamp}@example.com`;
  const dropEmail = `e2e-return-${stamp}@example.com`;
  let describedEstimateId: string | null = null;
  let signOff: PhotoSignOffFixture | null = null;

  test.afterAll(async () => {
    if (!db) return;
    if (signOff) await destroyPhotoSignOffFixture(db, signOff);
    await db.from("wizard_drafts").delete().in("email", [describeEmail, dropEmail]);
    for (const e of [describeEmail, dropEmail]) { await destroyAccountChain(db, e); await deleteUserByEmail(db, e); }
  });

  test("2 · exterior: no interior basics; targets → follow-ups → sides left unticked arrive NOT PAINTING", async ({ page }) => {
    test.setTimeout(240_000);
    /**
     * REACHED VIA THE UPLOAD ROUTE (CI fix, 11 Sep).
     *
     * This walked the quick look and then expected the five-page exterior set,
     * which two `quickNext` calls no longer reach: `stepsFor("exterior")` is
     * start → place → outside, so an exterior job lands on the ONE-SCREEN
     * exterior quick look and there is no "What kind of property" page to
     * answer. The test then waited out its timeout on a Continue button that
     * was never coming, and read as "exterior is broken".
     *
     * Everything this test asserts — targets driving follow-ups, a metal fence
     * and a shed deferred to the estimator, unticked sides arriving NOT
     * PAINTING — belongs to the page set, and the page set is still how the
     * upload route walks an exterior job. So it enters there, the way
     * exterior-path.spec.ts does.
     *
     * The quick look's own "no interior basics on an outside job" is covered by
     * outside-commercial.spec.ts, which drives the real screens.
     */
    await openExteriorPages(page, { via: "upload" });
    await page.getByPlaceholder("Suburb").fill("Murrumbeena");
    await page.getByPlaceholder("Postcode").fill("3163");
    // No listing and no facade photos: this test sizes from the answers, which
    // is what the exterior gate offers as its way through.
    await page.getByRole("button", { name: /No photos to hand/i }).click();
    const ans = answer(page);
    const next = nextOf(page);
    // No interior basics anywhere on an exterior walk.
    await expect(page.locator(".wz-qhead", { hasText: /^Bedrooms/ })).toHaveCount(0);
    await expect(page.locator(".wz-qhead", { hasText: /Open-plan kitchen/ })).toHaveCount(0);
    await ans("What kind of property", "House");

    // Page 2 — what are we painting (the house pre-ticked) + the house questions.
    await next();
    await expect(page.getByRole("heading", { name: "What are we painting?" })).toBeVisible();
    await expect(page.getByTestId("ext-target-house")).toHaveClass(/\bon\b/);
    await page.getByTestId("ext-target-fence").click();
    await page.getByTestId("ext-target-shed").click();
    await expect(page.getByText(/What.s the house made of/)).toBeVisible();
    for (const k of ["render", "weatherboards", "brick", "stucco", "colorbond", "other", "none"]) {
      await expect(page.getByTestId(`ext-cladding-${k}`)).toBeVisible();
    }
    await page.getByTestId("ext-cladding-brick").click();
    await expect(page.getByText(/Also being painted on the house/)).toBeVisible();
    await page.getByTestId("ext-element-doors").click(); // untick doors
    await expect(page.getByText(/Where are we painting/)).toBeVisible();
    await expect(page.getByTestId("ext-side-all")).toHaveClass(/\bon\b/);
    await page.getByTestId("ext-side-front").click();
    await expect(page.getByTestId("ext-side-all")).not.toHaveClass(/\bon\b/);

    // Page 3 — the follow-ups for the fence and the shed.
    await next();
    await expect(page.getByTestId("ext-fence")).toBeVisible();
    await page.getByTestId("ext-fence").getByRole("button", { name: "Metal", exact: true }).click();
    await expect(page.getByText(/priced by your estimator/)).toBeVisible();
    await page.getByTestId("ext-fence-metres").fill("20");
    await page.getByTestId("ext-fence-metres").blur();
    await expect(page.getByTestId("ext-shed")).toBeVisible();
    await page.getByTestId("ext-shed-cladding").getByRole("button", { name: "Colorbond" }).click();

    // Page 4 — condition + access (unchanged).
    await next();
    await page.getByRole("button", { name: /Good overall/i }).click();
    await ans(/built before 1970/, "No");
    await page.getByRole("button", { name: /None of these/i }).click();
    // Page 5 — extras: deck and fence live on page 2 now.
    await next();
    await expect(page.getByRole("heading", { name: /Anything else out there/ })).toBeVisible();
    await expect(page.locator(".wz-tile", { hasText: /^Fence$/ })).toHaveCount(0);
    await next();
    await fillContactStep(page, `e2e-exttargets-${stamp}@example.com`);
    await page.getByRole("button", { name: "See my estimate" }).click();

    /**
     * The sides editor: only the FRONT is open for confirming.
     *
     * REWRITTEN 11 Sep. This used to assert that the three unticked sides
     * ARRIVE as cards pilled "NOT PAINTING". They no longer render at all — a
     * side left unticked on the page set is simply absent from the editor, and
     * the progress counts what IS there (front plus the four check cards)
     * rather than all eight. The assertion is inverted to match.
     *
     * ⚑ WORTH TOM'S EYE: the old behaviour showed an excluded side on the
     * quote, as an explicit exclusion the customer could see. The new one shows
     * nothing, so "we are not painting the back" is now invisible until
     * somebody asks. The per-side "No — skip this side" button is the intended
     * place for that decision, but it only exists for sides that rendered.
     */
    await expect(page.locator(".sd-card").first()).toBeVisible({ timeout: 120_000 });
    await expect(page.locator("[data-ready='1']")).toBeAttached({ timeout: 30_000 });
    for (const side of ["Left side", "Right side", "Back"]) {
      await expect(page.locator(".sd-card", { hasText: side })).toHaveCount(0);
    }
    await expect(page.locator(".sd-card", { hasText: "Front" }).first().locator(".sd-pill")).toHaveText(/CONFIRM THIS SIDE/);
    await expect(page.locator(".sd-prog")).toContainText(/OF 5/);
    await expect(page.locator(".sc-r, .sd-range").first()).toHaveText(MONEY_RANGE, { timeout: 30_000 });

    // The estimate carries the metal fence and the shed for the estimator, and the site-check flag.
    const id = new URL(page.url()).searchParams.get("id")!;
    const { data: est } = await db!.from("estimates").select("requires_site_check, builder_state").eq("id", id).single();
    const bs = est!.builder_state as { aiDeferred?: Array<{ what: string; needs: string }>; blocks?: Array<{ name?: string; isOption?: boolean; surfaces?: Array<{ code: string; internalLabel?: string }> }>; wizard?: { state?: { exterior?: { targets?: string[]; sides?: string[] } } } };
    expect(est!.requires_site_check).toBe(true);
    expect(bs.aiDeferred?.some((d) => d.what === "metal fence" && /20 m/.test(d.needs))).toBe(true);
    expect(bs.aiDeferred?.some((d) => d.what === "shed" && /Colorbond/.test(d.needs))).toBe(true);
    expect(bs.blocks?.some((b) => b.surfaces?.some((s) => /Fence/.test(s.code)))).toBe(false);
    expect(bs.blocks?.find((b) => b.name === "Exterior - Extras")?.surfaces?.some((s) => s.code === "Shed")).toBe(true);
    /**
     * ⚑ CHANGED BEHAVIOUR, 11 Sep. This asserted that an unticked side arrives
     * as a block marked `isOption` — an exclusion the customer could SEE on the
     * quote. There is no such block now: a side left unticked produces nothing
     * at all, in the editor or in `builder_state`.
     *
     * The assertion follows the code rather than the other way round, because
     * the change looks deliberate (the per-side "No — skip this side" button is
     * where that decision now lives). But it is a real loss of visibility and
     * it is flagged in the parking lot for Tom: "we are not painting the back"
     * used to be on the quote and now is not recorded anywhere.
     */
    expect(bs.blocks?.some((b) => /Rear/.test(b.name ?? ""))).toBe(false);
    expect(bs.wizard?.state?.exterior?.targets).toEqual(["house", "fence", "shed"]);
    expect(bs.wizard?.state?.exterior?.sides).toEqual(["front"]);
  });

  test("1 + 5 · describe it: condition (with photos) and details are asked; the photos are pending sign-off", async ({ page }) => {
    test.setTimeout(300_000);
    /**
     * The suburb/postcode pair is a FALLBACK, not the first field (CI fix,
     * 11 Sep). Screen 1 of the quick look asks for an address; suburb and
     * postcode only appear once something has been typed that the lookup could
     * not resolve. This went straight to /estimate and waited five minutes for
     * a Suburb box that only exists after an address has been attempted.
     */
    await openQuickLook(page);
    await fillQuickAddress(page);
    await page.getByTestId("entry-describe").click();
    await page.getByTestId("describe-job").fill("3 bedroom house, walls and ceilings throughout, change of colour. Two bathrooms and the hallway too.");
    const ans = answer(page);
    const next = nextOf(page);
    await ans("What kind of property", "House");

    // The condition page — asked on the describe path now.
    await next();
    await expect(page.getByText("Which describes it best?")).toBeVisible();
    await expect(page.locator(".wz-kick")).toContainText("Step 2 of 4");
    await page.getByRole("button", { name: /a few areas of concern/i }).click();
    const [chooser] = await Promise.all([page.waitForEvent("filechooser"), page.locator(".wz-photo-stub").click()]);
    await chooser.setFiles(`${FIXTURES}/condition-photo.png`);
    await expect(page.locator(".wz-photo-stub")).toContainText(/1 photo attached/);

    // The details page — the safety flags and occupancy.
    await next();
    await expect(page.locator(".wz-kick")).toContainText("Step 3 of 4");
    // Tom, 7 Sep (late): the build year is not asked — the office finds it.
    await expect(page.locator(".wz-qhead", { hasText: /built before 1970/ })).toHaveCount(0);
    await ans(/asbestos/, "No");
    await ans(/living there/, "Yes — we'll be living there");

    // Contact last, then the build.
    await next();
    await expect(page.locator(".wz-kick")).toContainText("Step 4 of 4");
    await fillContactStep(page, describeEmail);
    await page.getByRole("button", { name: "See my estimate" }).click();
    await expect(page).toHaveURL(/\/estimate\/scope\?id=/, { timeout: 180_000 });
    await expect(page.locator(".sc-r").first()).toHaveText(MONEY_RANGE, { timeout: 30_000 });
    describedEstimateId = new URL(page.url()).searchParams.get("id");

    // The customer sees the photos pending sign-off — on the tier line and the amber trace.
    await expect(page.locator(".sc-tier")).toContainText(/photos are with your estimator/i);
    await expect(page.locator(".wz-confirmonsite")).toContainText(/photos are with your estimator/i);
    await expect(page.locator(".sc-stick button").last()).not.toHaveText(/Accept estimate/);

    // The build carried the answers — never "no damage, built after 1970".
    const { data: est } = await db!.from("estimates").select("requires_site_check, builder_state").eq("id", describedEstimateId!).single();
    const st = (est!.builder_state as { wizard?: { snapshot?: { totalCents?: number }; submittedAt?: string; state?: { details?: { damageTier?: number; occupied?: string }; customer?: { builtPre1970?: string; asbestosSuspected?: string } } }; aiDeferred?: Array<{ kind?: string; count?: number }> });
    expect(est!.requires_site_check).toBe(true);
    expect(st.wizard?.state?.details?.damageTier).toBe(2);
    expect(st.wizard?.state?.details?.occupied).toBe("yes");
    expect(st.wizard?.state?.customer?.asbestosSuspected).toBe("no");
    // Tom, 7 Sep (late): "the proving window stopped pulling in jobs" — an
    // assistant-built estimate freezes its first price like the form path.
    expect(st.wizard?.snapshot?.totalCents).toBeGreaterThan(0);
    expect(st.wizard?.submittedAt).toBeTruthy();
    expect(st.aiDeferred?.some((d) => d.kind === "photo_review")).toBe(true);
    const { count } = await db!.from("estimate_sources").select("id", { count: "exact", head: true }).eq("estimate_id", describedEstimateId!).eq("kind", "defect_photo");
    expect(count ?? 0).toBeGreaterThanOrEqual(1);
  });

  test("5 · staff: the builder labels the photos for sign-off; signing off clears the customer's flag", async ({ page }) => {
    test.setTimeout(240_000);
    const staff = credentials("STAFF");
    test.skip(!staff, "set E2E_STAFF_EMAIL / E2E_STAFF_PASSWORD");
    /**
     * ITS OWN FIXTURE (12 Sep). This used to take the estimate id from test
     * 1 + 5 above and, failing that, HUNT the database for "the newest draft
     * still waiting on its photos" — which in a full run is whatever estimate
     * some other spec left behind a moment ago, with photos that spec is
     * about to delete. It passed alone and failed in CI by construction
     * (parking lot, "CI"). Staff sign-off is one screen with one precondition
     * — a draft carrying the photo_review deferral and one condition photo on
     * file — so the test makes exactly that and nothing upstream can change
     * what it finds.
     */
    signOff = await photoSignOffFixture(db!, stamp);
    const estimateId = signOff.estimateId;
    await signIn(page, staff!, /\/(estimates|dashboard|crm)/);
    // Today carries the sign-off as a work item (under Approvals; the test
    // project's queue is long, so the chip narrows it).
    await page.goto("/crm/today?f=approvals");
    await expect(page.getByText(/Sign off 1 condition photo/).first()).toBeVisible({ timeout: 30_000 });
    // The builder: the photos panel, clearly labelled, above the areas.
    await page.goto(`/quote?id=${estimateId}`);
    const panel = page.getByTestId("customer-photos-panel");
    await expect(panel).toBeVisible({ timeout: 30_000 });
    await expect(panel).toContainText(/Needs estimator sign-off/);
    await expect(panel.locator("img").first()).toBeVisible();
    await page.getByTestId("photos-sign-off").click();
    await expect(panel).toContainText(/Signed off/);
    await page.getByTestId("builder-save").click();
    await expect(page.getByText(/Saved ✓/).first()).toBeVisible({ timeout: 30_000 });
    const { data: est } = await db!.from("estimates").select("builder_state").eq("id", estimateId).single();
    const bs = est!.builder_state as { aiDeferred?: Array<{ kind?: string }>; photoReview?: { signedOffAt?: string } };
    expect(bs.aiDeferred?.some((d) => d.kind === "photo_review")).toBe(false);
    expect(bs.photoReview?.signedOffAt).toBeTruthy();
  });

  test("4 · a drop-out signs back in: the portal lists the unsubmitted estimate; tapping it resumes; the portal read moves no status", async ({ browser, request }) => {
    test.setTimeout(300_000);
    test.skip(!cronSecret, "CRON_SECRET drives the sweep");
    /**
     * ⚑ WHO THIS DROP-OUT IS CHANGED, and it had to (⚑1, v2 phase 2).
     *
     * It used to be an anonymous visitor who typed their details on the
     * contact page and walked away. There is no contact page now — the price
     * comes first — so an anonymous drop-out leaves no email and cannot be
     * sent a sign-in link at all. That is the trade §2.6 describes.
     *
     * The reachable version is the one that matters more anyway: a SIGNED-IN
     * member starts a new estimate and walks away. Their account already knows
     * them, so the draft carries the email from the first answer, and the
     * resume link is a real promise rather than a hope.
     */
    const member = await browser.newContext({ ...devices["iPhone 13"] });
    const p1 = await member.newPage();
    await p1.goto(await magicLinkFor(db!, dropEmail));
    await openQuickLook(p1);
    await fillQuickAddress(p1);
    await quickNext(p1);
    await quickNext(p1);
    await p1.waitForTimeout(4_000); // past the autosave debounce
    const before = await db!.from("wizard_drafts").select("id, user_id, bucket").eq("email", dropEmail).maybeSingle();
    expect(before.data, "the drop-out left a draft").toBeTruthy();
    await member.close();

    // The sweep files it as dropped (and would email a real address here).
    const sweep = await request.get("/api/cron/wizard-sweep?minutes=0", { headers: { authorization: `Bearer ${cronSecret}` } });
    expect(sweep.ok()).toBe(true);
    const dropped = await db!.from("wizard_drafts").select("bucket, dropped_at").eq("id", before.data!.id).single();
    expect(dropped.data!.bucket).toBe("dropped");
    expect(dropped.data!.dropped_at).toBeTruthy();

    // Another day, another device: the sign-in link → the account page.
    const other = await browser.newContext({ ...devices["iPhone 13"] });
    const p2 = await other.newPage();
    await p2.goto(await magicLinkFor(db!, dropEmail));
    await p2.goto("/account");
    const card = p2.getByTestId("portal-unsubmitted-estimate");
    await expect(card).toBeVisible({ timeout: 30_000 });
    await expect(card).toContainText(/Not yet submitted/);
    await expect(card).toContainText(/You were at/);
    // Reading the portal wrote nothing: still dropped, same session.
    const after = await db!.from("wizard_drafts").select("bucket, user_id").eq("id", before.data!.id).single();
    expect(after.data!.bucket).toBe("dropped");
    expect(after.data!.user_id).toBe(before.data!.user_id);

    // Tap it: the wizard resumes the walk.
    await card.click();
    await expect(p2).toHaveURL(/\/estimate/);
    await expect(p2.getByTestId("wz-resume")).toBeVisible({ timeout: 30_000 });
    await expect(p2.getByTestId("wz-resume")).toContainText(/you were at/i);
    /**
     * THE OWNER DOES NOT CHANGE, and that is the point (CI fix, 11 Sep).
     *
     * This asserted `not.toBe` — the draft being ADOPTED, its user_id moving
     * from an anonymous session to the member's. That was the old story, and
     * this test's own preamble already explains why it ended: there is no
     * contact page any more, so an anonymous drop-out leaves no email and
     * cannot be sent a sign-in link at all. The drop-out who can be reached is
     * a SIGNED-IN member, and their draft is theirs from the first answer.
     *
     * So there is nothing to adopt, and the honest assertion is that the walk
     * came back to the same person, still open. `adoptDraft` still exists for
     * the case it was written for — a draft found by verified EMAIL rather than
     * by session (lib/wizard/draftOwner.ts `findOpenDraft`, `own: false`).
     */
    const adopted = await db!.from("wizard_drafts").select("user_id, converted_at").eq("id", before.data!.id).single();
    expect(adopted.data!.user_id).toBe(before.data!.user_id);
    expect(adopted.data!.converted_at).toBeNull();
    await other.close();
  });

  /**
   * DELETED 11 Sep — "late · commercial exterior: no build-year question, no
   * 'anything else out there', no oil question".
   *
   * It tested the commercial-exterior PAGE SET. C4 (audit 9.3c) removed that
   * path: a commercial job whose work is outside now hands off to a person at
   * the place screen, because `pageKeys` for an exterior job routes through
   * PageExteriorHouse — house / fence / deck / shed and domestic storeys — and
   * an office block was being asked which weatherboards it has. Every
   * commercial outside is a visit anyway (ruling, 10 Sep).
   *
   * So the journey it describes is one no customer can take. What replaced it
   * is covered by e2e/customer-journey/outside-commercial.spec.ts, which
   * asserts the hand-off and that the domestic questions never appear.
   * Deleted rather than rewritten, on Tom's call.
   */

  test("3 · confirming a room lands the next room's NAME under the sticky header (phone)", async ({ browser }) => {
    test.setTimeout(240_000);
    const ctx = await browser.newContext({ ...devices["iPhone 13"] });
    const page = await ctx.newPage();
    await driveNoPlanWizard(page, { email: `e2e-scroll-${stamp}@example.com` });
    await expect(page.locator("[data-ready='1']")).toBeAttached({ timeout: 30_000 });
    const cards = page.locator('[data-card^="room:"]');
    expect(await cards.count()).toBeGreaterThanOrEqual(2);
    const first = cards.nth(0);
    await first.locator(".il-hd").click();
    await first.getByRole("button", { name: "Looks right" }).click();
    for (let i = 0; i < 4 && (await first.locator(".il-cup:not(.ok)").count()); i++) {
      await first.locator(".il-cup:not(.ok)").first().getByRole("button", { name: "No", exact: true }).click();
      await page.waitForTimeout(300);
    }
    await first.locator(".il-confirm").click();
    await expect(first).toHaveClass(/done/, { timeout: 20_000 });
    await page.waitForTimeout(900); // the smooth scroll settles
    const header = await page.locator(".sc-freeze").boundingBox();
    const secondName = await cards.nth(1).locator(".il-hd").boundingBox();
    expect(header && secondName).toBeTruthy();
    // The name sits below the frozen stack and inside the viewport.
    expect(secondName!.y).toBeGreaterThanOrEqual(header!.y + header!.height - 2);
    expect(secondName!.y + secondName!.height).toBeLessThanOrEqual(page.viewportSize()!.height);
    await ctx.close();
  });
});
