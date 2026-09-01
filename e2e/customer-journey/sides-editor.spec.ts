import { test, expect, type Page } from "@playwright/test";
import { MONEY_RANGE, fillContactStep } from "./drive";

/**
 * R2b — the exterior confirm-loop editor, BY SIDES (rebuild addendum §0;
 * reference: customer-review-confirm-exterior-v2-sides.html, which
 * supersedes the element-grouped exterior layout).
 *
 * Eight loop items — Front / Left / Right / Back / Freestanding extras /
 * Condition & access / windows-doors totals / sweep. Everything starts
 * AMBER; a side turns CYAN only when its required questions are answered
 * and its wall mix adds to 100%; a skipped side reads NOT PAINTING; the CTA
 * stays disabled until all eight confirm.
 */

async function driveExteriorWizard(page: Page) {
  await page.goto("/estimate");
  await page.getByRole("button", { name: "Exterior", exact: true }).click();
  await page.getByPlaceholder(/listing URL/).fill("https://www.realestate.com.au/property-house-vic-murrumbeena-1400002");
  await page.getByPlaceholder("Suburb").fill("Murrumbeena");
  await page.getByPlaceholder("Postcode").fill("3163");
  const answer = async (heading: string | RegExp, label: string) => {
    const row = page.locator(".wz-qhead", { hasText: heading })
      .locator("xpath=following-sibling::div[1]")
      .getByRole("button", { name: label, exact: true });
    if (await row.count()) await row.first().click();
  };
  await answer("Heritage listed", "No");
  await answer("What kind of property", "House");
  const next = async () => {
    await page.getByRole("button", { name: /Continue|Nearly there|See my estimate/ }).first().click();
    const err = page.locator(".wz-err");
    if (await err.count()) throw new Error(`wizard gate: ${await err.first().innerText()}`);
  };
  await next(); // → page 2: the house
  await next(); // → scope
  await next(); // → condition
  await page.getByRole("button", { name: /Good overall/i }).click();
  await answer(/built before 1970/, "No");
  await next(); // extras+paint
  await next(); // → contact, the LAST page (Tom, 31 Aug)
  await fillContactStep(page, `e2e-sides-${Date.now()}@example.com`);
  await page.getByRole("button", { name: "See my estimate" }).click();
  // 28 Aug: the wizard lands straight in the sides editor.
  await expect(page.locator(".sd-card").first()).toBeVisible({ timeout: 90_000 });
  await expect(page.locator("[data-ready='1']")).toBeAttached({ timeout: 20_000 });
}

