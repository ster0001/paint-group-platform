import { test, expect } from "@playwright/test";
import { MONEY_RANGE, driveNoPlanWizard, openScopeEditor } from "./drive";

/**
 * R3 — the interior confirm-loop editor (+ cupboards).
 * Reference: design/reference/customer-review-confirm-mockup.html.
 *
 * Every room starts AMBER and turns CYAN when its required questions are
 * answered and confirmed: the size question displays L × W (never m²), the
 * cupboard question appears by room type, a custom surface is an amber flag
 * tile that is NEVER auto-priced, and nothing completes until the doors &
 * windows totals check and the missed-rooms sweep (Hallway first) confirm.
 */

test("R3 interior loop: L×W size question, confirm walk, dw check, sweep — CTA gates on completion", async ({ page }) => {
  test.setTimeout(240_000);
  page.on("response", async (r) => {
    if (r.url().includes("wizard-edit") && r.status() >= 400) {
      console.log("EDIT-FAIL", r.status(), (await r.text().catch(() => "")).slice(0, 160));
    }
  });
  await driveNoPlanWizard(page);
  await openScopeEditor(page);

  // The loop chrome: progress reads 0 of N, CTA disabled until complete.
  const prog = page.locator(".il-prog");
  await expect(prog).toContainText(/0 OF \d+/);
  const cta = page.locator(".il-cta");
  await expect(cta).toBeDisabled();

  // Room cards are amber, and sizes read as L × W — never m².
  const cards = page.locator(".sc-rc[data-room]");
  const count = await cards.count();
  expect(count).toBeGreaterThan(2);
  const first = cards.first();
  await expect(first.locator(".il-size")).toContainText(/\d+(\.\d+)?\s*×\s*\d+(\.\d+)?\s*m/);
  await expect(first.locator(".il-size")).not.toContainText("m²");

  // Confirming without answering the size question refuses, by name.
  await first.locator(".il-confirm").click();
  await expect(first).not.toHaveClass(/done/);

  // Walk every room: size Looks right (adjust the first one to prove the
  // reprice + "updated by you" path), then confirm; cupboard Qs answered No.
  for (let i = 0; i < count; i++) {
    const card = cards.nth(i);
    await card.scrollIntoViewIfNeeded();
    if (i === 0) {
      // Batch 2: out-of-range CLAMPS and proceeds (1–15 m a side) — the
      // gentle clamp, never a refusal; the toast names the recorded size.
      await card.getByRole("button", { name: /Adjust it/ }).click();
      await card.getByPlaceholder("length m").fill("20");
      await card.getByPlaceholder("width m").fill("3.8");
      await card.getByRole("button", { name: "Update size" }).click();
      await expect(page.locator(".sc-toast")).toContainText(/15 × 3.8.*1–15/, { timeout: 30_000 });
      await expect(card.locator(".il-size")).toContainText("updated by you");
    } else {
      await card.getByRole("button", { name: /Looks right/ }).click();
    }
    const cup = card.locator(".il-cup");
    if (await cup.count()) {
      await cup.getByRole("button", { name: "No", exact: true }).click();
    }
    await card.locator(".il-confirm").click();
    await expect(card).toHaveClass(/done/, { timeout: 15_000 });
  }

  // Custom surface on the first room: amber flag tile, never auto-priced.
  // (Lives inside the "+ Add a surface" panel per the mockup; the card is
  // collapsed after its confirm, so reopen it from the header first.)
  await first.locator(".il-hd").click();
  await first.scrollIntoViewIfNeeded();
  await first.getByRole("button", { name: /\+ Add a surface/ }).click();
  await first.getByPlaceholder(/Something else/).fill("wall panelling");
  await first.getByRole("button", { name: "Add", exact: true }).click();
  await expect(first.locator(".sc-tl.custom, .il-custom").first()).toBeVisible();

  // Doors & windows totals check.
  const dw = page.locator(".il-card", { hasText: /doors & windows/i });
  await dw.locator(".il-hd").click();
  await expect(dw).toContainText(/We make it \d+ doors and \d+ windows/);
  await dw.getByRole("button", { name: /That.s right/ }).click();
  await dw.getByRole("button", { name: /Confirm counts/ }).click();
  await expect(dw).toHaveClass(/done/, { timeout: 15_000 });

  // The sweep: Hallway is the FIRST chip; "that's everything" completes.
  const sweep = page.locator(".il-card", { hasText: /anything we haven.t listed/i });
  await sweep.locator(".il-hd").click();
  await expect(sweep.locator(".sd-chip, .il-chip").first()).toContainText("Hallway");
  await sweep.getByRole("button", { name: /No — that.s everything/ }).click();
  await sweep.getByRole("button", { name: /Confirm — nothing missing/ }).click();

  // Complete: header flips, CTA enables, the range survives.
  await expect(prog).toContainText(/(\d+) OF \1/, { timeout: 45_000 }); // production queue drain
  await expect(cta).toBeEnabled({ timeout: 15_000 });
  await expect(page.locator(".sc-r")).toHaveText(MONEY_RANGE);
});
