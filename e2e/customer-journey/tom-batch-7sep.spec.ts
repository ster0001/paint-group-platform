import { test, expect, devices, type Page } from "@playwright/test";
import { createClient } from "@supabase/supabase-js";
import { driveNoPlanWizard, fillContactStep, MONEY_RANGE } from "./drive";
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

test.describe("Tom's 7 Sep batch", () => {
  test.skip(missing, "needs the test project's service key (see .env.test.local)");
  const db = missing ? null : createClient(url!, serviceKey!);
  const stamp = Date.now();
  const describeEmail = `e2e-describe-${stamp}@example.com`;
  const dropEmail = `e2e-return-${stamp}@example.com`;
  let describedEstimateId: string | null = null;

  test.afterAll(async () => {
    if (!db) return;
    await db.from("wizard_drafts").delete().in("email", [describeEmail, dropEmail]);
    for (const e of [describeEmail, dropEmail]) { await destroyAccountChain(db, e); await deleteUserByEmail(db, e); }
  });

  test("2 · exterior: no interior basics; targets → follow-ups → sides left unticked arrive NOT PAINTING", async ({ page }) => {
    test.setTimeout(240_000);
    await page.goto("/estimate");
    await expect(page.locator("[data-ready='1']")).toBeAttached({ timeout: 20_000 });
    // The bug: pick the questions card first, then switch to Exterior — the
    // interior bedrooms/open-plan questions used to stay on the page.
    await page.getByTestId("entry-questions").click();
    await page.getByRole("button", { name: "Exterior", exact: true }).click();
    await expect(page.getByTestId("entry-questions")).toHaveClass(/\bon\b/);
    await expect(page.getByText(/thirty seconds of basics/i)).toHaveCount(0);
    await expect(page.locator(".wz-qhead", { hasText: /^Bedrooms/ })).toHaveCount(0);
    await expect(page.locator(".wz-qhead", { hasText: /Open-plan kitchen/ })).toHaveCount(0);

    await page.getByPlaceholder("Suburb").fill("Murrumbeena");
    await page.getByPlaceholder("Postcode").fill("3163");
    const ans = answer(page);
    const next = nextOf(page);
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

    // The sides editor: only the FRONT is open for confirming; the other
    // three arrive answered "not painting".
    await expect(page.locator(".sd-card").first()).toBeVisible({ timeout: 120_000 });
    await expect(page.locator("[data-ready='1']")).toBeAttached({ timeout: 30_000 });
    for (const side of ["Left side", "Right side", "Back"]) {
      await expect(page.locator(".sd-card", { hasText: side }).first().locator(".sd-pill")).toHaveText(/NOT PAINTING/);
    }
    await expect(page.locator(".sd-card", { hasText: "Front" }).first().locator(".sd-pill")).toHaveText(/CONFIRM THIS SIDE/);
    await expect(page.locator(".sd-prog")).toContainText("3 OF 8");
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
    expect(bs.blocks?.find((b) => /Rear/.test(b.name ?? ""))?.isOption).toBe(true);
    expect(bs.wizard?.state?.exterior?.targets).toEqual(["house", "fence", "shed"]);
    expect(bs.wizard?.state?.exterior?.sides).toEqual(["front"]);
  });

  test("1 + 5 · describe it: condition (with photos) and details are asked; the photos are pending sign-off", async ({ page }) => {
    test.setTimeout(300_000);
    await page.goto("/estimate");
    await expect(page.locator("[data-ready='1']")).toBeAttached({ timeout: 20_000 });
    await page.getByPlaceholder("Suburb").fill("Murrumbeena");
    await page.getByPlaceholder("Postcode").fill("3163");
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
    // Run on its own: the newest estimate still waiting on its photos.
    if (!describedEstimateId) {
      const { data } = await db!.from("estimates").select("id").eq("status", "draft")
        .contains("builder_state", { aiDeferred: [{ kind: "photo_review" }] }).order("created_at", { ascending: false }).limit(1).maybeSingle();
      describedEstimateId = (data as { id?: string } | null)?.id ?? null;
    }
    test.skip(!describedEstimateId, "no estimate with photos to sign off — run the describe test first");
    await signIn(page, staff!, /\/(estimates|dashboard|crm)/);
    // Today carries the sign-off as a work item (under Approvals; the test
    // project's queue is long, so the chip narrows it).
    await page.goto("/crm/today?f=approvals");
    await expect(page.getByText(/Sign off 1 condition photo/).first()).toBeVisible({ timeout: 30_000 });
    // The builder: the photos panel, clearly labelled, above the areas.
    await page.goto(`/quote?id=${describedEstimateId}`);
    const panel = page.getByTestId("customer-photos-panel");
    await expect(panel).toBeVisible({ timeout: 30_000 });
    await expect(panel).toContainText(/Needs estimator sign-off/);
    await expect(panel.locator("img").first()).toBeVisible();
    await page.getByTestId("photos-sign-off").click();
    await expect(panel).toContainText(/Signed off/);
    await page.getByTestId("builder-save").click();
    await expect(page.getByText(/Saved ✓/).first()).toBeVisible({ timeout: 30_000 });
    const { data: est } = await db!.from("estimates").select("builder_state").eq("id", describedEstimateId!).single();
    const bs = est!.builder_state as { aiDeferred?: Array<{ kind?: string }>; photoReview?: { signedOffAt?: string } };
    expect(bs.aiDeferred?.some((d) => d.kind === "photo_review")).toBe(false);
    expect(bs.photoReview?.signedOffAt).toBeTruthy();
  });

  test("4 · a drop-out signs back in: the portal lists the unsubmitted estimate; tapping it resumes; the portal read moves no status", async ({ browser, request }) => {
    test.setTimeout(300_000);
    test.skip(!cronSecret, "CRON_SECRET drives the sweep");
    const anon = await browser.newContext({ ...devices["iPhone 13"] });
    const p1 = await anon.newPage();
    await p1.goto("/estimate");
    await expect(p1.locator("[data-ready='1']")).toBeAttached({ timeout: 20_000 });
    await p1.getByRole("button", { name: /There isn't a floorplan to hand/ }).click();
    await p1.getByPlaceholder("Suburb").fill("Murrumbeena");
    await p1.getByPlaceholder("Postcode").fill("3163");
    const ans = answer(p1);
    const next = nextOf(p1);
    await ans("What kind of property", "House");
    await next(); await next(); await next();
    await ans(/built before 1970/, "No");
    await ans(/asbestos/, "No");
    await ans(/living there/, "No — it'll be empty");
    await next(); // the contact page — typed, then walked away from
    await fillContactStep(p1, dropEmail);
    await p1.waitForTimeout(4_000); // past the autosave debounce
    const before = await db!.from("wizard_drafts").select("id, user_id, bucket").eq("email", dropEmail).maybeSingle();
    expect(before.data, "the drop-out left a draft").toBeTruthy();
    await anon.close();

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

    // Tap it: the wizard resumes the walk, now owned by the signed-in user.
    await card.click();
    await expect(p2).toHaveURL(/\/estimate/);
    await expect(p2.getByTestId("wz-resume")).toBeVisible({ timeout: 30_000 });
    await expect(p2.getByTestId("wz-resume")).toContainText(/you were at/i);
    const adopted = await db!.from("wizard_drafts").select("user_id, converted_at").eq("id", before.data!.id).single();
    expect(adopted.data!.user_id).not.toBe(before.data!.user_id);
    expect(adopted.data!.converted_at).toBeNull();
    await other.close();
  });

  test("late · commercial exterior: no build-year question, no 'anything else out there', no oil question", async ({ page }) => {
    test.setTimeout(240_000);
    await page.goto("/estimate");
    await expect(page.locator("[data-ready='1']")).toBeAttached({ timeout: 20_000 });
    await page.getByRole("button", { name: "Exterior", exact: true }).click();
    await page.getByTestId("entry-questions").click();
    await page.getByPlaceholder("Suburb").fill("Murrumbeena");
    await page.getByPlaceholder("Postcode").fill("3163");
    const ans = answer(page);
    const next = nextOf(page);
    await ans("What kind of property", "Commercial");
    await ans("What sort of commercial job", "A few rooms or offices"); // Tom, 8 Sep
    await next(); // what are we painting
    await expect(page.getByRole("heading", { name: "What are we painting?" })).toBeVisible();
    await next(); // condition
    await expect(page.getByText(/holding up/i).first()).toBeVisible();
    await expect(page.locator(".wz-qhead", { hasText: /built before 1970/ })).toHaveCount(0);
    await page.getByRole("button", { name: /Good overall/i }).click();
    await page.getByRole("button", { name: /None of these/i }).click();
    await next(); // → straight to the contact page: no extras page for a commercial property
    await expect(page.getByRole("heading", { name: /Anything else out there/ })).toHaveCount(0);
    await expect(page.locator(".wz-crow input").first()).toBeVisible();
    await expect(page.getByText(/water based or oil based/i)).toHaveCount(0);
    await expect(page.getByText(/oil-based enamel/i)).toHaveCount(0);
  });

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