test("R2b sides loop: amber to cyan, walls must total 100%, skip reads NOT PAINTING, CTA gates on all eight", async ({ page }) => {
  test.setTimeout(240_000);
  page.on("response", async (r) => {
    if (r.url().includes("wizard-edit") && r.status() >= 400) {
      console.log("EDIT-FAIL", r.status(), (await r.text().catch(() => "")).slice(0, 160));
    }
  });
  await driveExteriorWizard(page);

  // Eight amber items, progress 0 of 8, CTA disabled.
  await expect(page.locator(".sd-prog")).toContainText("0 OF 8");
  await expect(page.locator(".sd-cta")).toBeDisabled();

  // FRONT: answer the loop. Are we painting this side? -> Yes.
  const front = page.locator(".sd-card", { hasText: "Front" }).first();
  await front.locator(".sd-hd").click();
  await front.getByRole("button", { name: "Yes", exact: true }).click();
  // Size question: Looks right.
  await front.getByRole("button", { name: /Looks right/ }).click();
  // The wall grid shows ONLY the wizard's substrate answer (weatherboard).
  await expect(front.locator(".sd-wall")).toHaveCount(1);
  await expect(front.locator(".sd-wall").first()).toContainText(/Weatherboard/i);
  // Add render from "+ Add a surface" -> arrives at 25% with auto-balance,
  // and the mix still totals 100%.
  await front.getByRole("button", { name: /Add a surface/ }).click();
  await front.getByRole("button", { name: /Render — wall surface/ }).click();
  await expect(front.locator(".sd-wall")).toHaveCount(2);
  await expect(front.locator(".sd-wallsum")).toContainText("100%");

  // An OVER-committed mix (125%) blocks the confirm, by name.
  //
  // R5.1 REGRESSION GUARD: this sequence — wrong value, refused confirm,
  // corrected value, confirm again — is the one that broke when taps began
  // batching. All four arrived as ONE batch, the first confirm refused
  // exactly as designed, the batch stopped there, and the CORRECTION was
  // discarded. It failed 2 runs in 3 before a confirm was made to end its
  // batch. If this goes flaky again, look there first, not at the timeouts.
  const fbWall = front.locator(".sd-wall", { hasText: /Weatherboard/i }).first();
  await fbWall.locator(".sd-pc", { hasText: "100" }).click(); // 100 + render 25 = 125
  await front.getByRole("button", { name: /Confirm front/i }).click();
  await expect(front).not.toHaveClass(/done/);
  await expect(page.locator(".sd-toast, .sd-wallsum.bad").first()).toBeVisible();
  await fbWall.locator(".sd-pc", { hasText: "75" }).click(); // back to 100 total
  await front.getByRole("button", { name: /Confirm front/i }).click();
  await expect(front).toHaveClass(/done/, { timeout: 15_000 });
  await expect(page.locator(".sd-prog")).toContainText("1 OF 8");

  // Tom, 31 Aug: an UNDER-100 mix is a normal answer — half this wall is
  // glass. 50% says what isn't charged and confirms first go.
  const left = page.locator(".sd-card", { hasText: "Left" }).first();
  await left.locator(".sd-hd").click();
  await left.getByRole("button", { name: "Yes", exact: true }).click();
  await left.getByRole("button", { name: /Looks right/ }).click();
  await left.locator(".sd-pc", { hasText: "50" }).first().click();
  await expect(left.locator(".sd-wallsum")).toContainText(/Painting 50%/i);
  await left.getByRole("button", { name: /Confirm left/i }).click();
  await expect(left).toHaveClass(/done/, { timeout: 15_000 });

  // RIGHT: skip it — NOT PAINTING, an explicit exclusion, still counts done.
  const right = page.locator(".sd-card", { hasText: "Right" }).first();
  await right.locator(".sd-hd").click();
  await right.getByRole("button", { name: /No — skip this side/ }).click();
  await expect(right.locator(".sd-pill")).toContainText(/NOT PAINTING/);

  // Batch 5 (C2): the exclusion is REVERSIBLE — "Yes" restores the side to
  // an open amber card (confirm required again), then re-skip for the rest
  // of the loop.
  await right.locator(".sd-hd").click();
  await right.getByRole("button", { name: "Yes", exact: true }).click();
  await expect(right.locator(".sd-pill")).not.toContainText(/NOT PAINTING/, { timeout: 15_000 });
  await expect(right.locator(".sd-pill")).toContainText(/CONFIRM THIS SIDE/);
  await right.getByRole("button", { name: /No — skip this side/ }).click();
  await expect(right.locator(".sd-pill")).toContainText(/NOT PAINTING/, { timeout: 15_000 });

  // BACK: not-sure length is accepted — "we'll measure" widens the range.
  const back = page.locator(".sd-card", { hasText: "Back" }).first();
  await back.locator(".sd-hd").click();
  await back.getByRole("button", { name: "Yes", exact: true }).click();
  await back.getByRole("button", { name: /Adjust it/ }).click();
  await back.getByPlaceholder("length m").fill("not sure");
  await back.getByRole("button", { name: "Update", exact: true }).click();
  await expect(back.locator(".sd-size")).toContainText(/measure/i);
  await back.getByRole("button", { name: /Confirm back/i }).click();
  await expect(back).toHaveClass(/done/, { timeout: 15_000 });

  // The remaining four cards.
  // Tom, 31 Aug: a ticked extra IS the answer — no "Nothing else" on top.
  const extras = page.locator(".sd-card", { hasText: "Freestanding extras" });
  await extras.locator(".sd-hd").click();
  await extras.getByRole("button", { name: /\+ Deck/ }).click();
  await extras.getByRole("button", { name: /Confirm extras/i }).click();

  const cond = page.locator(".sd-card", { hasText: "Condition & access" });
  await cond.locator(".sd-hd").click();
  await cond.getByRole("button", { name: /Good overall/ }).click();
  await cond.getByRole("button", { name: /No, looks solid/ }).click();
  await cond.getByRole("button", { name: /None of these/ }).click();
  await cond.getByRole("button", { name: /Confirm condition/i }).click();

  const dw = page.locator(".sd-card", { hasText: /windows & doors/i });
  await dw.locator(".sd-hd").click();
  await dw.getByRole("button", { name: /That's right/ }).click();
  await dw.getByRole("button", { name: /Confirm counts/i }).click();

  // Tom, 31 Aug: "+ Something else" opens a box to SAY what — the typed name
  // answers the sweep, so "No — that's everything" isn't needed on top.
  const sweep = page.locator(".sd-card", { hasText: /anything we haven't listed/i });
  await sweep.locator(".sd-hd").click();
  await sweep.getByRole("button", { name: /\+ Something else/ }).click();
  await sweep.getByPlaceholder(/What else needs painting/).fill("Bungalow");
  await sweep.getByRole("button", { name: "Add", exact: true }).click();
  await expect(page.locator(".sd-toast")).toContainText(/Bungalow/i, { timeout: 30_000 });
  await sweep.getByRole("button", { name: /Confirm — nothing missing/i }).click();

  // Everything blue: 8 of 8, CTA enabled, range still a range.
  await expect(page.locator(".sd-prog")).toContainText("8 OF 8", { timeout: 45_000 }); // production queue drain
  await expect(page.locator(".sd-cta")).toBeEnabled();
  await expect(page.locator(".sc-r, .sd-range").first()).toHaveText(MONEY_RANGE);
});

/** Parity STOP-item 1 — the priced wiring (Tom's price list, 20 Aug 2026).
 * Weathered, minor rot and access PRICE (modifier + allowance lines); the
 * add-panel offers the priced catalogue (shutters/side gate/security door/
 * meter box); the sweep prices Shed and Side gate, while Carport stays an
 * amber visit flag and Rear fence left the sweep. */
test("priced extras: condition/access, catalogue chips and sweep items move the range", async ({ page }) => {
  test.setTimeout(240_000);
  await driveExteriorWizard(page);

  const rangeMid = async () => {
    const txt = await page.locator("span[data-role='range']").innerText();
    const [lo, hi] = [...txt.matchAll(/\$([\d,]+)/g)].map((m) => Number(m[1].replace(/,/g, "")));
    return (lo + hi) / 2;
  };
  const settled = async () => expect(page.locator(".sd-saving")).toHaveCount(0, { timeout: 30_000 });

  // Weathered = the ×1.8 condition modifier — the range moves UP, and the
  // toast names the delta. "Good overall" takes it back off.
  const cond = page.locator(".sd-card", { hasText: "Condition & access" });
  await cond.locator(".sd-hd").click();
  const beforeWeathered = await rangeMid();
  await cond.getByRole("button", { name: "Weathered", exact: true }).click();
  await expect(page.locator(".sd-toast")).toContainText(/weathered paintwork.*\+\$[\d,]+/i, { timeout: 30_000 });
  await settled();
  const afterWeathered = await rangeMid();
  expect(afterWeathered).toBeGreaterThan(beforeWeathered);
  await cond.getByRole("button", { name: /Good overall/ }).click();
  await settled();
  expect(await rangeMid()).toBeLessThan(afterWeathered);

  // Minor rot and access price as allowance lines, both ways.
  const beforeRot = await rangeMid();
  await cond.getByRole("button", { name: "A little", exact: true }).click();
  await settled();
  expect(await rangeMid()).toBeGreaterThan(beforeRot);
  await cond.getByRole("button", { name: /No, looks solid/ }).click();
  await settled();
  expect(await rangeMid()).toBeLessThanOrEqual(beforeRot);
  await cond.getByRole("button", { name: /Steep block/ }).click();
  await settled();
  expect(await rangeMid()).toBeGreaterThan(beforeRot);

  // The add-panel offers the priced catalogue; adding puts a steppable tile
  // on THIS side and moves the range.
  const front = page.locator(".sd-card", { hasText: "Front" }).first();
  await front.locator(".sd-hd").click();
  await front.getByRole("button", { name: "Yes", exact: true }).click();
  // Batch 2: out-of-range dims CLAMP and proceed (3–40 × 2–8) — the gentle
  // clamp, never a refusal; the toast names the recorded size.
  await front.getByRole("button", { name: /Adjust it/ }).click();
  await front.getByPlaceholder("length m").fill("50");
  await front.getByPlaceholder("height m").fill("9");
  await front.getByRole("button", { name: "Update", exact: true }).click();
  await expect(page.locator(".sd-toast")).toContainText(/40 × 8.*3–40/, { timeout: 30_000 });
  await settled();
  await front.getByRole("button", { name: /Add a surface/ }).click();
  const doorChip = front.getByRole("button", { name: /Security door — \$[\d,]+/ });
  await expect(doorChip).toBeVisible();
  const beforeDoor = await rangeMid();
  await doorChip.click();
  await settled();
  expect(await rangeMid()).toBeGreaterThan(beforeDoor);
  await expect(front.locator(".sd-tl", { hasText: "Security door" })).toBeVisible();
  // Added once — the chip leaves the panel; the tile's stepper owns count.
  await front.getByRole("button", { name: /Add a surface/ }).click();
  await expect(front.getByRole("button", { name: /Security door — \$/ })).toHaveCount(0);

  // The sweep: Shed prices on (✓) and off again; Rear fence is gone;
  // Carport stays the amber visit flag.
  const sweep = page.locator(".sd-card", { hasText: /anything we haven't listed/i });
  await sweep.locator(".sd-hd").click();
  await expect(sweep.getByRole("button", { name: /Rear fence/ })).toHaveCount(0);
  const shedChip = sweep.getByRole("button", { name: /Shed — \$[\d,]+/ });
  const beforeShed = await rangeMid();
  await shedChip.click();
  await settled();
  expect(await rangeMid()).toBeGreaterThan(beforeShed);
  await expect(sweep.getByRole("button", { name: /✓ Shed/ })).toBeVisible();
  await sweep.getByRole("button", { name: /✓ Shed/ }).click();
  await settled();
  await expect(sweep.getByRole("button", { name: /\+ Shed/ })).toBeVisible();
  await sweep.getByRole("button", { name: "+ Carport", exact: true }).click();
  await expect(page.locator(".sd-toast")).toContainText(/carport.*site visit/i, { timeout: 30_000 });
  await settled();
  // Batch 2 (C11): the tier line NAMES the reason — a customer-added item
  // routes as "custom", the mockup's highest-priority wording.
  await expect(page.locator(".sd-tier")).toContainText(/price in person/i);
});
