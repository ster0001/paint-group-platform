import { test, expect, type Page } from "@playwright/test";
import { MONEY_RANGE } from "./drive";

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
  await next(); // → house
  await next(); // → scope
  await next(); // → condition
  await page.getByRole("button", { name: /Good overall/i }).click();
  await answer(/built before 1970/, "No");
  await next(); // extras+paint
  await next(); // email
  const email = page.locator("input[type=email]");
  if (await email.count()) await email.fill(`e2e-sides-${Date.now()}@example.com`);
  await page.getByRole("button", { name: "See my estimate" }).click();
  await expect(page.locator(".wz-r")).toBeVisible({ timeout: 90_000 });
  await page.getByRole("link", { name: /Open the editor/i }).click();
  await expect(page.locator(".sd-card").first()).toBeVisible({ timeout: 20_000 });
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
  // Confirm the side -> cyan.
  await front.getByRole("button", { name: /Confirm front/i }).click();
  await expect(front).toHaveClass(/done/, { timeout: 15_000 });
  await expect(page.locator(".sd-prog")).toContainText("1 OF 8");

  // A wall mix that is NOT 100% blocks the confirm.
  const left = page.locator(".sd-card", { hasText: "Left" }).first();
  await left.locator(".sd-hd").click();
  await left.getByRole("button", { name: "Yes", exact: true }).click();
  await left.getByRole("button", { name: /Looks right/ }).click();
  await left.locator(".sd-pc", { hasText: "50" }).first().click();
  await left.getByRole("button", { name: /Confirm left/i }).click();
  await expect(left).not.toHaveClass(/done/);
  await expect(page.locator(".sd-toast, .sd-wallsum.bad").first()).toBeVisible();
  await left.locator(".sd-pc", { hasText: "100" }).first().click();
  await left.getByRole("button", { name: /Confirm left/i }).click();
  await expect(left).toHaveClass(/done/, { timeout: 15_000 });

  // RIGHT: skip it — NOT PAINTING, an explicit exclusion, still counts done.
  const right = page.locator(".sd-card", { hasText: "Right" }).first();
  await right.locator(".sd-hd").click();
  await right.getByRole("button", { name: /No — skip this side/ }).click();
  await expect(right.locator(".sd-pill")).toContainText(/NOT PAINTING/);

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
  const extras = page.locator(".sd-card", { hasText: "Freestanding extras" });
  await extras.locator(".sd-hd").click();
  await extras.getByRole("button", { name: /Nothing else/ }).click();
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

  const sweep = page.locator(".sd-card", { hasText: /anything we haven't listed/i });
  await sweep.locator(".sd-hd").click();
  await sweep.getByRole("button", { name: /No — that's everything/ }).click();
  await sweep.getByRole("button", { name: /Confirm — nothing missing/i }).click();

  // Everything blue: 8 of 8, CTA enabled, range still a range.
  await expect(page.locator(".sd-prog")).toContainText("8 OF 8", { timeout: 45_000 }); // production queue drain
  await expect(page.locator(".sd-cta")).toBeEnabled();
  await expect(page.locator(".sc-r, .sd-range").first()).toHaveText(MONEY_RANGE);
});
